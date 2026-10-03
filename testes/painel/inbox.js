// Testes da Inbox somente leitura (fase 1.1): lista, conversa, rótulos por origem, mídia, citação, reação,
// editada/apagada, não lidas, CPF mascarado e auditoria do master, isolamento entre empresas, permissão.
// Roda pelo rodar.sh, depois do central.js (usa a Clínica Outra e o admin dela). Dados 100% fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const out = (process.env.SAIDA || __dirname + '/saida') + '/'; fs.mkdirSync(out, { recursive: true });
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const PORTA = new URL(process.env.BASE_URL || 'http://localhost:3100').port;
const GERAL = `http://localhost:${PORTA}`;
const OUTRA = `http://outra.localhost:${PORTA}`;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, base, email, senha = 'senha123', destino = '/inbox') {
  await p.goto(base + destino); await p.fill('#email', email); await p.fill('#senha', senha);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

// Guarda o corpo das respostas das ações da Inbox (o que de fato chega ao navegador).
async function capturar(p, lista) {
  await p.route((u) => u.pathname === '/inbox', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const r = await route.fetch(); const corpo = await r.text(); lista.push(corpo);
    await route.fulfill({ response: r, body: corpo });
  });
}

const NUM = '100000000000001';           // phone_number_id fictício da empresa de teste
const BIA = '5547900001001', CARLOS = '5547900001002', DANI = '5547900001003';
// Ontem ao meio-dia no fuso do painel: o separador "Ontem" não depende da hora em que o teste roda.
const ONTEM = `(date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '12 hours') at time zone 'America/Sao_Paulo'`;
const SEMENTE = `
delete from wa_reacoes; delete from wa_mensagens; delete from wa_conversas; delete from wa_contatos;
insert into wa_contatos (numero_id, wa_id, nome_perfil, nome_salvo) values
  ('${NUM}', '${BIA}', 'Bia perfil', 'Beatriz Ficticia'),
  ('${NUM}', '${CARLOS}', 'Carlos Ficticio', null),
  ('${NUM}', '${DANI}', 'Daniela Ficticia', null);
insert into wa_conversas (numero_id, wa_id, ultima_em, ultima_resumo, ultima_direcao, ultima_entrada_em, nao_lidas) values
  ('${NUM}', '${BIA}', now() - interval '5 minutes', 'Tipo de mensagem não suportado', 'entrada', now() - interval '5 minutes', 3),
  ('${NUM}', '${CARLOS}', now() - interval '2 days', 'Obrigado, até mais', 'saida', now() - interval '2 days', 0),
  ('${NUM}', '${DANI}', now() - interval '3 hours', 'Mensagem antiga 130', 'entrada', now() - interval '3 hours', 0);
insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, midia, resposta_a, status, editada_em, versoes, apagada_em, enviada_em, bruto, erro) values
  ('${NUM}', '${BIA}', 'wamid.TI1', 'entrada', 'contato', 'text', 'Oi, gostaria de marcar uma consulta', null, null, null, null, null, null, ${ONTEM}, '{"segredo":"BRUTO_SECRETO"}', null),
  ('${NUM}', '${BIA}', 'wamid.TI2', 'saida', 'api', 'desconhecido', null, null, null, 'entregue', null, null, null, ${ONTEM} + interval '10 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI3', 'entrada', 'contato', 'image', 'Foto do pedido médico', '{"id":"m1","mime_type":"image/jpeg","caminho":"/midia/CAMINHO_SECRETO.jpg"}', null, null, null, null, null, now() - interval '60 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI4', 'saida', 'celular', 'text', 'Recebido, obrigado!', null, null, 'lida', now() - interval '45 minutes', '["Recebido"]', null, now() - interval '50 minutes', null, '{"x":"ERRO_SECRETO"}'),
  ('${NUM}', '${BIA}', 'wamid.TI5', 'entrada', 'contato', 'text', 'mensagem que vou apagar', null, null, null, null, null, now() - interval '39 minutes', now() - interval '40 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI6', 'entrada', 'contato', 'text', 'Meu CPF é 123.456.789-09', null, null, null, null, null, null, now() - interval '30 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI7', 'saida', 'celular', 'text', 'Pode ser às 15h?', null, 'wamid.TI1', 'enviada', null, null, null, now() - interval '20 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI8', 'entrada', 'contato', 'document', 'exame.pdf', '{"id":"m2","mime_type":"application/pdf","filename":"exame.pdf"}', null, null, null, null, null, now() - interval '15 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI9', 'entrada', 'historico', 'text', 'Mensagem antiga importada', null, null, null, null, null, null, now() - interval '10 minutes', null, null),
  ('${NUM}', '${BIA}', 'wamid.TI10', 'entrada', 'contato', 'unsupported', 'Tipo de mensagem não suportado pelo WhatsApp oficial', null, null, null, null, null, null, now() - interval '5 minutes', null, null),
  ('${NUM}', '${CARLOS}', 'wamid.TC1', 'saida', 'celular', 'text', 'Obrigado, até mais', null, null, 'lida', null, null, null, now() - interval '2 days', null, null);
insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em)
  select '${NUM}', '${DANI}', 'wamid.TD' || n, 'entrada', 'contato', 'text', 'Mensagem antiga ' || n, now() - interval '3 hours' - (130 - n) * interval '1 minute'
    from generate_series(1, 130) n;
insert into wa_reacoes (numero_id, wamid, autor, emoji, em) values ('${NUM}', 'wamid.TI4', '${BIA}', '👍', now() - interval '44 minutes');
`;

