// Mensagens automáticas da IA no CRM (migração 017): recusa no contato (API, MCP e tela), registro de cada envio
// (idempotente pela chave), ficha com automaticas, histórico do contato, selo do follow-up na Inbox e o filtro
// "Em follow-up". Roda pelo rodar.sh depois do avisos.js (usa a conversa da Beatriz do inbox.js). Dados fictícios.
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const TELA = '5547900003001';          // contato novo, criado pelo registro do envio
const BIA = '5547900001001';           // conversa da Beatriz (inbox.js)

(async () => {
  const chave = 'teste-auto-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Sara automaticas', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm'])`);
  const api = (caminho, corpo) => fetch(B + caminho, {
    method: corpo === undefined ? 'GET' : 'POST', body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  // ---- Registro do envio ----
  let r = await api('/api/v1/automaticas/envios', { telefone: TELA, nome: 'Tais Automatica Ficticia', tipo: 'lembrete_2d', situacao: 'enviado',
    chave: 'lembrete_2d:TESTE-1', texto: 'Olá! Lembrando da sua consulta depois de amanhã às 14h.', wamid: 'wamid.AUTO1', quando: new Date(Date.now() - 3600_000).toISOString() });
  ok('envio automático registrado (cria o contato)', r.status === 200 && r.json.ok && r.json.repetido === false && r.json.contato_id, JSON.stringify(r.json));
  const contatoA = r.json?.contato_id;
  r = await api('/api/v1/automaticas/envios', { telefone: TELA, tipo: 'lembrete_2d', situacao: 'falhou', motivo: 'erro 131049 da Meta', chave: 'lembrete_2d:TESTE-1' });
  ok('mesma chave atualiza em vez de duplicar', r.status === 200 && r.json.repetido === true
    && sql(`select count(*) || '|' || min(situacao) || '|' || min(texto) from envios_automaticos where chave = 'lembrete_2d:TESTE-1'`) === '1|falhou|Olá! Lembrando da sua consulta depois de amanhã às 14h.');
  const ruins = await Promise.all([
    api('/api/v1/automaticas/envios', { telefone: TELA, tipo: 'Lembrete!', situacao: 'enviado', chave: 'x:1' }),
    api('/api/v1/automaticas/envios', { telefone: TELA, tipo: 'lembrete_dia', situacao: 'enviado' }),
    api('/api/v1/automaticas/envios', { telefone: TELA, tipo: 'lembrete_dia', situacao: 'talvez', chave: 'x:2' }),
    api('/api/v1/automaticas/recusa', { telefone: TELA }),
  ]);
  ok('dados inválidos são recusados (tipo, chave, situação, parar)', ruins.every((x) => x.status === 400), ruins.map((x) => x.status).join(','));
  r = await api('/api/v1/automaticas/envios', { telefone: TELA, tipo: 'aniversario', situacao: 'enviado', chave: 'aniversario:TESTE-2026', texto: 'Feliz aniversário!' });
  r = await api(`/api/v1/ficha?telefone=${TELA}`);
  ok('ficha traz automaticas (permitidas e últimos envios)', r.status === 200 && r.json.automaticas?.permitidas === true && r.json.automaticas.ultimos_envios.length === 2
    && r.json.automaticas.ultimos_envios[0].tipo === 'aniversario', JSON.stringify(r.json?.automaticas).slice(0, 200));

  // ---- Recusa pela API ----
  r = await api('/api/v1/automaticas/recusa', { telefone: TELA, parar: true, motivo: 'pediu pelo WhatsApp', por: 'Sara' });
  ok('recusa pela API grava data, motivo e quem', r.status === 200 && r.json.parar === true && r.json.desde && r.json.motivo === 'pediu pelo WhatsApp' && r.json.por === 'Sara', JSON.stringify(r.json));
  const desde = r.json?.desde;
  r = await api('/api/v1/automaticas/recusa', { telefone: TELA, parar: true, motivo: 'outro motivo' });
  ok('marcar de novo mantém data e motivo originais', r.json?.desde === desde && r.json?.motivo === 'pediu pelo WhatsApp', JSON.stringify(r.json));
  r = await api(`/api/v1/ficha?telefone=${TELA}`);
  ok('ficha diz que não pode enviar', r.json?.automaticas?.permitidas === false && r.json.automaticas.motivo === 'pediu pelo WhatsApp');
  ok('recusa fica na auditoria da chave', Number(sql(`select count(*) from painel_auditoria p join api_chaves k on k.id = p.chave_id where k.nome = 'Sara automaticas' and p.detalhe->>'automaticas' = 'paradas'`)) >= 1);
  r = await api('/api/v1/automaticas/recusa', { telefone: '5547900003999', parar: false });
  ok('liberar telefone sem cadastro não cria contato', r.status === 200 && r.json.contato_id === null && sql(`select count(*) from contatos where telefone = '5547900003999'`) === '0');

  // ---- MCP ----
  const mcp = await fetch(B + '/api/mcp/' + chave, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'registrar_envio_automatico', arguments: { telefone: TELA, tipo: 'followup_1h', situacao: 'cancelado', motivo: 'paciente pediu para parar', chave: 'followup_1h:MCP-1' } } }) })
    .then((x) => x.text());
  ok('MCP registra envio automático', mcp.includes('followup_1h') || sql(`select count(*) from envios_automaticos where chave = 'followup_1h:MCP-1'`) === '1', mcp.slice(0, 160));

  // ---- Follow-up da Beatriz: selo e filtro na Inbox ----
  r = await api('/api/v1/automaticas/envios', { telefone: BIA, tipo: 'followup_1h', situacao: 'enviado', chave: 'followup_1h:BIA-1', texto: 'Oi! Conseguiu ver os horários?', quando: new Date().toISOString() });
  ok('follow-up da Beatriz registrado', r.status === 200 && r.json.ok);
  const b = await lancar();
  const erros = [];
  const nova = async () => { const c = await b.newContext({ viewport: { width: 1360, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => erros.push(e.message)); return [c, p]; };
  let [ctx, p] = await nova();
  await entrar(p, 'amanda@teste.local', '/inbox');
  await p.locator('section[aria-label="Conversas"] li', { hasText: 'Beatriz Ficticia' }).click();
  const conversa = p.locator('section[aria-label="Conversa com Beatriz Ficticia"]');
  await conversa.locator('[data-selo]').waitFor({ timeout: 8000 }).catch(() => {});
  ok('selo do follow-up no cabeçalho da conversa', ((await conversa.locator('[data-selo]').textContent().catch(() => '')) || '') === 'Follow-up 1h enviado');
  await p.getByRole('button', { name: 'Em follow-up' }).click(); await p.waitForTimeout(1500);
  const itens = p.locator('section[aria-label="Conversas"] li');
  ok('filtro "Em follow-up" mostra só quem está sem resposta', (await itens.count()) === 1 && ((await itens.first().textContent()) || '').includes('Beatriz Ficticia'), String(await itens.count()));
  // Beatriz responde: sai do filtro e o selo muda.
  sql(`update wa_conversas set ultima_entrada_em = now() + interval '1 second', ultima_em = now() + interval '1 second' where wa_id = '${BIA}'`);
  await p.waitForTimeout(11500);
  ok('respondeu: sai do filtro', (await itens.count()) === 0 && ((await p.textContent('section[aria-label="Conversas"]')) || '').includes('Ninguém em follow-up'));
  ok('respondeu: selo muda', ((await conversa.locator('[data-selo]').textContent().catch(() => '')) || '') === 'Respondeu ao follow-up');
  await ctx.close();

  // ---- Tela: parar e voltar a enviar pela ficha (equipe com crm.editar) ----
  [ctx, p] = await nova();
  await entrar(p, 'gestor@teste.local', '/crm');
  await p.click('button[role=tab]:has-text("Contatos")'); await p.waitForTimeout(800);
  await p.locator('button', { hasText: 'Tais Automatica Ficticia' }).first().click(); await p.waitForTimeout(1500);
  const hist = p.locator('section[aria-label="Histórico do paciente"]');
  let t = ((await hist.textContent()) || '').replace(/\s+/g, ' ');
  ok('histórico mostra recusa e envios automáticos', t.includes('Não recebe mensagens automáticas desde') && t.includes('pediu pelo WhatsApp')
    && t.includes('Lembrete 2 dias antes falhou: erro 131049 da Meta') && t.includes('Aniversário enviado') && t.includes('Follow-up 1h cancelado: paciente pediu para parar'), t.slice(0, 400));
  await hist.getByRole('button', { name: 'Voltar a enviar' }).click(); await p.waitForTimeout(1500);
  ok('Voltar a enviar libera o contato', sql(`select automaticas_paradas_em is null from contatos where id = '${contatoA}'`) === 't');
  await hist.getByRole('button', { name: 'Parar mensagens automáticas' }).click();
  await p.fill('#auto-motivo', 'pediu no balcão');
  await hist.getByRole('button', { name: 'Parar', exact: true }).click(); await p.waitForTimeout(1500);
  ok('Parar pela tela grava motivo e quem', sql(`select automaticas_motivo || '|' || automaticas_por from contatos where id = '${contatoA}'`) === 'pediu no balcão|Gestor Teste');
  t = ((await hist.textContent()) || '').replace(/\s+/g, ' ');
  ok('selo da ficha atualizado', t.includes('Não recebe mensagens automáticas desde') && t.includes('pediu no balcão · Gestor Teste'), t.slice(0, 200));
  await ctx.close();

  // Sem crm.editar: vê o selo, sem o botão.
  sql(`update painel_vinculos set permissoes = array_remove(permissoes, 'crm.editar') where usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local') and empresa_id = 'teste'`);
  [ctx, p] = await nova();
  await entrar(p, 'amanda@teste.local', '/crm');
  await p.click('button[role=tab]:has-text("Contatos")'); await p.waitForTimeout(800);
  await p.locator('button', { hasText: 'Tais Automatica Ficticia' }).first().click(); await p.waitForTimeout(1500);
  const h2 = p.locator('section[aria-label="Histórico do paciente"]');
  ok('sem crm.editar: vê o selo, sem botão', ((await h2.textContent()) || '').includes('Não recebe mensagens automáticas') && (await h2.getByRole('button', { name: 'Voltar a enviar' }).count()) === 0);
  await ctx.close();
  sql(`update painel_vinculos set permissoes = array_append(permissoes, 'crm.editar') where usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local') and empresa_id = 'teste' and not 'crm.editar' = any(permissoes)`);

  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
