// CRM completo: criar e editar pelo painel (atendimento, contato, nota do contato, oportunidade),
// permissões (ver x editar x configurar x arquivar), tela de Configurações do CRM, avisos de cartão novo,
// e a ficha/funil pela API e pelo MCP (ferramentas da IA). Rodar pelo rodar.sh, depois do e2e.js.
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const out = (process.env.SAIDA || __dirname + '/saida') + '/';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => { res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : '')); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function entrar(p, email) {
  await p.goto(B + '/crm'); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const aviso = (p) => p.locator('main [role=status]').textContent().then((t) => t || '');

(async () => {
  const b = await lancar();
  const erros = [];
  const nova = async (vp = { width: 1440, height: 900 }) => {
    const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    return { ctx, p };
  };

  // ---------- Secretária (crm.editar, sem configurar nem arquivar) ----------
  let { ctx, p } = await nova();
  await entrar(p, 'amanda@teste.local');
  await p.click('button:has-text("Novo atendimento")'); await p.waitForSelector('aside[aria-label="Novo atendimento"]');
  await p.fill('#na-telefone', '47 9123'); await p.fill('#na-resumo', 'Teste de telefone curto');
  await p.click('button:has-text("Abrir atendimento")'); await p.waitForTimeout(1000);
  ok('telefone inválido mostra erro no formulário', ((await p.locator('aside [role=alert]').textContent()) || '').includes('Telefone inválido'));
  await p.fill('#na-telefone', '(47) 98888-0101'); await p.fill('#na-nome', 'Novo Ficticio'); await p.selectOption('#na-assunto', 'receita');
  await p.fill('#na-resumo', 'Pede renovação de receita (aberto pela equipe no teste).');
  await p.click('button:has-text("Abrir atendimento")'); await p.waitForTimeout(1500);
  ok('novo atendimento aparece no quadro', (await p.locator('section[aria-label="Receita"] article', { hasText: 'Novo Ficticio' }).count()) === 1);
  ok('novo atendimento grava contato e quem abriu',
    sql("select c.telefone || '|' || a.aberto_por || '|' || a.etapa from atendimentos a join contatos c on c.id=a.contato_id where c.nome='Novo Ficticio'") === '5547988880101|Amanda Teste|aguardando');
  // Mesmo número escrito sem o 9: entra no contato que já existe (Jorge), não cria outro.
  const antes = sql('select count(*) from contatos');
  await p.click('button:has-text("Novo atendimento")'); await p.fill('#na-telefone', '(47) 99000-0013'); await p.fill('#na-resumo', 'Pede segunda via do recibo.');
  await p.click('button:has-text("Abrir atendimento")'); await p.waitForTimeout(1500);
  ok('telefone com e sem o 9 cai no mesmo contato', sql('select count(*) from contatos') === antes
    && sql("select c.nome from atendimentos a join contatos c on c.id=a.contato_id where a.resumo like 'Pede segunda via%'") === 'Jorge Ficticio');
  await p.screenshot({ path: out + '10_novo_atendimento.png' });

  // Contatos: criar, telefone repetido, editar, nota do contato, novo atendimento a partir da ficha
  await p.click('role=tab[name="Contatos"]'); await p.waitForTimeout(1000);
  await p.click('button:has-text("Novo contato")'); await p.fill('#ct-nome', 'Repetido'); await p.fill('#ct-telefone', '554790000011');
  await p.click('button:has-text("Salvar contato")'); await p.waitForTimeout(1000);
  ok('telefone já cadastrado é recusado', ((await p.locator('aside [role=alert]').textContent()) || '').includes('Rita Ficticia'));
  await p.fill('#ct-nome', 'Clara Ficticia'); await p.fill('#ct-telefone', '(48) 97777-0202'); await p.fill('#ct-documento', '987.654.321-00');
  await p.click('button:has-text("Salvar contato")'); await p.waitForTimeout(1500);
  ok('contato novo criado e aberto na ficha', (await p.locator('h2', { hasText: 'Clara Ficticia' }).count()) === 1
    && sql("select telefone || '|' || documento || '|' || tipo_documento from contatos where nome='Clara Ficticia'") === '5548977770202|98765432100|cpf');
  await p.click('button:has-text("Editar")'); await p.fill('#ct-nome', 'Clara Ficticia Souza'); await p.click('button:has-text("Salvar contato")'); await p.waitForTimeout(1500);
  ok('editar contato', sql("select count(*) from contatos where nome='Clara Ficticia Souza'") === '1');
  await p.fill('#nota-contato', 'Prefere contato à tarde.'); await p.click('section[aria-label="Ficha do contato"] button:has-text("Salvar nota")'); await p.waitForTimeout(1200);
  ok('nota do contato aparece e é gravada', (await p.locator('text=Prefere contato à tarde.').count()) === 1
    && sql("select n.autor from notas n join contatos c on c.id=n.alvo_id where n.alvo_tipo='contatos' and c.nome='Clara Ficticia Souza'") === 'Amanda Teste');
  await p.click('section[aria-label="Ficha do contato"] button:has-text("Novo atendimento")');
  ok('novo atendimento pela ficha já vem com o telefone', (await p.inputValue('#na-telefone')) === '5548977770202');
  await p.fill('#na-resumo', 'Quer saber valor da consulta.'); await p.selectOption('#na-assunto', 'valores');
  await p.click('button:has-text("Abrir atendimento")'); await p.waitForTimeout(1500);
  ok('atendimento aparece na ficha do contato', (await p.locator('section[aria-label="Ficha do contato"] li', { hasText: 'Quer saber valor' }).count()) === 1);
  await p.screenshot({ path: out + '11_contatos_ficha.png' });

  // Comercial: criar, abrir e mover de etapa; secretária não arquiva
  await p.click('role=tab[name="Comercial"]'); await p.waitForTimeout(1200);
  await p.click('button:has-text("Nova oportunidade")'); await p.fill('#no-telefone', '(48) 97777-0202'); await p.fill('#no-interesse', 'Primeira consulta');
  await p.fill('#no-valor', '1.234,50'); await p.click('button:has-text("Criar oportunidade")'); await p.waitForTimeout(1500);
  ok('nova oportunidade no funil', (await p.locator('article', { hasText: 'Primeira consulta' }).count()) === 1
    && sql("select o.valor from oportunidades o join contatos c on c.id=o.contato_id where c.nome='Clara Ficticia Souza'") === '1234.50');
  const etapaGanho = sql("select id from crm_etapas where tipo='ganho' and not arquivado order by ordem limit 1");
  await p.locator('article', { hasText: 'Primeira consulta' }).click(); await p.waitForTimeout(500);
  ok('secretária não vê arquivar oportunidade', (await p.locator('text=Arquivar oportunidade').count()) === 0);
  await p.selectOption('#op-etapa', etapaGanho); await p.fill('#op-valor', '800.5'); await p.click('aside button:has-text("Salvar")'); await p.waitForTimeout(1500);
  ok('mover oportunidade de etapa pela tela', sql("select o.etapa_id || '|' || o.valor from oportunidades o join contatos c on c.id=o.contato_id where c.nome='Clara Ficticia Souza'") === `${etapaGanho}|800.50`);
  await p.screenshot({ path: out + '12_comercial.png' });

  // Avisos: liga, esconde a aba, chega cartão novo → notificação e contagem no título
  await p.click('role=tab[name="Atendimento"]'); await p.waitForTimeout(300);
  await p.evaluate(() => {
    window.__notas = [];
    window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } constructor(t) { window.__notas.push(t); } };
  });
  await p.click('#avisos-crm'); await p.waitForTimeout(300);
  ok('botão de avisos liga e fica salvo', (await p.textContent('#avisos-crm')) === 'Avisos ligados' && (await p.evaluate(() => localStorage.getItem('pp_avisos_crm'))) === '1');
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  sql("insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('00000000-0000-4000-8000-000000000011','agenda','Cartão novo para o aviso','IA')");
  await p.waitForTimeout(17000);
  const titulo = await p.title(); const notas = await p.evaluate(() => window.__notas);
  ok('aba escondida recebe aviso (título e notificação)', titulo.startsWith('(1)') && notas.length === 1, `${titulo} | ${JSON.stringify(notas)}`);
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(300);
  ok('voltar para a aba limpa a contagem', !(await p.title()).startsWith('('));
  await p.goto(B + '/configuracoes'); ok('secretária não abre Configurações', !p.url().endsWith('/configuracoes'));
  await ctx.close();

  // ---------- Só leitura (crm.ver) ----------
  sql(`insert into painel_usuarios (email, nome) values ('semacesso@teste.local', 'Leitor Teste') on conflict do nothing;
       insert into painel_vinculos (usuario_id, empresa_id, nivel, permissoes) select id, 'teste', 'membro', array['crm.ver'] from painel_usuarios where email='semacesso@teste.local' on conflict do nothing;`);
  ({ ctx, p } = await nova());
  await entrar(p, 'semacesso@teste.local');
  ok('só leitura vê o quadro sem botões de edição', p.url().endsWith('/crm') && (await p.locator('article').count()) > 0
    && (await p.locator('button:has-text("Novo atendimento")').count()) === 0 && (await p.locator('article button:has-text("Assumir")').count()) === 0);
  await p.locator('article').first().locator('button').first().click(); await p.waitForTimeout(800);
  ok('só leitura: detalhe sem nota e com campos travados', (await p.locator('#nova-nota').count()) === 0 && (await p.locator('#det-etapa').isDisabled()));
  await p.keyboard.press('Escape');
  await p.click('role=tab[name="Comercial"]'); await p.waitForTimeout(1000);
  ok('só leitura: funil sem Nova oportunidade', (await p.locator('button:has-text("Nova oportunidade")').count()) === 0);
  await ctx.close();
  sql(`delete from painel_vinculos where usuario_id in (select id from painel_usuarios where email='semacesso@teste.local');
       delete from painel_usuarios where email='semacesso@teste.local';`);

  // ---------- Admin (gestor): Configurações do CRM ----------
  ({ ctx, p } = await nova());
  await entrar(p, 'gestor@teste.local'); await p.goto(B + '/configuracoes'); await p.waitForTimeout(800);
  ok('admin abre Configurações do CRM', (await p.locator('h1', { hasText: 'Configurações do CRM' }).count()) === 1);
  await p.fill('[id="etapa-aguardando"]', 'Na fila'); await p.click('button:has-text("Salvar nomes")'); await p.waitForTimeout(1200);
  ok('renomear etapa do atendimento', sql("select valor->>'aguardando' from crm_config where chave='etapas_atendimento'") === 'Na fila');
  await p.fill('#as-novo-nome', 'Laudos'); await p.selectOption('#as-novo-icone', 'doc'); await p.fill('#as-novo-ordem', '99'); await p.fill('#as-novo-palavras', 'laudo, relatório');
  await p.click('form[aria-label="Novo assunto"] button:has-text("Criar")'); await p.waitForTimeout(1200);
  ok('criar assunto', sql("select nome || '|' || icone || '|' || palavras from crm_topicos where id='laudos'") === 'Laudos|doc|laudo, relatório');
  await p.locator('form[aria-label="Assunto Receita"] button[aria-label="Arquivar"]').click();
  await p.locator('form[aria-label="Assunto Receita"] button:has-text("Arquivar")').click(); await p.waitForTimeout(1200);
  ok('assunto com atendimento aberto não arquiva', ((await p.locator('form[aria-label="Assunto Receita"] [role=alert]').first().textContent()) || '').includes('atendimento(s) aberto(s)')
    && sql("select arquivado from crm_topicos where id='receita'") === 'f');
  await p.fill('#et-nova-nome', 'Retorno agendado'); await p.fill('#et-nova-ordem', '7'); await p.fill('#et-nova-gatilho', 'IA marca retorno');
  await p.click('form[aria-label="Nova etapa"] button:has-text("Criar")'); await p.waitForTimeout(1200);
  ok('criar etapa do funil', sql("select tipo || '|' || gatilho from crm_etapas where id='retorno_agendado'") === 'aberta|IA marca retorno');
  await p.screenshot({ path: out + '13_configuracoes.png', fullPage: true });
  await p.goto(B + '/crm'); await p.waitForTimeout(800);
  ok('assunto novo vira coluna e nome novo da etapa aparece', (await p.locator('section[aria-label="Laudos"]').count()) === 1 && (await p.locator('text=Na fila').count()) >= 1);
  await p.click('role=tab[name="Comercial"]'); await p.waitForTimeout(1200);
  await p.locator('article', { hasText: 'Primeira consulta' }).click(); await p.click('text=Arquivar oportunidade'); await p.click('aside button:has-text("Arquivar"):not(:has-text("oportunidade"))'); await p.waitForTimeout(1500);
  ok('admin arquiva oportunidade', sql("select arquivado from oportunidades where interesse='Primeira consulta'") === 't');
  await ctx.close();

  // ---------- API e MCP: ferramentas da IA ----------
  const chave = 'teste-ia-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Sara teste', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm'])`);
  const api = (caminho, init = {}) => fetch(B + caminho, { ...init, headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json', ...(init.headers || {}) } })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  let r = await api('/api/v1/ficha?telefone=(47)%2099000-0013');
  const f = r.json;
  ok('ficha pelo telefone (com o 9 a mais)', r.status === 200 && f.encontrado && f.contatos[0].nome === 'Jorge Ficticio', JSON.stringify(f).slice(0, 200));
  ok('ficha: CPF só com o final, atendimentos abertos e recentes, etapas do funil',
    f.contatos[0].cpf_final === '344' && !JSON.stringify(f).includes('11122233344') && f.atendimentos_abertos.length >= 1
    && f.atendimentos_recentes.some((a) => a.resumo.startsWith('Mandou resultado')) && f.etapas_funil.length >= 3);
  r = await api('/api/v1/ficha?telefone=5547911112222');
  ok('ficha de telefone desconhecido', r.status === 200 && r.json.encontrado === false && r.json.etapas_funil.length >= 3);
  r = await api('/api/v1/ficha?telefone=abc'); ok('ficha recusa telefone inválido', r.status === 400);
  const aberta = sql("select id from crm_etapas where tipo='aberta' and not arquivado order by ordem limit 1");
  const segunda = sql("select id from crm_etapas where tipo='aberta' and not arquivado order by ordem offset 1 limit 1");
  r = await api('/api/v1/funil', { method: 'POST', body: JSON.stringify({ telefone: '5547911112222', nome: 'Lead Ficticio', etapa_id: aberta, interesse: 'Consulta TEA' }) });
  ok('funil: cria contato e oportunidade', r.status === 200 && r.json.criou === true
    && sql("select c.nome || '|' || o.etapa_id from oportunidades o join contatos c on c.id=o.contato_id where c.telefone='5547911112222'") === `Lead Ficticio|${aberta}`);
  r = await api('/api/v1/funil', { method: 'POST', body: JSON.stringify({ telefone: '47 91111-2222', etapa_id: segunda, valor: 800 }) });
  ok('funil: segunda chamada move a mesma oportunidade', r.status === 200 && r.json.criou === false
    && sql("select count(*) || '|' || max(o.etapa_id) || '|' || max(o.valor) || '|' || max(o.interesse) from oportunidades o join contatos c on c.id=o.contato_id where c.telefone='5547911112222'") === `1|${segunda}|800.00|Consulta TEA`);
  ok('funil: auditoria da chave', Number(sql("select count(*) from painel_auditoria p join api_chaves k on k.id=p.chave_id where k.nome='Sara teste'")) >= 3);
  r = await api('/api/v1/funil', { method: 'POST', body: JSON.stringify({ telefone: '5547911112222', etapa_id: 'nao_existe' }) });
  ok('funil: etapa inexistente é recusada', r.status === 400);
  const mcp = (body) => api('/api/mcp', { method: 'POST', body: JSON.stringify(body) });
  r = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const nomes = r.json.result.tools.map((t) => t.name);
  ok('MCP lista as ferramentas da IA', nomes.includes('ficha_do_contato') && nomes.includes('mover_no_funil'));
  r = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ficha_do_contato', arguments: { telefone: '5547911112222' } } });
  const fm = JSON.parse(r.json.result.content[0].text);
  ok('MCP ficha_do_contato', fm.encontrado && fm.oportunidades[0].etapa_id === segunda && fm.oportunidades[0].valor === 800);
  r = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mover_no_funil', arguments: { telefone: '5547911112222', etapa_id: etapaGanho } } });
  ok('MCP mover_no_funil', !r.json.result.isError && sql("select o.etapa_id from oportunidades o join contatos c on c.id=o.contato_id where c.telefone='5547911112222'") === etapaGanho);
  // Chave só de leitura não move
  const leitura = 'teste-leitura-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Leitura teste', '${crypto.createHash('sha256').update(leitura).digest('hex')}', array['leitura'])`);
  r = await fetch(B + '/api/v1/funil', { method: 'POST', headers: { authorization: 'Bearer ' + leitura, 'content-type': 'application/json' }, body: JSON.stringify({ telefone: '5547911112222', etapa_id: aberta }) });
  ok('chave só de leitura não mexe no funil', r.status === 403);

  ok('sem erro no console', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
