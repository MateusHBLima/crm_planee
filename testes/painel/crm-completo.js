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

  // Acompanhamento de protocolo é recurso da empresa (29/10): a empresa de teste tem, como a clínica.
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['protocolos.ver'])) where id = 'teste'`);

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
  await p.click('[data-menu-crm]'); await p.click('#avisos-crm'); await p.waitForTimeout(300);
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

  // ---------- Admin (gestor): sem Configurações nem Registro (13/10: só a Planee) ----------
  ({ ctx, p } = await nova());
  await entrar(p, 'gestor@teste.local');
  const navG = await p.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()));
  ok('admin não vê Configurações nem Registro no menu', !navG.includes('Configurações') && !navG.includes('Registro') && navG.includes('Equipe'), navG.join(','));
  await p.goto(B + '/configuracoes'); await p.waitForTimeout(500);
  ok('admin não abre Configurações por URL', !p.url().endsWith('/configuracoes'), p.url());
  await p.goto(B + '/crm'); await p.waitForTimeout(800);
  await p.click('role=tab[name="Comercial"]'); await p.waitForTimeout(1200);
  await p.locator('article', { hasText: 'Primeira consulta' }).click(); await p.click('text=Arquivar oportunidade'); await p.click('aside button:has-text("Arquivar"):not(:has-text("oportunidade"))'); await p.waitForTimeout(1500);
  ok('admin arquiva oportunidade', sql("select arquivado from oportunidades where interesse='Primeira consulta'") === 't');
  await ctx.close();

  // ---------- Planee (master): Configurações do CRM e etapas do funil comercial ----------
  ({ ctx, p } = await nova());
  await entrar(p, 'planee@teste.local');
  if (await p.locator('#trocar-empresa').count()) { await Promise.all([p.waitForURL(/\/(crm|inbox)$/), p.selectOption('#trocar-empresa', 'teste')]).catch(() => undefined); }
  await p.goto(B + '/configuracoes'); await p.waitForTimeout(1000);
  ok('Planee abre Configurações do CRM', (await p.locator('h1', { hasText: 'Configurações do CRM' }).count()) === 1);
  await p.fill('[id="etapa-aguardando"]', 'Na fila'); await p.click('button:has-text("Salvar nomes")'); await p.waitForTimeout(1200);
  ok('renomear etapa do atendimento', sql("select valor->>'aguardando' from crm_config where chave='etapas_atendimento'") === 'Na fila');
  await p.fill('#as-novo-nome', 'Laudos'); await p.selectOption('#as-novo-icone', 'doc'); await p.fill('#as-novo-ordem', '99'); await p.fill('#as-novo-palavras', 'laudo, relatório');
  await p.click('form[aria-label="Novo assunto"] button:has-text("Criar")'); await p.waitForTimeout(1200);
  ok('criar assunto', sql("select nome || '|' || icone || '|' || palavras from crm_topicos where id='laudos'") === 'Laudos|doc|laudo, relatório');
  await p.locator('form[aria-label="Assunto Receita"] button[aria-label="Arquivar"]').click();
  await p.locator('form[aria-label="Assunto Receita"] button:has-text("Arquivar")').click(); await p.waitForTimeout(1200);
  ok('assunto com atendimento aberto não arquiva', ((await p.locator('form[aria-label="Assunto Receita"] [role=alert]').first().textContent()) || '').includes('atendimento(s) aberto(s)')
    && sql("select arquivado from crm_topicos where id='receita'") === 'f');
  await p.screenshot({ path: out + '13_configuracoes.png', fullPage: true });
  ok('Planee vê o funil comercial em Configurações', (await p.locator('#cfg-funil').count()) === 1);
  await p.fill('#et-nova-nome', 'Retorno agendado'); await p.fill('#et-nova-ordem', '7'); await p.fill('#et-nova-gatilho', 'IA marca retorno');
  await p.click('form[aria-label="Nova etapa"] button:has-text("Criar")'); await p.waitForTimeout(1200);
  ok('Planee cria etapa do funil', sql("select tipo || '|' || gatilho from crm_etapas where id='retorno_agendado'") === 'aberta|IA marca retorno');
  await p.goto(B + '/crm'); await p.waitForTimeout(1200);
  ok('assunto novo vira coluna e nome novo da etapa aparece', (await p.locator('section[aria-label="Laudos"]').count()) === 1 && (await p.locator('text=Na fila').count()) >= 1);
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

  // ---------- Prazos: cores de atraso e o mais antigo em cima ----------
  const sexames = `insert into atendimentos (topico_id, etapa, resumo, aberto_por, aberto_em, atualizado_em) values
    ('exames', 'aguardando', 'PRAZO-A cinco minutos', 'IA', now() - interval '5 minutes', now() - interval '5 minutes'),
    ('exames', 'aguardando', 'PRAZO-B treze horas', 'IA', now() - interval '13 hours', now() - interval '13 hours'),
    ('exames', 'aguardando', 'PRAZO-C vinte e cinco horas', 'IA', now() - interval '25 hours', now() - interval '25 hours'),
    ('exames', 'pendente', 'PRAZO-D pendente parado', 'Amanda Teste', now() - interval '50 hours', now() - interval '30 hours'),
    ('exames', 'em_atendimento', 'PRAZO-E em atendimento antigo', 'IA', now() - interval '3 hours', now() - interval '3 hours'),
    ('exames', 'em_atendimento', 'PRAZO-F em atendimento novo', 'IA', now() - interval '1 hour', now() - interval '1 hour');`;
  sql(sexames);
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(1200);
  const col = p.locator('section[aria-label="Exames"] article');
  const textos = (await col.allTextContents()).map((t) => (t.match(/PRAZO-([A-F])/) || ['', ''])[1]).filter(Boolean);
  ok('mais antigo em cima: aguardando e em atendimento por chegada (C, B, E, F, A), pendente depois (D)', textos.join('') === 'CBEFAD', textos.join(''));
  const nivel = (k) => p.locator('section[aria-label="Exames"] article', { hasText: k }).getAttribute('data-atraso');
  ok('aguardando há 25 h fica vermelho (passou de 1 dia)', (await nivel('PRAZO-C')) === 'vermelho');
  ok('aguardando há 13 h fica amarelo (passou de 12 h)', (await nivel('PRAZO-B')) === 'amarelo');
  ok('aguardando há 5 min fica normal', (await nivel('PRAZO-A')) === null);
  ok('pendente parado há 30 h fica amarelo', (await nivel('PRAZO-D')) === 'amarelo');
  ok('em atendimento não muda de cor', (await nivel('PRAZO-E')) === null);
  ok('selo "Atrasado · há …" no cartão vermelho', ((await p.locator('section[aria-label="Exames"] article', { hasText: 'PRAZO-C' }).textContent()) || '').includes('Atrasado · há'));
  const fila = ((await p.locator('[data-fila]').textContent()) || '').replace(/\s+/g, ' ');
  ok('topo mostra o mais antigo aguardando e os atrasados', fila.includes('Mais antigo aguardando: há') && (await p.locator('[data-fila] [data-contagem="vermelho"]').count()) === 1, fila);
  await p.screenshot({ path: out + '14_quadro_prazos.png', fullPage: true });
  await ctx.close();
  // Prazos em Configurações (Planee): aguardando 1.560/1.800 min (26 h/30 h) → o de 25 h volta ao normal
  ({ ctx, p } = await nova());
  await entrar(p, 'planee@teste.local');
  if (await p.locator('#trocar-empresa').count()) { await Promise.all([p.waitForURL(/\/(crm|inbox)$/), p.selectOption('#trocar-empresa', 'teste')]).catch(() => undefined); }
  await p.goto(B + '/configuracoes'); await p.waitForTimeout(800);
  ok('Configurações mostra os prazos padrão (12 h e 1 dia)', (await p.inputValue('#prazo-ag_am')) === '720' && (await p.inputValue('#prazo-ag_vm')) === '1440'
    && (await p.inputValue('#prazo-pd_am')) === '24' && (await p.inputValue('#prazo-pd_vm')) === '48');
  await p.fill('#prazo-ag_am', '1560'); await p.fill('#prazo-ag_vm', '1500'); await p.click('button:has-text("Salvar prazos")'); await p.waitForTimeout(1000);
  ok('vermelho antes do amarelo é recusado', ((await p.locator('section[aria-labelledby="cfg-prazos"] [role=alert]').textContent()) || '').includes('vermelho precisa vir depois'));
  await p.fill('#prazo-ag_vm', '1800'); await p.click('button:has-text("Salvar prazos")'); await p.waitForTimeout(1000);
  ok('prazos salvos pela API (com auditoria)', sql("select valor->'aguardando'->>'amarelo' || '/' || (valor->'aguardando'->>'vermelho') || '/' || (valor->'pendente'->>'amarelo') from crm_config where chave='prazos_atendimento'") === '1560/1800/1440'
    && sql("select count(*) from painel_auditoria where alvo_id = 'prazos_atendimento'") !== '0');
  await p.goto(B + '/crm'); await p.waitForTimeout(1200);
  ok('com 26 h/30 h, o de 25 h sai do vermelho', (await nivel('PRAZO-C')) === null);
  await ctx.close();
  sql("delete from crm_config where chave='prazos_atendimento'; update atendimentos set arquivado = true where resumo like 'PRAZO-%'");

  // ---------- Serviços (agendamentos), pagamentos com comprovante e alerta de suspeita (migração 013) ----------
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const TELP = '5547966660001';
  r = await api('/api/v1/servicos/registrar', { method: 'POST', body: JSON.stringify({ telefone: TELP, nome: 'Paula Pagamento Ficticia', tipo: 'Consulta',
    descricao: 'Primeira consulta', inicio: '2026-10-14T15:00:00-03:00', profissional: 'Dr. Ficticio', local: 'Online', valor: 450, sistema: 'Feegow', codigo_externo: 'FG-9001',
    detalhes: { procedimento: 'Consulta neurologia' } }) });
  const servId = r.json && r.json.id;
  ok('IA registra o agendamento (cria o contato)', r.status === 200 && r.json.criado === true && sql(`select c.nome || '|' || s.sistema || '|' || s.valor from servicos s join contatos c on c.id = s.contato_id where s.codigo_externo = 'FG-9001'`) === 'Paula Pagamento Ficticia|feegow|450.00', JSON.stringify(r.json));
  r = await api('/api/v1/servicos/registrar', { method: 'POST', body: JSON.stringify({ telefone: TELP, sistema: 'feegow', codigo_externo: 'FG-9001', situacao: 'confirmado' }) });
  ok('registrar de novo pelo código atualiza (não duplica)', r.status === 200 && r.json.criado === false && r.json.id === servId
    && sql("select count(*) || '|' || min(situacao) from servicos where codigo_externo = 'FG-9001'") === '1|confirmado');
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELP, valor: 'abc' }) });
  ok('pagamento com valor inválido é recusado', r.status === 400);
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELP, arquivo: { nome: 'x.pdf', mime: 'application/pdf', base64: PNG } }) });
  ok('arquivo com tipo trocado é recusado', r.status === 400 && String(r.json.erro).includes('não é do tipo'), JSON.stringify(r.json));
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELP, servico: { sistema: 'feegow', codigo_externo: 'FG-9001' }, valor: 200,
    pago_em: '2026-10-05T10:12:00-03:00', forma: 'pix', descricao: 'Sinal da consulta', arquivo: { nome: 'comprovante.png', mime: 'image/png', base64: PNG } }) });
  const pagId = r.json && r.json.id;
  ok('IA anexa o comprovante ao agendamento', r.status === 201 && r.json.servico_id === servId && !r.json.alerta_atendimento_id
    && sql(`select p.arquivo_mime || '|' || octet_length(a.dados) from pagamentos p join pagamentos_arquivos a on a.pagamento_id = p.id where p.id = '${pagId}'`) === 'image/png|' + Buffer.from(PNG, 'base64').length, JSON.stringify(r.json));
  const arqR = await fetch(B + `/api/v1/pagamentos/${pagId}/arquivo`, { headers: { authorization: 'Bearer ' + chave } });
  ok('API devolve o arquivo do comprovante', arqR.status === 200 && arqR.headers.get('content-type') === 'image/png' && Buffer.from(await arqR.arrayBuffer()).equals(Buffer.from(PNG, 'base64')));
  const antesAlerta = Number(sql("select count(*) from atendimentos where alerta"));
  r = await api(`/api/v1/pagamentos/${pagId}`, { method: 'PATCH', body: JSON.stringify({ analise: { resultado: 'suspeito', motivos: ['Valor do comprovante diferente do sinal', 'Recebedor não é a clínica'] } }) });
  ok('análise "suspeito" abre o cartão de alerta', r.status === 200 && r.json.alerta_aberto && Number(sql("select count(*) from atendimentos where alerta")) === antesAlerta + 1
    && sql(`select etapa || '|' || topico_id || '|' || (resumo like 'Comprovante suspeito de R$ 200,00 (Sinal da consulta): Valor do comprovante diferente do sinal; Recebedor não é a clínica%') from atendimentos where id = (select alerta_atendimento_id from pagamentos where id = '${pagId}')`) === 'aguardando|valores|true', JSON.stringify(r.json));
  r = await api(`/api/v1/pagamentos/${pagId}`, { method: 'PATCH', body: JSON.stringify({ analise: { resultado: 'suspeito', motivos: ['de novo'] } }) });
  ok('repetir a análise não abre outro cartão', r.status === 200 && Number(sql("select count(*) from atendimentos where alerta")) === antesAlerta + 1);
  r = await api('/api/v1/ficha?telefone=' + TELP);
  ok('ficha da IA traz agendamentos e pagamentos', r.status === 200 && r.json.servicos.length === 1 && r.json.pagamentos.length === 1 && r.json.pagamentos[0].analise === 'suspeito');
  r = await api(`/api/v1/pagamentos/${pagId}`, { method: 'PATCH', body: JSON.stringify({ conferido_em: '2026-10-05' }) });
  ok('IA não marca conferido', r.status === 400);

  // Tela: alerta vermelho no quadro; ficha com histórico, agendamento, comprovante e Conferir (admin com o módulo)
  sql("update empresas set modulos = array(select distinct unnest(modulos || array['pagamentos.ver','pagamentos.conferir'])) where id = 'teste'");
  ({ ctx, p } = await nova());
  await entrar(p, 'gestor@teste.local'); await p.waitForTimeout(1200);
  const cartaoAlerta = p.locator('article', { hasText: 'Comprovante suspeito de R$ 200,00' });
  ok('cartão de alerta vermelho no quadro desde que abre', (await cartaoAlerta.getAttribute('data-atraso')) === 'vermelho' && ((await cartaoAlerta.textContent()) || '').includes('Alerta · '));
  await p.click('button[role=tab]:has-text("Contatos")'); await p.waitForTimeout(800);
  await p.locator('button', { hasText: 'Paula Pagamento Ficticia' }).first().click(); await p.waitForTimeout(1500);
  const hist = p.locator('section[aria-label="Histórico do paciente"]');
  const tHist = ((await hist.textContent()) || '').replace(/\s+/g, ' ');
  ok('histórico mostra agendamento, comprovante e suspeita', tHist.includes('Consulta agendado para 14/10') && tHist.includes('Comprovante recebido') && tHist.includes('Comprovante suspeito:')
    && tHist.includes('1 suspeito'), tHist.slice(0, 300));
  await hist.locator('button', { hasText: 'Consulta agendado' }).first().click(); await p.waitForTimeout(1200);
  const det = p.locator('aside[aria-label^="Consulta"]');
  const tDet = ((await det.textContent()) || '').replace(/\s+/g, ' ');
  ok('detalhe do agendamento com ID Feegow, valor e o comprovante', tDet.includes('ID Feegow') && tDet.includes('FG-9001') && tDet.includes('Confirmado') && tDet.includes('Suspeito')
    && tDet.includes('de novo') && tDet.includes('procedimento'), tDet.slice(0, 300));
  const href = await det.locator('a', { hasText: 'Ver comprovante' }).getAttribute('href');
  const arqTela = await p.evaluate(async (u) => { const x = await fetch(u); return x.status + '|' + x.headers.get('content-type'); }, href);
  ok('comprovante abre pela tela', arqTela === '200|image/png', arqTela);
  await p.screenshot({ path: out + '15_agendamento_comprovante.png' });
  await det.locator('button', { hasText: 'Conferir' }).click(); await p.waitForTimeout(1200);
  ok('Conferir grava quem e quando', sql(`select conferido_por || '|' || (conferido_em is not null) from pagamentos where id = '${pagId}'`) === 'Gestor Teste|true'
    && ((await det.textContent()) || '').includes('Conferido por Gestor Teste'));
  await det.locator('button[aria-label="Fechar"]').click(); await p.waitForTimeout(400);
  // Registrar pagamento pela tela, com arquivo
  await hist.locator('button', { hasText: 'Registrar pagamento' }).click();
  const fp = p.locator('aside[aria-label="Registrar pagamento"]');
  await fp.locator('#pg-servico').selectOption(servId); await fp.locator('#pg-valor').fill('250,00'); await fp.locator('#pg-data').fill('2026-10-05');
  await fp.locator('#pg-descricao').fill('Restante da consulta');
  await fp.locator('#pg-arquivo').setInputFiles({ name: 'restante.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await fp.locator('button[type=submit]').click(); await p.waitForTimeout(1500);
  ok('pagamento registrado pela tela, com arquivo e no histórico', sql(`select p.valor || '|' || p.criado_por || '|' || (a.pagamento_id is not null) from pagamentos p left join pagamentos_arquivos a on a.pagamento_id = p.id where p.descricao = 'Restante da consulta'`) === '250.00|Gestor Teste|true'
    && ((await hist.textContent()) || '').includes('R$ 250,00'));
  await p.screenshot({ path: out + '16_historico_paciente.png', fullPage: true });
  await ctx.close();
  // Sem o módulo/permissão: histórico só com atendimentos e notas; arquivo recusado
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(800);
  await p.click('button[role=tab]:has-text("Contatos")'); await p.waitForTimeout(800);
  await p.locator('button', { hasText: 'Paula Pagamento Ficticia' }).first().click(); await p.waitForTimeout(1500);
  const tA = (await p.locator('section[aria-label="Histórico do paciente"]').textContent()) || '';
  const arqA = (await p.request.get(B + href)).status();
  ok('sem pagamentos.ver: não vê agendamento nem comprovante (o cartão de alerta continua no quadro para todos)',
    !tA.includes('Consulta agendado') && !tA.includes('Comprovante recebido') && arqA === 403, `${arqA} ${tA.slice(0, 120)}`);
  await ctx.close();

  // ---------- Dados do comprovante, repetido e ID Pix reaproveitado (migração 014) ----------
  const TELQ = '5547966660002'; const TELR = '5547966660003';
  const E2E = 'E00000000202610051012ABCDEF12345';
  await api('/api/v1/servicos/registrar', { method: 'POST', body: JSON.stringify({ telefone: TELQ, nome: 'Quesia Pix Ficticia', tipo: 'Consulta', inicio: '2026-10-20T10:00:00-03:00', sistema: 'feegow', codigo_externo: 'FG-9002' }) });
  await api('/api/v1/servicos/registrar', { method: 'POST', body: JSON.stringify({ telefone: TELQ, tipo: 'Retorno', inicio: '2026-11-20T10:00:00-03:00', sistema: 'feegow', codigo_externo: 'FG-9003' }) });
  const corpoQ = { telefone: TELQ, servico: { sistema: 'feegow', codigo_externo: 'FG-9002' }, valor: 180, forma: 'pix', descricao: 'Sinal Quesia', wamid: 'wamid.Q1',
    comprovante: { pagador: 'Quesia Pix Ficticia', banco: 'Banco Ficticio', id_pix: ' ' + E2E.toLowerCase() + ' ', recebedor: 'Clinica Ficticia', recebedor_documento: '11.222.333/0001-81', emitido_em: '2026-10-05T10:12:00-03:00' } };
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify(corpoQ) });
  const pagQ = r.json && r.json.id;
  ok('comprovante com os dados escritos nele (ID Pix em maiúsculas, CNPJ só números)', r.status === 201 && !r.json.alerta_atendimento_id
    && sql(`select pagador || '|' || banco || '|' || pix_e2e || '|' || recebedor_documento || '|' || (comprovante_em = '2026-10-05T13:12:00Z') || '|' || coalesce(analise, '-') from pagamentos where id = '${pagQ}'`)
      === `Quesia Pix Ficticia|Banco Ficticio|${E2E}|11222333000181|true|-`, JSON.stringify(r.json));
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify(corpoQ) });
  ok('mesma mensagem (wamid) de novo devolve o mesmo pagamento', r.json && r.json.repetido === true && r.json.id === pagQ && sql("select count(*) from pagamentos where descricao = 'Sinal Quesia'") === '1', JSON.stringify(r.json));
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ ...corpoQ, wamid: 'wamid.Q2', arquivo: { nome: 'q.png', mime: 'image/png', base64: PNG } }) });
  ok('mesmo ID Pix, mesmo contato e agendamento: não duplica e anexa o arquivo que faltava', r.json && r.json.repetido === true && r.json.id === pagQ
    && sql(`select count(*) || '|' || bool_and(a.pagamento_id is not null) from pagamentos p left join pagamentos_arquivos a on a.pagamento_id = p.id where p.descricao = 'Sinal Quesia'`) === '1|true', JSON.stringify(r.json));
  const alertasAntes = Number(sql('select count(*) from atendimentos where alerta'));
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELR, nome: 'Rui Reuso Ficticio', valor: 180, wamid: 'wamid.R1', comprovante: { id_pix: E2E } }) });
  const pagR = r.json && r.json.id;
  ok('mesmo ID Pix em outro contato: suspeito e alerta aberto', r.status === 201 && r.json.alerta_atendimento_id && Number(sql('select count(*) from atendimentos where alerta')) === alertasAntes + 1
    && sql(`select analise || '|' || (analise_motivos::text like '%ID Pix repetido%de outro contato%') from pagamentos where id = '${pagR}'`) === 'suspeito|true', JSON.stringify(r.json));
  r = await api(`/api/v1/pagamentos/${pagR}`, { method: 'PATCH', body: JSON.stringify({ analise: { resultado: 'ok', motivos: [] } }) });
  ok('análise "ok" depois não apaga o ID Pix repetido', r.status === 200 && r.json.analise === 'suspeito' && JSON.stringify(r.json.analise_motivos).includes('ID Pix repetido'), JSON.stringify(r.json));
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELQ, servico: { sistema: 'feegow', codigo_externo: 'FG-9003' }, valor: 180, comprovante: { id_pix: E2E } }) });
  ok('mesmo ID Pix no mesmo contato, em outro agendamento: suspeito', r.status === 201 && Boolean(r.json.alerta_atendimento_id)
    && sql(`select analise_motivos::text like '%de outro agendamento%' from pagamentos where id = '${r.json.id}'`) === 't', JSON.stringify(r.json));
  r = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELQ, comprovante: { id_pix: 'E2E-com-traco!' } }) });
  const r2 = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELQ, comprovante: { recebedor_documento: '123' } }) });
  const r3 = await api('/api/v1/pagamentos', { method: 'POST', body: JSON.stringify({ telefone: TELQ, comprovante: { chave_pix: 'x' } }) });
  ok('dados do comprovante inválidos são recusados', r.status === 400 && r2.status === 400 && r3.status === 400, `${r.status} ${r2.status} ${r3.status}`);
  ({ ctx, p } = await nova());
  await entrar(p, 'gestor@teste.local'); await p.waitForTimeout(800);
  await p.click('button[role=tab]:has-text("Contatos")'); await p.waitForTimeout(800);
  await p.locator('button', { hasText: 'Quesia Pix Ficticia' }).first().click(); await p.waitForTimeout(1500);
  const histQ = p.locator('section[aria-label="Histórico do paciente"]');
  await histQ.locator('button', { hasText: 'Consulta agendado' }).first().click(); await p.waitForTimeout(1200);
  const tQ = ((await p.locator('aside[aria-label^="Consulta"]').textContent()) || '').replace(/\s+/g, ' ');
  ok('detalhe mostra pagador, recebedor com CNPJ e ID Pix', tQ.includes('Quesia Pix Ficticia · Banco Ficticio') && tQ.includes('Clinica Ficticia · 11.222.333/0001-81') && tQ.includes(E2E), tQ.slice(0, 400));
  await p.screenshot({ path: out + '17_dados_comprovante.png' });
  await ctx.close();

  // ---------- Dias sem marcação pela IA (14/10) ----------
  sql(`insert into crm_config (chave, valor) values ('agenda_profissionais', '[{"id":1,"nome":"Dr. Ficticio"},{"id":3,"nome":"Dra. Ficticia"}]')
       on conflict (chave) do update set valor = excluded.valor;
       insert into crm_config (chave, valor) values ('agenda_fechada', '[{"prof":1,"data":"2020-01-02","motivo":"passado"}]')
       on conflict (chave) do update set valor = excluded.valor;`);
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(800);
  await p.click('[data-menu-crm]'); await p.click('[data-dias-sem-ia]'); await p.locator('#dia-data').waitFor({ timeout: 8000 });
  ok('Dias sem IA: aviso e dia passado escondido', ((await p.textContent('[data-aviso-dias]')) || '').includes('não desmarca quem já está marcado')
    && (await p.locator('[data-dia-fechado]').count()) === 0);
  const diaFut = new Date(Date.now() + 9 * 86400_000).toISOString().slice(0, 10);
  await p.selectOption('#dia-prof', '1'); await p.fill('#dia-data', diaFut); await p.fill('#dia-motivo', 'Atende em outra cidade');
  await p.click('form[aria-label="Fechar um dia"] button[type=submit]'); await p.waitForTimeout(1500);
  ok('fechar o dia grava a lista na config (sem o dia passado) e audita', sql("select valor::text from crm_config where chave='agenda_fechada'") === `[{"data": "${diaFut}", "prof": 1, "motivo": "Atende em outra cidade"}]`
    && (await p.locator(`[data-dia-fechado="${diaFut}"]`).count()) === 1 && sql("select count(*) from painel_auditoria where alvo_id = 'agenda_fechada'") !== '0',
    sql("select valor::text from crm_config where chave='agenda_fechada'"));
  await p.selectOption('#dia-prof', ''); await p.fill('#dia-data', diaFut); await p.click('form[aria-label="Fechar um dia"] button[type=submit]'); await p.waitForTimeout(1500);
  ok('dia para todos os profissionais fica sem "prof"', sql("select jsonb_array_length(valor) || '|' || (select count(*) from jsonb_array_elements(valor) e where not e ? 'prof') from crm_config where chave='agenda_fechada'") === '2|1');
  await p.locator(`[data-dia-fechado="${diaFut}"]`).first().locator('button:has-text("Reabrir")').click(); await p.waitForTimeout(1500);
  ok('reabrir tira o dia da lista', sql("select jsonb_array_length(valor) from crm_config where chave='agenda_fechada'") === '1');
  await p.keyboard.press('Escape'); await ctx.close();
  sql(`insert into painel_usuarios (email, nome) values ('semacesso@teste.local', 'Leitor Teste') on conflict do nothing;
       insert into painel_vinculos (usuario_id, empresa_id, nivel, permissoes) select id, 'teste', 'membro', array['crm.ver'] from painel_usuarios where email='semacesso@teste.local' on conflict do nothing;`);
  ({ ctx, p } = await nova());
  await entrar(p, 'semacesso@teste.local'); await p.waitForTimeout(800);
  await p.click('[data-menu-crm]');
  ok('só leitura não vê "Dias sem IA"', p.url().endsWith('/crm') && (await p.locator('[data-dias-sem-ia]').count()) === 0);
  await ctx.close();
  sql(`delete from painel_vinculos where usuario_id in (select id from painel_usuarios where email='semacesso@teste.local');
       delete from painel_usuarios where email='semacesso@teste.local';
       delete from crm_config where chave in ('agenda_fechada', 'agenda_profissionais');`);

  // ---------- Esperando a equipe (14/10): aberto pela IA e sem resposta da equipe ----------
  const TELE = '5547955550001';
  const contE = sql(`insert into contatos (nome, telefone) values ('Ester Espera Ficticia', '${TELE}') returning id`);
  const cartE = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por, aberto_em) values ('${contE}', 'receita', 'ESPERA-1 pediu receita', 'IA', now() - interval '3 hours') returning id`);
  sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por, aberto_em) values ('${contE}', 'receita', 'ESPERA-2 aberto pela equipe', 'Amanda Teste', now() - interval '2 hours')`);
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(1200);
  const cardE = p.locator('article', { hasText: 'ESPERA-1' });
  ok('cartão da IA sem resposta da equipe tem o selo', (await cardE.locator('[data-esperando]').count()) === 1
    && (await p.locator('article', { hasText: 'ESPERA-2' }).locator('[data-esperando]').count()) === 0);
  await p.selectOption('[data-filtro-ver]', 'esperando'); await p.waitForTimeout(300);
  const textosE = await p.locator('article').allTextContents();
  ok('filtro "Esperando a equipe" mostra só os da IA sem resposta', textosE.some((t) => t.includes('ESPERA-1')) && !textosE.some((t) => t.includes('ESPERA-2')), String(textosE.length));
  // Uma coluna por vez (15/10): escolher o assunto deixa só a coluna dele no quadro.
  await p.selectOption('[data-filtro-ver]', ''); await p.waitForTimeout(200);
  await p.selectOption('[data-filtro-coluna]', 'receita'); await p.waitForTimeout(300);
  const secoes = await p.locator('section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter((n) => n !== 'Ficha do contato'));
  ok('filtro de coluna mostra só a coluna escolhida', secoes.length === 1 && secoes[0] === 'Receita' && (await p.locator('article', { hasText: 'ESPERA-1' }).count()) === 1, secoes.join(','));
  await p.selectOption('[data-filtro-coluna]', ''); await p.waitForTimeout(300);
  const secoesTodas = await p.locator('section[aria-label]').count();
  ok('"Todas as colunas" volta o quadro inteiro', (await p.locator('section[aria-label="Receita"]').count()) === 1 && secoesTodas > 2, String(secoesTodas));
  await cardE.getByRole('button', { name: 'Ester Espera Ficticia' }).click(); await p.locator('[data-abrir-inbox]').waitFor({ timeout: 5000 });
  ok('detalhe tem o link para a conversa na Inbox', (await p.getAttribute('[data-abrir-inbox]', 'href')) === `/inbox?tel=${TELE}`);
  await p.locator('[data-protocolo-cartao] button[data-situacao]').first().waitFor({ timeout: 8000 });
  ok('cartão do CRM tem os botões de protocolo do contato', (await p.locator('[data-protocolo-cartao] button[data-situacao]').count()) === 4
    && (await p.locator('[data-protocolo-cartao] [data-protocolo="nenhum"]').count()) === 1);
  await p.keyboard.press('Escape'); await ctx.close();
  // A equipe responde pelo celular (sem o 9, como a Meta manda): sai da lista
  sql(`insert into wa_conversas (numero_id, wa_id, ultima_em) values ('100000000000001', '554755550001', now()) on conflict do nothing;
       insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em)
       values ('100000000000001', '554755550001', 'wamid.ESPERA1', 'saida', 'celular', 'text', 'Oi, já vejo sua receita', now() - interval '1 hour');`);
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(1200);
  ok('resposta da equipe pelo celular tira o selo', (await p.locator('article', { hasText: 'ESPERA-1' }).locator('[data-esperando]').count()) === 0);
  // "Equipe já respondeu, falta finalizar" (14/10): os dois cartões em aberto tiveram resposta depois que abriram.
  ok('cartões respondidos têm o selo "equipe respondeu"', (await p.locator('article', { hasText: 'ESPERA-1' }).locator('[data-respondido]').count()) === 1
    && (await p.locator('article', { hasText: 'ESPERA-2' }).locator('[data-respondido]').count()) === 1);
  await p.selectOption('[data-filtro-ver]', 'respondido'); await p.waitForTimeout(300);
  const textosR = await p.locator('article').allTextContents();
  ok('filtro "Equipe já respondeu, falta finalizar" mostra os respondidos', textosR.length === 2 && textosR.every((t) => t.includes('ESPERA-')), String(textosR.length));
  await ctx.close();

  // ---------- Inbox (14/10): Finalizar pela conversa e marcar como não lida ----------
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(600);
  await p.goto(B + `/inbox?tel=${TELE}`); await p.locator('[data-finalizar-conversa]').waitFor({ timeout: 10000 });
  ok('Inbox mostra "Finalizar (2)" para os dois atendimentos em aberto do número', ((await p.textContent('[data-finalizar-conversa]')) || '').includes('Finalizar (2)'));
  await p.click('[data-finalizar-conversa]'); await p.locator('[data-lista-finalizar]').waitFor({ timeout: 5000 });
  await p.click(`[data-finalizar-um="${cartE}"]`); await p.waitForTimeout(1500);
  ok('finalizar pela conversa finaliza no CRM com quem clicou', sql(`select etapa || '|' || coalesce(responsavel, '') || '|' || (finalizado_em is not null) from atendimentos where id = '${cartE}'`) === 'finalizado|Amanda Teste|true'
    && ((await p.textContent('[data-finalizar-conversa]')) || '').trim() === 'Finalizar');
  // Protocolo direto da conversa (15/10): botão no cabeçalho, marca o contato dono do número.
  await p.click('[data-menu-mais]'); await p.click('[data-protocolo-conversa]'); await p.locator('[data-painel-protocolo] button[data-situacao="em_analise"]').waitFor({ timeout: 8000 });
  await p.click('[data-painel-protocolo] button[data-situacao="em_analise"]'); await p.waitForTimeout(1500);
  ok('marcar protocolo pela conversa grava no contato do número', sql(`select protocolo || '|' || protocolo_por from contatos where id = '${contE}'`) === 'em_analise|Amanda Teste'
    && (await p.locator('[data-painel-protocolo] button[data-situacao="em_analise"][aria-pressed="true"]').count()) === 1);
  // Cartões em aberto na lateral (22/10): botão no cabeçalho; cada cartão leva ao CRM com ele aberto.
  const abertosE = sql(`select id from atendimentos where contato_id = '${contE}' and etapa <> 'finalizado' and not arquivado order by aberto_em`).split('\n').filter(Boolean);
  ok('botão "Cartões" mostra quantos estão em aberto', ((await p.textContent('[data-cartoes-conversa]')) || '').trim() === `Cartões (${abertosE.length})`, ((await p.textContent('[data-cartoes-conversa]')) || ''));
  await p.click('[data-cartoes-conversa]'); await p.locator('[data-painel-cartoes] [data-abrir-cartao]').first().waitFor({ timeout: 8000 });
  const hrefs = await p.locator('[data-painel-cartoes] [data-abrir-cartao]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  ok('lateral lista só os cartões em aberto, com link para o CRM', hrefs.length === abertosE.length && abertosE.every((id) => hrefs.includes(`/crm?cartao=${id}`))
    && !hrefs.includes(`/crm?cartao=${cartE}`) && ((await p.textContent('[data-painel-cartoes]')) || '').includes('ESPERA-2'), hrefs.join(','));
  await p.screenshot({ path: out + '18d_inbox_cartoes.png' });
  await Promise.all([p.waitForURL(/\/crm\?cartao=/), p.click(`[data-painel-cartoes] [data-abrir-cartao="${abertosE[0]}"]`)]);
  await p.locator('[data-abrir-inbox]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('clicar no cartão abre o CRM com o cartão aberto', (await p.locator('[data-abrir-inbox]').count()) === 1 && ((await p.textContent('main')) || '').includes('ESPERA-2'));
  await p.goto(B + `/inbox?tel=${TELE}`); await p.locator('[data-menu-mais]').waitFor({ timeout: 10000 });
  sql(`update wa_conversas set nao_lidas = 0, lida_ate = now() where wa_id = '554755550001'`);
  await p.click('[data-menu-mais]'); await p.click('[data-nao-lida]'); await p.waitForTimeout(1200);
  ok('marcar como não lida volta a contar e fecha a conversa', sql(`select nao_lidas || '|' || (lida_ate is null) from wa_conversas where wa_id = '554755550001'`) === '1|true'
    && (await p.locator('[data-menu-mais]').count()) === 0);
  ok('"não lida" da equipe vai para a auditoria', sql(`select count(*) from central_auditoria a join painel_usuarios u on u.id = a.usuario_id
                    where a.acao = 'marcar_nao_lida' and u.email = 'amanda@teste.local'`) === '1');
  await p.click('[data-filtro-nao-lidas]'); await p.waitForTimeout(300);
  ok('filtro "Não lidas" mostra a conversa marcada', (await p.locator('button[data-wa="554755550001"]').count()) === 1);
  await p.screenshot({ path: out + '18b_inbox_finalizar_nao_lida.png' });
  await ctx.close();

  // ---------- Empresa sem acompanhamento de protocolo (29/10): nem a equipe nem a Planee veem ----------
  sql(`update empresas set modulos = array_remove(modulos, 'protocolos.ver') where id = 'teste'`);
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(800);
  ok('sem o recurso, Protocolos some do menu da equipe', (await p.locator('nav a[href="/protocolos"]').count()) === 0
    && (await p.locator('nav a[href="/crm"]').count()) === 1);
  await p.goto(B + '/protocolos'); await p.waitForTimeout(500);
  ok('sem o recurso, a tela Protocolos não abre (volta para a primeira tela)', !new URL(p.url()).pathname.startsWith('/protocolos')
    && (await p.locator('[data-filtro-protocolo]').count()) === 0, p.url());
  const cartSem = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${contE}', 'receita', 'SEM-PROTOCOLO pediu receita', 'IA') returning id`);
  await p.goto(B + `/crm?cartao=${cartSem}`); await p.locator('[data-abrir-inbox]').waitFor({ timeout: 10000 }); await p.waitForTimeout(800);
  ok('sem o recurso, o cartão não tem o bloco de protocolo', (await p.locator('[data-protocolo-cartao]').count()) === 0);
  const lerSem = (await p.request.get(B + '/api/painel/ler/protocolos')).status();
  ok('sem o recurso, a leitura dos protocolos recusa', lerSem === 403 || lerSem === 404, String(lerSem));
  await p.goto(B + '/inbox?tel=' + TELE); await p.waitForTimeout(1500);
  if (await p.locator('[data-menu-mais]').count()) await p.click('[data-menu-mais]');
  ok('sem o recurso, o menu Mais da conversa não tem Protocolo', (await p.locator('[data-protocolo-conversa]').count()) === 0
    && (await p.locator('[data-nao-lida]').count()) === 1);
  await ctx.close();
  sql(`update atendimentos set etapa = 'finalizado', finalizado_em = now() where id = '${cartSem}'`);
  ({ ctx, p } = await nova());
  await entrar(p, 'planee@teste.local');
  if (await p.locator('#trocar-empresa').count()) { await Promise.all([p.waitForURL(/\/(crm|inbox)$/), p.selectOption('#trocar-empresa', 'teste')]).catch(() => undefined); }
  await p.waitForTimeout(800);
  ok('sem o recurso, nem a Planee (master) vê Protocolos', (await p.locator('nav a[href="/protocolos"]').count()) === 0
    && (await p.locator('nav a[href="/crm"]').count()) === 1);
  await p.goto(B + '/equipe'); await p.waitForTimeout(800);
  ok('Equipe não lista o protocolo como permissão por pessoa', (await p.getByText('Acompanhamento de protocolo').count()) === 0);
  await ctx.close();
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['protocolos.ver'])) where id = 'teste'`);

  // ---------- Acompanhamento de protocolo (14/10) ----------
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(800);
  ok('Protocolos é uma tela do menu', (await p.locator('nav a[href="/protocolos"]').count()) === 1);
  await p.click('nav a[href="/protocolos"]'); await p.locator('[data-filtro-protocolo]').waitFor({ timeout: 8000 });
  await p.click('[data-novo-protocolo]'); await p.fill('#prot-busca', 'Ester Espera'); await p.click(`[data-escolher-contato="${contE}"]`);
  await p.selectOption('#prot-situacao', 'em_protocolo'); await p.fill('#prot-obs', 'Começou o protocolo injetável.');
  await p.click('form[aria-label="Colocar em protocolo"] button[type=submit]'); await p.waitForTimeout(1500);
  ok('colocar em protocolo grava situação, observação, quando e quem', sql(`select protocolo || '|' || protocolo_obs || '|' || protocolo_por || '|' || (protocolo_em is not null) from contatos where id = '${contE}'`) === 'em_protocolo|Começou o protocolo injetável.|Amanda Teste|true'
    && (await p.locator(`[data-linha-protocolo="${contE}"]`).count()) === 1);
  const emAntes = sql(`select protocolo_em from contatos where id = '${contE}'`);
  await p.click(`[data-linha-protocolo="${contE}"] button[aria-expanded]`);
  await p.click(`[data-linha-protocolo="${contE}"] button[data-situacao="em_acompanhamento"]`); await p.waitForTimeout(1500);
  ok('trocar a situação muda a data e mantém a observação', sql(`select protocolo || '|' || protocolo_obs from contatos where id = '${contE}'`) === 'em_acompanhamento|Começou o protocolo injetável.'
    && sql(`select protocolo_em <> '${emAntes}'::timestamptz from contatos where id = '${contE}'`) === 't');
  await p.click('[data-filtro-protocolo] button[data-filtro="encerrado"]'); await p.waitForTimeout(300);
  ok('filtro Encerrado esconde quem está em acompanhamento', (await p.locator(`[data-linha-protocolo="${contE}"]`).count()) === 0);
  await p.screenshot({ path: out + '18c_protocolos.png' });
  // Na ficha do contato aparece a mesma situação; "Tirar do protocolo" limpa.
  await p.click('nav a[href="/crm"]'); await p.waitForTimeout(1200);
  await p.click('role=tab[name="Contatos"]'); await p.waitForTimeout(1000);
  await p.locator('section[aria-label="Lista de contatos"] button', { hasText: 'Ester Espera Ficticia' }).first().click(); await p.waitForTimeout(800);
  const fichaP = p.locator('section[aria-label="Ficha do contato"]');
  ok('ficha do contato mostra o protocolo', (await fichaP.locator('button[data-situacao="em_acompanhamento"][aria-pressed="true"]').count()) === 1);
  await fichaP.locator('[data-tirar-protocolo]').click(); await p.waitForTimeout(1500);
  ok('tirar do protocolo limpa situação e observação', sql(`select coalesce(protocolo, '-') || '|' || coalesce(protocolo_obs, '-') from contatos where id = '${contE}'`) === '-|-'
    && (await fichaP.locator('[data-protocolo="nenhum"]').count()) === 1);
  await ctx.close();
  // Pela API (a IA): valor fora da lista é recusado; a mudança grava quem (nome da chave), o filtro e a ficha trazem.
  r = await api(`/api/v1/contatos/${contE}`, { method: 'PATCH', body: JSON.stringify({ protocolo: 'talvez' }) });
  ok('API recusa situação de protocolo desconhecida', r.status === 400 && String(r.json && r.json.erro).includes('em_analise'), JSON.stringify(r.json));
  r = await api(`/api/v1/contatos/${contE}`, { method: 'PATCH', body: JSON.stringify({ protocolo: 'em_analise', protocolo_obs: 'Doutor indicou protocolo.' }) });
  ok('API marca o protocolo e grava quem marcou', r.status === 200 && r.json.protocolo === 'em_analise' && r.json.protocolo_por === 'Sara teste' && Boolean(r.json.protocolo_em), JSON.stringify(r.json));
  r = await api('/api/v1/contatos?protocolo=em_analise');
  const listaP = (r.json && (r.json.dados || r.json.itens || r.json)) || [];
  ok('API filtra contatos por protocolo', r.status === 200 && JSON.stringify(listaP).includes(contE), JSON.stringify(r.json).slice(0, 200));
  r = await api(`/api/v1/ficha?telefone=${TELE}`);
  const pessoaP = r.json && r.json.contatos && r.json.contatos.find((x) => x.id === contE);
  ok('ficha traz o protocolo da pessoa', Boolean(pessoaP && pessoaP.protocolo && pessoaP.protocolo.situacao === 'em_analise' && pessoaP.protocolo.obs === 'Doutor indicou protocolo.'), JSON.stringify(pessoaP));
  sql(`update contatos set protocolo = null, protocolo_obs = null, protocolo_em = null, protocolo_por = null where id = '${contE}';
       update atendimentos set arquivado = true where contato_id = '${contE}'; delete from wa_mensagens where wamid = 'wamid.ESPERA1';
       delete from wa_conversas where wa_id = '554755550001';`);

  // ---------- Finalizar em massa (15/10) ----------
  const contM = sql(`insert into contatos (nome, telefone) values ('Mara Massa Ficticia', '5547955550077') returning id`);
  const idsM = [1, 2, 3].map((n) => sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por, aberto_em) values ('${contM}', 'receita', 'MASSA-${n} pedido', 'IA', now() - interval '${n} hours') returning id`));
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(1200);
  await p.click('[data-selecionar]'); await p.locator('[data-barra-selecao]').waitFor({ timeout: 5000 });
  await p.click(`[data-marcar="${idsM[0]}"]`); await p.click(`[data-marcar="${idsM[1]}"]`);
  await p.click('[data-finalizar-selecionados]'); await p.click('[data-confirmar-massa]'); await p.waitForTimeout(2000);
  ok('finalizar em massa finaliza só os selecionados, com quem clicou e auditoria',
    sql(`select string_agg(etapa || ':' || coalesce(responsavel, ''), ',' order by aberto_em desc) from atendimentos where contato_id = '${contM}'`) === 'finalizado:Amanda Teste,finalizado:Amanda Teste,aguardando:'
    && sql(`select count(*) from painel_auditoria where detalhe->>'em_massa' = 'true' and alvo_id in ('${idsM[0]}', '${idsM[1]}')`) === '2'
    && (await p.locator('[data-barra-selecao]').count()) === 0);
  await p.fill('#busca-crm', 'MASSA'); await p.click('[data-selecionar]'); await p.click('[data-selecionar-todos]');
  ok('"Selecionar todos da tela" marca só o que a busca mostra', ((await p.textContent('[data-barra-selecao]')) || '').includes('1 selecionado de 1'));
  await p.click('[data-finalizar-selecionados]'); await p.click('[data-confirmar-massa]'); await p.waitForTimeout(2000);
  ok('o restante também finaliza', sql(`select count(*) from atendimentos where contato_id = '${contM}' and etapa <> 'finalizado'`) === '0');
  await ctx.close();
  sql(`update atendimentos set arquivado = true where contato_id = '${contM}'`);

  ok('sem erro no console', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
