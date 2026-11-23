// Redes sociais na Inbox (migração 034, 23/11). Roda pelo rodar.sh, na empresa de teste. Tudo fictício.
// Confere: o n8n grava directs, contas e comentários pela API (idempotente, com validação); a secretária (só inbox.ver)
// não vê o seletor; quem tem redes.ver vê "WhatsApp ▾ Instagram"; abrir marca como lida; a resposta vai ao n8n da conta
// (falso, nesta porta) com o segredo e entra na conversa; erro do envio aparece e não grava; janela fechada desliga a
// resposta; quem só tem redes.ver abre direto no Instagram; a outra empresa não recebe nada.
const { chromium } = require('playwright');
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const PORTA = Number(process.env.PORTA_REDES || 3993);
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const daPessoa = (email) => `empresa_id = 'teste' and usuario_id = (select id from painel_usuarios where email = '${email}')`;

async function entrar(p, email, destino = '/inbox') {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

(async () => {
  // ---- n8n falso: envio da resposta do direct ----
  const pedidos = []; let modo = 'ok'; let n = 0;
  const n8n = http.createServer((req, resp) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const j = JSON.parse(corpo || '{}');
      pedidos.push({ segredo: req.headers['x-painel-segredo'], j });
      resp.writeHead(modo === 'ok' ? 200 : 500, { 'content-type': 'application/json' });
      resp.end(JSON.stringify(modo === 'ok' ? { mid: `m_saida_${++n}` } : { erro: 'A Meta recusou (teste)' }));
    });
  });
  await new Promise((r) => n8n.listen(PORTA, '127.0.0.1', r));

  // ---- API (chave da IA) ----
  const chave = 'teste-redes-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('n8n redes teste', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm'])`);
  const api = async (caminho, corpo, metodo = 'POST') => {
    const r = await fetch(B + '/api/v1/' + caminho, { method: metodo, headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  const agora = new Date().toISOString();
  const msg = { rede: 'instagram', conta_id: '17840000TESTE', pessoa: { id: 'IGSID-ANA-1', usuario: '@ana.ficticia', nome: 'Ana Fictícia' },
    mid: 'm_entrada_1', direcao: 'entrada', tipo: 'texto', texto: 'Oi, quanto custa a consulta?', enviada_em: agora };
  const g1 = await api('redes/mensagens', msg);
  ok('API: direct de entrada grava (cria a conta sozinha)', g1.s === 200 && g1.j?.repetido === false && g1.j?.conta_id === 'instagram:17840000TESTE', JSON.stringify(g1));
  const g2 = await api('redes/mensagens', msg);
  ok('API: mesmo mid não duplica (repetido)', g2.s === 200 && g2.j?.repetido === true && sql(`select count(*) from rs_mensagens where mid = 'm_entrada_1'`) === '1');
  ok('API: conversa com 1 não lida, @ sem arroba e resumo', sql(`select nao_lidas || '|' || usuario || '|' || ultima_resumo from rs_conversas where pessoa_id = 'IGSID-ANA-1'`) === '1|ana.ficticia|Oi, quanto custa a consulta?');
  const ruim1 = await api('redes/mensagens', { ...msg, rede: 'orkut', mid: 'x1' });
  const ruim2 = await api('redes/mensagens', { ...msg, direcao: 'saida', origem: 'contato', mid: 'x2' });
  const ruim3 = await api('redes/mensagens', { ...msg, pessoa: { id: 'a b' }, mid: 'x3' });
  ok('API: valida rede, origem e ids', ruim1.s === 400 && ruim2.s === 400 && ruim3.s === 400, `${ruim1.s} ${ruim2.s} ${ruim3.s}`);
  const ia = await api('redes/mensagens', { ...msg, mid: 'm_ia_1', direcao: 'saida', origem: 'ia', texto: 'Olá, Ana! A consulta é presencial ou online.', enviada_em: new Date(Date.now() + 1000).toISOString() });
  ok('API: resposta da IA grava e zera as não lidas', ia.s === 200 && sql(`select nao_lidas || '|' || ultima_direcao from rs_conversas where pessoa_id = 'IGSID-ANA-1'`) === '0|saida');
  await api('redes/mensagens', { ...msg, mid: 'm_entrada_2', texto: 'E tem horário amanhã?', enviada_em: new Date(Date.now() + 2000).toISOString() });
  const conta = await api('redes/contas', { rede: 'instagram', conta_id: '17840000TESTE', usuario: 'dr.ficticio', nome: 'Dr. Fictício', responder_url: `http://127.0.0.1:${PORTA}/webhook/ig-responder` });
  const contas = await api('redes/contas', null, 'GET');
  ok('API: conta com envio ligado (sem mostrar o endereço)', conta.s === 200 && conta.j?.responder === true && contas.j?.itens?.length === 1
    && !JSON.stringify(contas.j).includes('127.0.0.1'), JSON.stringify(contas.j).slice(0, 200));
  const c1 = await api('redes/comentarios', { rede: 'instagram', conta_id: '17840000TESTE', comentario_id: 'c_1', texto: 'CONSULTA', post: { id: 'p1', url: 'https://instagram.com/p/ficticio' }, autor: { id: 'IGSID-ANA-1', usuario: 'ana.ficticia' } });
  const c2 = await api('redes/comentarios', { rede: 'instagram', conta_id: '17840000TESTE', comentario_id: 'c_1', resposta_publica: 'Te chamei no direct!', direct_enviado: true, respondido_por: 'ia' });
  ok('API: comentário grava e a resposta atualiza (respondido)', c1.s === 200 && c1.j?.repetido === false && c2.j?.repetido === true && c2.j?.situacao === 'respondido'
    && sql(`select texto || '|' || direct_enviado from rs_comentarios where comentario_id = 'c_1'`) === 'CONSULTA|true', JSON.stringify(c1) + ' ' + JSON.stringify(c2));
  ok('outra empresa não recebe nada', sql('select count(*) from rs_mensagens', process.env.OUTRA_DATABASE_URL) === '0');

  const b = await lancar(); const erros = [];
  // ---- Secretária: só inbox.ver, nada muda ----
  const ctxA = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pa = await ctxA.newPage();
  pa.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  await entrar(pa, 'amanda@teste.local');
  await pa.locator('[data-wa]').first().waitFor({ timeout: 15000 }).catch(() => undefined);
  ok('secretária (sem redes.ver): Inbox do WhatsApp sem seletor', (await pa.locator('[data-seletor-canal]').count()) === 0 && (await pa.locator('#busca-inbox').count()) === 1);

  // ---- A empresa ganha as redes: o admin vê o seletor ----
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['redes.ver','redes.responder'])) where id = 'teste'`);
  const ctxG = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctxG.newPage();
  p.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  await entrar(p, 'gestor@teste.local');
  await p.locator('[data-seletor-canal]').waitFor({ timeout: 15000 }).catch(() => undefined);
  const opcoes = await p.locator('[data-seletor-canal] option').allTextContents();
  ok('admin com redes: seletor WhatsApp ▾ Instagram com a conta e as não lidas', opcoes[0] === 'WhatsApp' && opcoes.some((x) => x.includes('Instagram · @dr.ficticio (1)')), opcoes.join(' | '));
  ok('começa no WhatsApp', (await p.locator('#busca-inbox').count()) === 1 && (await p.locator('[data-inbox-rede]').count()) === 0);
  await p.selectOption('[data-seletor-canal]', 'instagram:17840000TESTE');
  await p.locator('[data-inbox-rede] [data-pessoa="IGSID-ANA-1"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('Instagram: a conversa da Ana aparece com não lida', ((await p.locator('[data-pessoa="IGSID-ANA-1"]').textContent()) || '').includes('Ana Fictícia')
    && ((await p.locator('[data-pessoa="IGSID-ANA-1"]').textContent()) || '').includes('E tem horário amanhã?'));
  await p.click('[data-pessoa="IGSID-ANA-1"]');
  await p.locator('[data-inbox-rede] [data-direcao="entrada"]').first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const textoConversa = (await p.locator('[data-inbox-rede] section[aria-label^="Conversa com"]').textContent()) || '';
  ok('abrir mostra as mensagens e a IA pelo nome do agente', textoConversa.includes('Oi, quanto custa a consulta?') && textoConversa.includes('Olá, Ana!') && textoConversa.includes('@ana.ficticia'));
  ok('abrir marca como lida (com quem leu)', sql(`select nao_lidas || '|' || lida_por from rs_conversas where pessoa_id = 'IGSID-ANA-1'`) === '0|Gestor Teste');
  await p.screenshot({ path: __dirname + '/saida/redes-inbox.png' });

  // ---- Resposta pelo painel ----
  await p.fill('#resposta-rede', 'Tem sim, às 14h. Quer que eu reserve?');
  await p.press('#resposta-rede', 'Enter');
  await p.locator('[data-inbox-rede]').getByText('Painel · Gestor Teste').waitFor({ timeout: 15000 }).catch(() => undefined);
  const env = pedidos.at(-1);
  ok('a resposta vai ao n8n da conta com o segredo e os ids', typeof env?.segredo === 'string' && env.segredo.length >= 16 && env?.j.conta_id === '17840000TESTE' && env?.j.pessoa_id === 'IGSID-ANA-1'
    && env?.j.texto === 'Tem sim, às 14h. Quer que eu reserve?' && env?.j.empresa === 'teste' && env?.j.por === 'Gestor Teste', String(JSON.stringify(env)).slice(0, 200) + ' alerta=' + (await p.locator('[data-inbox-rede] [role=alert]').allTextContents()).join('|'));
  ok('a resposta entra na conversa como "Painel · Gestor Teste"', ((await p.locator('[data-inbox-rede] section[aria-label^="Conversa com"]').textContent()) || '').includes('Painel · Gestor Teste')
    && sql(`select origem || '|' || por from rs_mensagens where mid = 'm_saida_1'`) === 'painel|Gestor Teste');
  const eco = await api('redes/mensagens', { ...msg, mid: 'm_saida_1', direcao: 'saida', origem: 'painel', texto: 'Tem sim, às 14h. Quer que eu reserve?' });
  ok('o eco do n8n com o mesmo mid não duplica', eco.j?.repetido === true && sql(`select count(*) from rs_mensagens where mid = 'm_saida_1'`) === '1');
  ok('a tentativa vai para o Registro sem o texto', Number(sql(`select count(*) from central_auditoria where acao = 'responder_rede' and detalhe::text not like '%14h%'`)) >= 1);

  modo = 'erro';
  await p.fill('#resposta-rede', 'Essa não vai');
  await p.press('#resposta-rede', 'Enter'); await p.waitForTimeout(1500);
  ok('erro do envio aparece e não grava', ((await p.locator('[data-inbox-rede] [role=alert]').textContent()) || '').includes('A Meta recusou (teste)')
    && sql(`select count(*) from rs_mensagens where texto = 'Essa não vai'`) === '0');
  modo = 'ok';

  sql(`update rs_conversas set ultima_entrada_em = now() - interval '2 days' where pessoa_id = 'IGSID-ANA-1'`);
  await p.reload(); await p.waitForLoadState('networkidle');
  await p.locator('[data-inbox-rede] [data-pessoa="IGSID-ANA-1"]').click({ timeout: 10000 }).catch(() => undefined);
  await p.waitForTimeout(1200);
  ok('janela de 24 h fechada: aviso e resposta desligada (a escolha do canal ficou guardada)', (await p.locator('[data-inbox-rede]').count()) === 1
    && (await p.locator('#resposta-rede').isDisabled()) && ((await p.locator('[data-inbox-rede]').textContent()) || '').includes('Janela de 24 h fechada'));
  const fora = await p.evaluate(async () => (await fetch('/inbox')).status);
  ok('a tela segue respondendo', fora === 200);

  // ---- Só redes (sem inbox.ver): abre direto no Instagram ----
  sql(`update painel_vinculos set permissoes = array['redes.ver','crm.ver'] where ${daPessoa('amanda@teste.local')}`);
  await pa.waitForTimeout(16000); // a leitura guarda a sessão por 15 s (lib/sessao.ts)
  await pa.goto(B + '/inbox'); await pa.waitForLoadState('networkidle');
  await pa.locator('[data-inbox-rede]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('só redes.ver: abre direto no Instagram, sem WhatsApp no seletor e sem responder', (await pa.locator('[data-inbox-rede]').count()) === 1
    && !(await pa.locator('[data-seletor-canal] option').allTextContents()).includes('WhatsApp'), pa.url() + ' ' + ((await pa.locator('main').textContent().catch(() => '')) || '').slice(0, 200));
  sql(`update painel_vinculos set permissoes = array['inbox.ver','crm.ver','crm.editar'] where ${daPessoa('amanda@teste.local')}`);

  ok('sem erro de página', !erros.length, erros.join(' | '));
  await b.close(); n8n.close();
  sql(`update empresas set modulos = array_remove(array_remove(modulos, 'redes.ver'), 'redes.responder') where id = 'teste'`);
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`${res.length - falhas}/${res.length} ok`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