(async () => {
  sql(SEMENTE);
  const b = await lancar();
  const erros = [];
  const novo = async (vp = { width: 1280, height: 900 }, extra = {}) => {
    const c = await b.newContext({ viewport: vp, ...extra }); const p = await c.newPage();
    p.on('pageerror', (e) => erros.push(p.url() + ' ' + e.message.slice(0, 120)));
    return [c, p];
  };
  const item = (p, nome) => p.locator('section[aria-label="Conversas"] li', { hasText: nome });
  const conversa = (p) => p.locator('section[aria-label^="Conversa com"]');

  // ---- Secretária (Amanda, membro com inbox.ver) ----
  let [ctx, p] = await novo();
  const respostas = []; await capturar(p, respostas);
  await entrar(p, GERAL, 'amanda@teste.local');
  ok('Amanda abre a Inbox', p.url().endsWith('/inbox'), p.url());
  ok('lista mostra as conversas pelo nome salvo', (await item(p, 'Beatriz Ficticia').count()) === 1 && (await item(p, 'Carlos Ficticio').count()) === 1);
  ok('conversa com 3 não lidas mostra o contador', (await item(p, 'Beatriz Ficticia').locator('[aria-label="3 não lidas"]').textContent().catch(() => '')) === '3');
  ok('indicador da janela de 24 h só onde o contato escreveu há pouco', (await item(p, 'Beatriz Ficticia').getByText('24h', { exact: true }).count()) === 1
    && (await item(p, 'Carlos Ficticio').getByText('24h', { exact: true }).count()) === 0);
  ok('ordem: a mais recente primeiro', ((await p.locator('section[aria-label="Conversas"] li').first().textContent()) || '').includes('Beatriz'));
  ok('aviso de somente leitura visível', (await p.getByText('Somente leitura: responder pelo painel chega numa próxima etapa.').count()) === 1);

  await item(p, 'Beatriz Ficticia').getByRole('button').click();
  await conversa(p).getByText('Oi, gostaria de marcar uma consulta').first().waitFor({ timeout: 8000 }).catch(() => {});
  const txt = ((await conversa(p).textContent()) || '').replace(/\s+/g, ' ');
  ok('conversa abre com as mensagens', txt.includes('Oi, gostaria de marcar uma consulta') && txt.includes('Pode ser às 15h?'), txt.slice(0, 200));
  ok('mensagem da Sara sem texto', txt.includes('Mensagem da Sara (texto ainda não registrado)'));
  ok('rótulos por origem (Sara, Equipe (celular), Histórico)', (await conversa(p).locator('[data-direcao="saida"]', { hasText: 'Sara' }).count()) === 1
    && txt.includes('Equipe (celular)') && txt.includes('Histórico'));
  ok('foto como etiqueta com a legenda', (await conversa(p).getByText('Foto', { exact: true }).count()) === 1 && txt.includes('Foto do pedido médico'));
  ok('documento com o nome do arquivo (sem repetir)', txt.includes('Documento: exame.pdf') && txt.split('exame.pdf').length === 2);
  ok('tipo não suportado', txt.includes('Tipo de mensagem não suportado') && !txt.includes('pelo WhatsApp oficial'));
  ok('marcas de editada e apagada', (await conversa(p).locator('[data-id]', { hasText: 'Recebido, obrigado!' }).getByText('editada').count()) === 1
    && (await conversa(p).locator('[data-id]', { hasText: 'mensagem que vou apagar' }).getByText('apagada').count()) === 1);
  ok('reação embaixo da bolha', (await conversa(p).locator('[data-id]', { hasText: 'Recebido, obrigado!' }).getByText('👍').count()) === 1);
  ok('resposta mostra a mensagem citada', ((await conversa(p).locator('[data-id]', { hasText: 'Pode ser às 15h?' }).locator('blockquote').textContent()) || '').includes('Oi, gostaria de marcar'));
  ok('status da saída (lida, enviada)', (await conversa(p).locator('[aria-label="Lida"]').count()) === 1 && (await conversa(p).locator('[aria-label="Enviada"]').count()) === 1);
  const seps = await conversa(p).locator('[role=separator]').allTextContents();
  ok('separadores de dia (Ontem ... Hoje)', seps[0] === 'Ontem' && seps[seps.length - 1] === 'Hoje', seps.join('|'));
  ok('secretária vê o CPF inteiro', txt.includes('123.456.789-09'));
  await p.screenshot({ path: out + '20_inbox_claro.png' });
  await p.click('text=Tema escuro'); await p.waitForTimeout(400); await p.screenshot({ path: out + '21_inbox_escuro.png' }); await p.click('text=Tema claro');
  await p.waitForTimeout(500);
  ok('abrir zera as não lidas no banco', sql(`select nao_lidas || '|' || (lida_ate is not null) from wa_conversas where wa_id='${BIA}'`) === '0|true');
  ok('e a lista tira o contador', (await item(p, 'Beatriz Ficticia').locator('[aria-label$="não lidas"]').count()) === 0);
  const tudo = respostas.join('\n');
  ok('caminho da mídia, bruto e erro não vão para o navegador', tudo.includes('Pode ser às 15h?') && !tudo.includes('CAMINHO_SECRETO') && !tudo.includes('BRUTO_SECRETO') && !tudo.includes('ERRO_SECRETO'),
    `${respostas.length} respostas; ` + ['Pode ser às 15h?', 'CAMINHO_SECRETO', 'BRUTO_SECRETO', 'ERRO_SECRETO'].map((k) => k + '=' + tudo.includes(k)).join(' '));

  // Atualização automática: mensagem nova chega sem recarregar
  sql(`insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em) values ('${NUM}', '${BIA}', 'wamid.TI11', 'entrada', 'contato', 'text', 'Chegou agora durante o teste', now());
       update wa_conversas set ultima_em = now(), ultima_resumo = 'Chegou agora durante o teste', nao_lidas = nao_lidas + 1 where wa_id = '${BIA}';`);
  await p.waitForTimeout(12000);
  ok('mensagem nova aparece sozinha em 10 s', (await conversa(p).getByText('Chegou agora durante o teste').count()) === 1);
  ok('com a conversa aberta, a nova já conta como lida', sql(`select nao_lidas from wa_conversas where wa_id='${BIA}'`) === '0');

  // Busca no servidor
  await p.fill('#busca-inbox', 'carl'); await p.waitForTimeout(1500);
  ok('busca pelo nome', (await p.locator('section[aria-label="Conversas"] li').count()) === 1 && (await item(p, 'Carlos Ficticio').count()) === 1);
  await p.fill('#busca-inbox', '1003'); await p.waitForTimeout(1500);
  ok('busca pelos dígitos do número', (await p.locator('section[aria-label="Conversas"] li').count()) === 1 && (await item(p, 'Daniela Ficticia').count()) === 1);
  await p.fill('#busca-inbox', 'ninguém%'); await p.waitForTimeout(1500);
  ok('busca sem resultado', (await p.getByText('Nenhuma conversa encontrada.').count()) === 1);
  await p.fill('#busca-inbox', ''); await p.waitForTimeout(1500);

  // Páginas antigas
  await item(p, 'Daniela Ficticia').getByRole('button').click();
  await conversa(p).getByText('Mensagem antiga 130', { exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
  ok('conversa longa abre nas 100 mais recentes', (await conversa(p).getByText('Mensagem antiga 31', { exact: true }).count()) === 1
    && (await conversa(p).getByText('Mensagem antiga 30', { exact: true }).count()) === 0);
  await conversa(p).getByRole('button', { name: 'Carregar mais antigas' }).click(); await p.waitForTimeout(1500);
  ok('"Carregar mais antigas" traz o começo e some no fim', (await conversa(p).getByText('Mensagem antiga 1', { exact: true }).count()) === 1
    && (await conversa(p).getByRole('button', { name: 'Carregar mais antigas' }).count()) === 0
    && (await conversa(p).locator('[data-id]').count()) === 130);
  // Rolou para cima: a atualização automática não puxa para o fim
  await p.evaluate(() => { const el = document.querySelector('[data-id]').parentElement.parentElement; el.scrollTop = 0; });
  sql(`insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em) values ('${NUM}', '${DANI}', 'wamid.TD131', 'entrada', 'contato', 'text', 'Mensagem antiga 131', now());`);
  await p.waitForTimeout(12000);
  const rol = await p.evaluate(() => document.querySelector('[data-id]').parentElement.parentElement.scrollTop);
  ok('mensagem nova chega sem perder a posição de quem rolou para cima', rol < 50 && (await conversa(p).locator('[data-id]').count()) === 131, String(rol));
  await ctx.close();

  // ---- Celular: uma coluna por vez ----
  [ctx, p] = await novo({ width: 390, height: 844 }, { isMobile: true });
  await entrar(p, GERAL, 'amanda@teste.local');
  ok('celular: só a lista', await p.locator('section[aria-label="Conversas"]').isVisible() && !(await p.getByText('Escolha uma conversa na lista').isVisible()));
  await item(p, 'Beatriz Ficticia').getByRole('button').click(); await p.waitForTimeout(1500);
  ok('celular: abre a conversa no lugar da lista', await conversa(p).isVisible() && !(await p.locator('section[aria-label="Conversas"]').isVisible()));
  await p.screenshot({ path: out + '22_inbox_celular.png' });
  const larg = await p.evaluate(() => document.documentElement.scrollWidth); ok('celular sem rolagem lateral', larg <= 390, String(larg));
  await p.getByRole('button', { name: 'Voltar para a lista' }).click(); await p.waitForTimeout(300);
  ok('celular: Voltar mostra a lista', await p.locator('section[aria-label="Conversas"]').isVisible());
  await ctx.close();

  // ---- Master (Planee): CPF mascarado, não mexe nas não lidas, acesso auditado ----
  sql(`update wa_conversas set nao_lidas = 3 where wa_id = '${BIA}'`);
  const audAntes = Number(sql(`select count(*) from central_auditoria where acao = 'abrir_conversa'`));
  [ctx, p] = await novo();
  const respM = []; await capturar(p, respM);
  await entrar(p, GERAL, 'planee@teste.local', 'senha123', '/empresas');
  await Promise.all([p.waitForURL(/\/crm$/), p.selectOption('#trocar-empresa', 'teste')]); await p.waitForTimeout(800);
  await p.goto(GERAL + '/inbox');
  ok('master abre a Inbox da empresa escolhida', p.url().endsWith('/inbox') && (await item(p, 'Beatriz Ficticia').count()) === 1, p.url());
  ok('master vê o aviso da visão da Planee', (await p.getByText(/Visão da Planee/).count()) === 1);
  await item(p, 'Beatriz Ficticia').getByRole('button').click();
  await conversa(p).getByText(/Meu CPF/).waitFor({ timeout: 8000 }).catch(() => {});
  const txtM = ((await conversa(p).textContent()) || '');
  ok('master vê o CPF mascarado', txtM.includes('Meu CPF é ***.***.***-09') && !txtM.includes('123.456.789'), txtM.slice(0, 120));
  ok('CPF não sai do servidor para o master', respM.join('\n').includes('***.***.***-09') && !respM.join('\n').includes('123.456.789'), respM.length + ' respostas');
  await p.waitForTimeout(11500); // passa por uma atualização automática
  ok('master não zera as não lidas da clínica', sql(`select nao_lidas || '|' || coalesce(lida_ate::text, '') from wa_conversas where wa_id='${BIA}'`).startsWith('3|'));
  const aud = sql(`select empresa_id || '|' || alvo || '|' || coalesce(detalhe::text, '') from central_auditoria a join painel_usuarios u on u.id = a.usuario_id
                    where a.acao = 'abrir_conversa' and u.email = 'planee@teste.local' order by a.id desc limit 1`);
  ok('acesso do master registrado na auditoria central (sem telefone inteiro)', aud === `teste|${NUM}:1001|` && !aud.includes(BIA), aud);
  ok('atualização automática não repete a linha da auditoria', Number(sql(`select count(*) from central_auditoria where acao = 'abrir_conversa'`)) === audAntes + 1);
  await ctx.close();

  // ---- Outra empresa: banco próprio, não vê as conversas da empresa de teste ----
  sql(`delete from wa_conversas; delete from wa_contatos;
       insert into wa_contatos (numero_id, wa_id, nome_perfil) values ('200000000000002', '5548900002001', 'Elisa Outra Ficticia');
       insert into wa_conversas (numero_id, wa_id, ultima_em, ultima_resumo, ultima_direcao) values ('200000000000002', '5548900002001', now(), 'Conversa só da Clínica Outra', 'entrada');`, process.env.OUTRA_DATABASE_URL);
  sql(`update empresas set modulos = array_append(modulos, 'inbox.ver') where id = 'clinica-outra' and not 'inbox.ver' = any(modulos)`);
  [ctx, p] = await novo();
  await entrar(p, OUTRA, 'admin2@teste.local', 'senhaforte1');
  ok('admin da outra empresa abre a Inbox dela', p.url().endsWith('/inbox'), p.url());
  ok('e vê só as conversas do banco dela', (await item(p, 'Elisa Outra Ficticia').count()) === 1 && (await item(p, 'Beatriz Ficticia').count()) === 0 && (await item(p, 'Carlos Ficticio').count()) === 0);
  await ctx.close();
  sql(`update empresas set modulos = array_remove(modulos, 'inbox.ver') where id = 'clinica-outra'`);

  // ---- Sem inbox.ver: a tela não abre nem por URL ----
  sql(`update painel_vinculos set permissoes = array_remove(permissoes, 'inbox.ver') where usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local') and empresa_id = 'teste'`);
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'amanda@teste.local', 'senha123', '/crm');
  await p.goto(GERAL + '/inbox');
  ok('sem inbox.ver, /inbox volta para outra tela', !p.url().endsWith('/inbox') && !((await p.textContent('nav')) || '').includes('Inbox'), p.url());
  await ctx.close();
  sql(`update painel_vinculos set permissoes = array_prepend('inbox.ver', permissoes) where usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local') and empresa_id = 'teste'`);

  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
