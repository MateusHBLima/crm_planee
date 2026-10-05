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

  // ---------- Prazos: cores de atraso e o mais antigo em cima ----------
  const sexames = `insert into atendimentos (topico_id, etapa, resumo, aberto_por, aberto_em, atualizado_em) values
    ('exames', 'aguardando', 'PRAZO-A cinco minutos', 'IA', now() - interval '5 minutes', now() - interval '5 minutes'),
    ('exames', 'aguardando', 'PRAZO-B vinte minutos', 'IA', now() - interval '20 minutes', now() - interval '20 minutes'),
    ('exames', 'aguardando', 'PRAZO-C quarenta minutos', 'IA', now() - interval '40 minutes', now() - interval '40 minutes'),
    ('exames', 'pendente', 'PRAZO-D pendente parado', 'Amanda Teste', now() - interval '50 hours', now() - interval '30 hours'),
    ('exames', 'em_atendimento', 'PRAZO-E em atendimento antigo', 'IA', now() - interval '3 hours', now() - interval '3 hours'),
    ('exames', 'em_atendimento', 'PRAZO-F em atendimento novo', 'IA', now() - interval '1 hour', now() - interval '1 hour');`;
  sql(sexames);
  ({ ctx, p } = await nova());
  await entrar(p, 'amanda@teste.local'); await p.waitForTimeout(1200);
  const col = p.locator('section[aria-label="Exames"] article');
  const textos = (await col.allTextContents()).map((t) => (t.match(/PRAZO-([A-F])/) || ['', ''])[1]).filter(Boolean);
  ok('mais antigo em cima: aguardando C, B, A; em atendimento E antes de F', textos.join('') === 'CBAEFD', textos.join(''));
  const nivel = (k) => p.locator('section[aria-label="Exames"] article', { hasText: k }).getAttribute('data-atraso');
  ok('aguardando há 40 min fica vermelho', (await nivel('PRAZO-C')) === 'vermelho');
  ok('aguardando há 20 min fica amarelo', (await nivel('PRAZO-B')) === 'amarelo');
  ok('aguardando há 5 min fica normal', (await nivel('PRAZO-A')) === null);
  ok('pendente parado há 30 h fica amarelo', (await nivel('PRAZO-D')) === 'amarelo');
  ok('em atendimento não muda de cor', (await nivel('PRAZO-E')) === null);
  ok('selo "Atrasado · há 40 min" no cartão vermelho', ((await p.locator('section[aria-label="Exames"] article', { hasText: 'PRAZO-C' }).textContent()) || '').includes('Atrasado · há 40 min'));
  const fila = ((await p.locator('[data-fila]').textContent()) || '').replace(/\s+/g, ' ');
  ok('topo mostra o mais antigo aguardando e os atrasados', fila.includes('Mais antigo aguardando: há') && (await p.locator('[data-fila] [data-contagem="vermelho"]').count()) === 1, fila);
  await p.screenshot({ path: out + '14_quadro_prazos.png', fullPage: true });
  await ctx.close();
  // Prazos em Configurações (gestor): aguardando 60/120 min → o de 40 min volta ao normal
  ({ ctx, p } = await nova());
  await entrar(p, 'gestor@teste.local'); await p.goto(B + '/configuracoes'); await p.waitForTimeout(800);
  ok('Configurações mostra os prazos padrão', (await p.inputValue('#prazo-ag_am')) === '15' && (await p.inputValue('#prazo-ag_vm')) === '30'
    && (await p.inputValue('#prazo-pd_am')) === '24' && (await p.inputValue('#prazo-pd_vm')) === '48');
  await p.fill('#prazo-ag_am', '60'); await p.fill('#prazo-ag_vm', '50'); await p.click('button:has-text("Salvar prazos")'); await p.waitForTimeout(1000);
  ok('vermelho antes do amarelo é recusado', ((await p.locator('section[aria-labelledby="cfg-prazos"] [role=alert]').textContent()) || '').includes('vermelho precisa vir depois'));
  await p.fill('#prazo-ag_vm', '120'); await p.click('button:has-text("Salvar prazos")'); await p.waitForTimeout(1000);
  ok('prazos salvos pela API (com auditoria)', sql("select valor->'aguardando'->>'amarelo' || '/' || (valor->'aguardando'->>'vermelho') || '/' || (valor->'pendente'->>'amarelo') from crm_config where chave='prazos_atendimento'") === '60/120/1440'
    && sql("select count(*) from painel_auditoria where alvo_id = 'prazos_atendimento'") !== '0');
  await p.goto(B + '/crm'); await p.waitForTimeout(1200);
  ok('com 60/120 min, o de 40 min sai do vermelho', (await nivel('PRAZO-C')) === null);
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

  ok('sem erro no console', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
