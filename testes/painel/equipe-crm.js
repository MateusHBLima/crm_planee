// Equipe no CRM (11/10, decisão 35): cor da coluna (Configurações e API), avisos por assunto (no CRM e na Equipe),
// "Passar para…", tela Registro (só a Planee desde 13/10) e filtro de data em português (CRM e Resultados). Roda pelo rodar.sh
// depois do convite.js. Dados fictícios; no fim arquiva os cartões que criou e volta os avisos da Amanda para "todos".
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const out = (process.env.SAIDA || __dirname + '/saida') + '/';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => { res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : '')); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function entrar(p, email, destino = '/crm') {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const ler = (p, caminho) => p.evaluate(async (c) => { const r = await fetch(c); return { s: r.status, j: await r.json().catch(() => null) }; }, caminho);
const diaSp = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400_000));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const RITA = '00000000-0000-4000-8000-000000000011';

(async () => {
  const b = await lancar();
  const erros = [];
  const nova = async (vp = { width: 1440, height: 900 }) => {
    const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    return { ctx, p };
  };
  const nomeTopico = (id) => sql(`select nome from crm_topicos where id='${id}'`);
  const AGENDA = nomeTopico('agenda'), DOCS = nomeTopico('docs'), RECEITA = nomeTopico('receita');
  const amandaId = sql("select id from painel_usuarios where email='amanda@teste.local'");
  const gestorId = sql("select id from painel_usuarios where email='gestor@teste.local'");
  const avisosDaAmanda = () => sql(`select coalesce(array_to_string(assuntos_aviso, ','), 'todos') from painel_vinculos where usuario_id='${amandaId}' and empresa_id='teste'`);

  // ---------- 1. Cor da coluna: Configurações (só a Planee, 13/10) e API ----------
  const pl = await nova();
  await entrar(pl.p, 'planee@teste.local');
  if (await pl.p.locator('#trocar-empresa').count()) { await Promise.all([pl.p.waitForURL(/\/(crm|inbox)$/), pl.p.selectOption('#trocar-empresa', 'teste')]).catch(() => undefined); }
  await pl.p.goto(B + '/configuracoes'); await pl.p.locator('#as-receita-cor').waitFor({ timeout: 10000 });
  await pl.p.selectOption('#as-receita-cor', 'azul');
  await pl.p.click(`form[aria-label="Assunto ${RECEITA}"] button:has-text("Salvar")`); await pl.p.waitForTimeout(1500);
  ok('cor da coluna salva em Configurações', sql("select cor from crm_topicos where id='receita'") === 'azul');
  const g = await nova();
  await entrar(g.p, 'gestor@teste.local', '/crm'); await g.p.locator(`section[aria-label="${RECEITA}"]`).waitFor({ timeout: 10000 });
  const fundo = await g.p.locator(`section[aria-label="${RECEITA}"]`).evaluate((e) => ({ cor: e.getAttribute('data-cor'), bg: getComputedStyle(e).backgroundColor }));
  const semCor = await g.p.locator(`section[aria-label="${DOCS}"]`).evaluate((e) => ({ cor: e.getAttribute('data-cor'), bg: getComputedStyle(e).backgroundColor }));
  ok('coluna com fundo da cor escolhida; as outras sem fundo', fundo.cor === 'azul' && !/rgba\(0, 0, 0, 0\)|transparent/.test(fundo.bg) && semCor.cor === null && /rgba\(0, 0, 0, 0\)|transparent/.test(semCor.bg), JSON.stringify([fundo, semCor]));
  await g.p.screenshot({ path: out + '40_colunas_coloridas.png' });
  await g.p.goto(B + '/configuracoes'); await g.p.waitForTimeout(500);
  ok('admin da clínica não abre Configurações', !g.p.url().endsWith('/configuracoes'), g.p.url());
  // Volta ao CRM: o resto do teste usa o botão Atualizar do quadro nesta aba.
  await g.p.goto(B + '/crm'); await g.p.locator(`section[aria-label="${RECEITA}"]`).waitFor({ timeout: 10000 });

  const chave = 'teste-cor-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Config teste', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','config'])`);
  const api = (caminho, init = {}) => fetch(B + caminho, { ...init, headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' } })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  let r = await api('/api/v1/topicos/exames', { method: 'PATCH', body: JSON.stringify({ cor: 'marrom' }) });
  ok('API recusa cor fora da paleta', r.status === 400 && String(r.json?.erro ?? JSON.stringify(r.json)).includes('Cor inválida'), JSON.stringify(r.json));
  r = await api('/api/v1/topicos/exames', { method: 'PATCH', body: JSON.stringify({ cor: 'verde' }) });
  const r2 = await api('/api/v1/topicos/exames', { method: 'PATCH', body: JSON.stringify({ cor: 'verde' }) });
  ok('API grava a cor', r.status === 200 && r2.status === 200 && sql("select cor from crm_topicos where id='exames'") === 'verde', `${r.status} ${JSON.stringify(r.json)}`);
  r = await api('/api/v1/topicos/exames', { method: 'PATCH', body: JSON.stringify({ cor: '' }) });
  ok('API: cor vazia apaga', r.status === 200 && sql("select coalesce(cor, 'nula') from crm_topicos where id='exames'") === 'nula');
  try { execSync('psql -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL"', { input: "update crm_topicos set cor = 'marrom' where id = 'exames'", env: process.env, stdio: 'pipe' }); ok('banco recusa cor fora da paleta', false); }
  catch { ok('banco recusa cor fora da paleta', true); }

  // ---------- 2. Avisos por assunto: a Amanda escolhe os dela no CRM ----------
  const a = await nova();
  await entrar(a.p, 'amanda@teste.local');
  await a.p.locator('[data-menu-crm]').waitFor({ timeout: 10000 }); await a.p.click('[data-menu-crm]');
  await a.p.locator('#meus-assuntos').waitFor({ timeout: 10000 });
  ok('botão de avisos começa em "todos os assuntos"', ((await a.p.textContent('#meus-assuntos')) || '').includes('todos os assuntos'));
  await a.p.click('#meus-assuntos');
  await a.p.locator('[role=dialog][aria-label="Avisos por assunto"] input[type=checkbox]').first().uncheck();
  await a.p.check('[role=dialog][aria-label="Avisos por assunto"] [data-assunto="agenda"]');
  await a.p.click('[role=dialog][aria-label="Avisos por assunto"] button:has-text("Salvar")'); await a.p.waitForTimeout(1500);
  ok('Amanda escolhe só o assunto Agenda (banco central)', avisosDaAmanda() === 'agenda', avisosDaAmanda());
  ok('botão mostra o assunto escolhido', ((await a.p.textContent('#meus-assuntos')) || '').includes(AGENDA));
  ok('escolha da Amanda fica na auditoria do central', sql(`select count(*) from central_auditoria where acao='avisos_crm' and usuario_id='${amandaId}' and alvo='${amandaId}'`) === '1');

  // Aviso só dos assuntos dela: com a aba "escondida", o título conta só o que avisa.
  await a.p.click('#avisos-crm'); await a.p.waitForTimeout(300);
  await a.p.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  const atualizar = async (p) => { await p.click('header button:has-text("Atualizar")'); await p.waitForTimeout(1800); };
  const titulo0 = await a.p.title();
  const idDocs = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${RITA}', 'docs', 'Teste aviso de outro assunto', 'IA') returning id`);
  await atualizar(a.p);
  ok('cartão novo de outro assunto não avisa a Amanda', (await a.p.title()) === titulo0, await a.p.title());
  const idAgenda = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${RITA}', 'agenda', 'Teste aviso do assunto dela', 'IA') returning id`);
  await atualizar(a.p);
  ok('cartão novo do assunto dela avisa', (await a.p.title()).startsWith('(1) '), await a.p.title());

  // ---------- 3. "Passar para…": o gestor passa o cartão de documentos para a Amanda, na Agenda ----------
  const pessoas = await ler(g.p, '/api/painel/ler/equipe_crm');
  ok('lista de quem atende no CRM: só nome e assuntos, sem a Planee', pessoas.s === 200 && pessoas.j.dados.some((x) => x.nome === 'Amanda Teste')
    && !pessoas.j.dados.some((x) => x.nome === 'Planee Teste') && !JSON.stringify(pessoas.j).includes('@'), JSON.stringify(pessoas.j).slice(0, 300));
  await atualizar(g.p);
  await g.p.locator('article', { hasText: 'Teste aviso de outro assunto' }).locator('[data-passar]').click();
  await g.p.locator('form[aria-label="Passar para"]').waitFor({ timeout: 5000 });
  await g.p.waitForFunction(() => document.querySelectorAll('#passar-pessoa option').length > 1, null, { timeout: 8000 });
  await g.p.selectOption('#passar-assunto', 'agenda');
  await g.p.selectOption('#passar-pessoa', { label: 'Amanda Teste' });
  await g.p.fill('#passar-recado', 'Paciente quer encaixe ainda hoje');
  await g.p.screenshot({ path: out + '41_passar_para.png' });
  await g.p.click('form[aria-label="Passar para"] button[type=submit]'); await g.p.waitForTimeout(2000);
  ok('passar muda assunto, volta para aguardando e põe a pessoa como responsável',
    sql(`select topico_id || '|' || etapa || '|' || responsavel || '|' || (assumido_em is null) from atendimentos where id='${idDocs}'`) === 'agenda|aguardando|Amanda Teste|true');
  ok('o recado vira nota', sql(`select texto from notas where alvo_id='${idDocs}' order by criado_em desc limit 1`) === `Passou para ${AGENDA} · Amanda Teste. Recado: Paciente quer encaixe ainda hoje`);
  ok('auditoria grava quem passou, de onde e para onde', sql(`select usuario_id || '|' || (detalhe->>'passou_para') || '|' || (detalhe->>'de_topico') from painel_auditoria where alvo_id='${idDocs}' and detalhe ? 'passou_para'`) === `${gestorId}|${AGENDA}|docs`);
  ok('cartão aparece na coluna nova', (await g.p.locator(`section[aria-label="${AGENDA}"] article`, { hasText: 'Teste aviso de outro assunto' }).count()) === 1);
  ok('aviso de sucesso na tela', ((await g.p.locator('main [role=status]').textContent()) || '').includes('Passado para'));
  await g.p.locator('article', { hasText: 'Teste aviso de outro assunto' }).locator('button').first().click(); await g.p.waitForTimeout(1500);
  const hist = (await g.p.locator('aside ol').first().textContent()) || '';
  ok('histórico do cartão mostra o repasse e quem fez', hist.includes(`Passou para ${AGENDA} · Amanda Teste`) && hist.includes('Gestor Teste'), hist.slice(0, 300));
  await g.p.keyboard.press('Escape');
  await atualizar(a.p);
  ok('cartão passado para a Amanda avisa (mesmo vindo de outro assunto)', (await a.p.title()).startsWith('(2) '), await a.p.title());

  // ---------- 4. Equipe: o admin escolhe os avisos da Amanda ----------
  await g.p.goto(B + '/equipe'); await g.p.locator(`[data-avisos="${amandaId}"]`).waitFor({ timeout: 10000 });
  ok('Equipe mostra os avisos da pessoa', ((await g.p.textContent(`[data-avisos="${amandaId}"]`)) || '').includes(AGENDA));
  await g.p.click(`[data-editar-avisos="${amandaId}"]`);
  await g.p.check(`#av-${amandaId}-todos`); await g.p.click('button:has-text("Salvar avisos")'); await g.p.waitForTimeout(1500);
  ok('admin volta a Amanda para todos os assuntos', avisosDaAmanda() === 'todos');
  await g.p.click(`[data-editar-avisos="${amandaId}"]`);
  await g.p.uncheck(`#av-${amandaId}-todos`); await g.p.check(`#av-${amandaId}-docs`); await g.p.click('button:has-text("Salvar avisos")'); await g.p.waitForTimeout(1500);
  ok('admin escolhe um assunto para a Amanda', avisosDaAmanda() === 'docs' && ((await g.p.textContent(`[data-avisos="${amandaId}"]`)) || '').includes(DOCS));
  const recusa = await ler(a.p, '/api/painel/ler/registro');
  ok('membro não lê o Registro', recusa.s === 403, JSON.stringify(recusa));

  // ---------- 5. Registro (só a Planee, 13/10) ----------
  const recusaAdmin = await ler(g.p, '/api/painel/ler/registro');
  await g.p.goto(B + '/registro'); await g.p.waitForTimeout(800);
  ok('admin da clínica não abre nem lê o Registro', recusaAdmin.s === 403 && !g.p.url().includes('/registro'), `${recusaAdmin.s} ${g.p.url()}`);
  await pl.p.goto(B + '/registro'); await pl.p.locator('[data-registro]').first().waitFor({ timeout: 10000 });
  const linhas = await pl.p.locator('[data-registro]').allTextContents();
  ok('Registro mostra o repasse com quem fez', linhas.some((t) => t.includes('Gestor Teste') && t.includes(`Passou para ${AGENDA} · Amanda Teste`)), linhas.slice(0, 5).join(' / '));
  ok('Registro mostra a escolha de avisos e quem fez', linhas.some((t) => t.includes('Amanda Teste') && t.includes('Avisos do CRM de Amanda Teste')) && linhas.some((t) => t.includes('Gestor Teste') && t.includes(`Avisos do CRM de Amanda Teste: ${DOCS}`)));
  ok('Registro mostra o nome do paciente do cartão', linhas.some((t) => t.includes('Passou para') && t.includes('Rita Ficticia')));
  await pl.p.screenshot({ path: out + '42_registro.png', fullPage: true });
  await pl.p.selectOption('#registro-pessoa', amandaId); await pl.p.waitForTimeout(1500);
  const soAmanda = await pl.p.locator('[data-registro]').allTextContents();
  ok('filtro por pessoa', soAmanda.length > 0 && soAmanda.every((t) => t.includes('Amanda Teste')) && !soAmanda.some((t) => t.includes('Gestor Teste')), soAmanda.join(' / ').slice(0, 300));
  await pl.p.selectOption('#registro-pessoa', ''); await pl.p.click('button[data-area="equipe"]'); await pl.p.waitForTimeout(1500);
  const areas = await pl.p.locator('li[data-registro]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-area')));
  ok('filtro por área', areas.length > 0 && areas.every((x) => x === 'equipe'), areas.join(','));
  const ontemReg = await ler(pl.p, `/api/painel/ler/registro?de=${diaSp(-3)}&ate=${diaSp(-2)}`);
  ok('Registro respeita o período', ontemReg.s === 200 && ontemReg.j.dados.itens.every((x) => new Date(x.quando) < new Date(Date.now() - 86400_000)), JSON.stringify(ontemReg.j).slice(0, 200));
  await a.p.goto(B + '/registro'); await a.p.waitForTimeout(1000);
  ok('membro não abre a tela Registro', !a.p.url().includes('/registro'), a.p.url());

  // ---------- 6. Filtro de data no CRM ----------
  const idOntem = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por, aberto_em) values ('${RITA}', 'receita', 'Cartao de ontem do teste', 'IA',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '12 hours') at time zone 'America/Sao_Paulo') returning id`);
  await g.p.goto(B + '/crm'); await g.p.locator('#periodo-crm').waitFor({ timeout: 10000 });
  ok('filtro começa em "Abertos agora"', ((await g.p.textContent('#periodo-crm')) || '').includes('Abertos agora'));
  ok('cartão de ontem aberto aparece no quadro de agora', (await g.p.locator('article', { hasText: 'Cartao de ontem do teste' }).count()) === 1);
  await g.p.click('#periodo-crm'); await g.p.click('[data-atalho="ontem"]'); await g.p.waitForTimeout(2000);
  ok('atalho "Ontem": só os abertos ontem', ((await g.p.textContent('#periodo-crm')) || '').includes('Ontem')
    && (await g.p.locator('article', { hasText: 'Cartao de ontem do teste' }).count()) === 1
    && (await g.p.locator('article', { hasText: 'Teste aviso do assunto dela' }).count()) === 0
    && (await g.p.locator('[data-nota-periodo]').count()) === 1);
  const hoje = diaSp(0); const [ano, mes] = hoje.split('-').map(Number);
  await g.p.click('#periodo-crm'); await g.p.click('[data-modo="mes"]'); await g.p.click(`[data-mes="${hoje.slice(0, 7)}"]`); await g.p.waitForTimeout(1800);
  ok('mês inteiro no calendário, em português', ((await g.p.textContent('#periodo-crm')) || '').includes(`${MESES[mes - 1]} de ${ano}`), await g.p.textContent('#periodo-crm'));
  ok('mês inteiro traz os cartões de hoje', (await g.p.locator('article', { hasText: 'Teste aviso do assunto dela' }).count()) === 1);
  // Do dia 2 até hoje (do dia 1 seria o atalho "Este mês", que aparece com esse nome).
  if (hoje.slice(8) > '02') {
    await g.p.click('#periodo-crm'); await g.p.click('[data-modo="intervalo"]');
    await g.p.click(`[data-dia="${hoje.slice(0, 8)}02"]`); await g.p.click(`[data-dia="${hoje}"]`); await g.p.waitForTimeout(1800);
    ok('intervalo "de… até…" em data brasileira', ((await g.p.textContent('#periodo-crm')) || '').includes(`02/${hoje.slice(5, 7)}/${ano} a ${hoje.slice(8)}/${hoje.slice(5, 7)}/${ano}`), await g.p.textContent('#periodo-crm'));
  }
  await g.p.screenshot({ path: out + '43_filtro_data.png' });
  await g.p.click('#periodo-crm'); await g.p.click('button:has-text("Abertos agora")'); await g.p.waitForTimeout(1800);
  ok('volta para o quadro de agora', ((await g.p.textContent('#periodo-crm')) || '').includes('Abertos agora') && (await g.p.locator('[data-nota-periodo]').count()) === 0);
  const invalido = await ler(g.p, '/api/painel/ler/quadro?de=2026-13-40&ate=x');
  ok('data inválida vira o quadro de agora', invalido.s === 200 && invalido.j.dados.periodo === null);
  // Celular: o filtro abre como folha embaixo, sem cortar a tela.
  const cel = await nova({ width: 390, height: 844 });
  // 28/10: no celular o período fica atrás de "Filtros".
  await entrar(cel.p, 'gestor@teste.local'); await cel.p.locator('[data-filtros-celular]').click({ timeout: 10000 }); await cel.p.locator('#periodo-crm').waitFor({ timeout: 10000 });
  await cel.p.click('#periodo-crm'); await cel.p.waitForTimeout(300);
  const caixa = await cel.p.locator('[role=dialog][aria-label="Período do quadro"]').boundingBox();
  ok('no celular o calendário cabe na tela', caixa && caixa.x >= 0 && caixa.x + caixa.width <= 390 && caixa.y + caixa.height <= 844, JSON.stringify(caixa));
  await cel.p.screenshot({ path: out + '44_filtro_celular.png' });
  await cel.ctx.close();

  // ---------- 7. Resultados por datas ----------
  const ontem = diaSp(-1);
  const rs = await ler(g.p, `/api/painel/ler/resultados?de=${ontem}&ate=${ontem}`);
  const abertosOntem = Number(sql(`select count(*) from atendimentos where not arquivado and resumo !~ '^\\s*\\[SOMBRA\\]'
    and aberto_em >= '${ontem}'::date::timestamp at time zone 'America/Sao_Paulo' and aberto_em < ('${ontem}'::date + 1)::timestamp at time zone 'America/Sao_Paulo'`));
  ok('Resultados de um dia batem com o banco', rs.s === 200 && rs.j.dados.periodo === 'datas' && rs.j.dados.quadro.abertos === abertosOntem && abertosOntem >= 1, `${rs.j?.dados?.quadro?.abertos} x ${abertosOntem}`);
  await g.p.goto(B + '/resultados'); await g.p.locator('#periodo-resultados').waitFor({ timeout: 10000 });
  ok('Resultados começam nos últimos 30 dias', ((await g.p.textContent('#periodo-resultados')) || '').includes('Últimos 30 dias'));
  await g.p.click('#periodo-resultados'); await g.p.click('[data-atalho="mes_passado"]'); await g.p.waitForTimeout(2000);
  const mp = mes === 1 ? `${MESES[11]} de ${ano - 1}` : `${MESES[mes - 2]} de ${ano}`;
  ok('Resultados: mês passado', ((await g.p.textContent('#periodo-resultados')) || '').includes('Mês passado') && ((await g.p.textContent('main')) || '').includes('/'), mp);

  // ---------- Limpeza ----------
  sql(`update atendimentos set arquivado = true where id in ('${idDocs}', '${idAgenda}', '${idOntem}')`);
  sql(`update painel_vinculos set assuntos_aviso = null where usuario_id = '${amandaId}'`);
  await esperar(100);
  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 500));
  await b.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
