// Testes da Inbox (fases 1.1, 2.1 e 2.3): lista, conversa, rótulos por origem, mídia, citação, reação,
// editada/apagada, não lidas, CPF mascarado e auditoria do master, isolamento entre empresas, permissão,
// a resposta pelo painel contra um n8n falso (webhook painel_enviar) que também faz o papel do receptor,
// e Assumir / Devolver pra Sara (com o aviso painel_retomar e a pausa por resposta no celular).
// Roda pelo rodar.sh, depois do central.js (usa a Clínica Outra e o admin dela). Dados 100% fictícios.
const { chromium } = require('playwright');
const http = require('http');
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

// Guarda o corpo das respostas das ações da Inbox (o que de fato chega ao navegador) e, em "acoes",
// o id e os argumentos de cada ação chamada (para chamá-la de novo direto, sem a tela).
async function capturar(p, lista, acoes = []) {
  await p.route((u) => u.pathname === '/inbox', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    acoes.push({ id: route.request().headers()['next-action'], corpo: route.request().postData() || '' });
    const r = await route.fetch(); const corpo = await r.text(); lista.push(corpo);
    await route.fulfill({ response: r, body: corpo });
  });
}
// Chama uma ação do servidor direto (fetch com o id da ação), como faria alguém fora da tela.
const chamarAcao = (p, id, args) => p.evaluate(async ({ id, args }) => {
  const r = await fetch('/inbox', { method: 'POST', headers: { 'next-action': id, accept: 'text/x-component', 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(args) });
  return r.status + ' ' + await r.text();
}, { id, args });

// n8n falso (webhook painel_enviar): confere o segredo, guarda o pedido e, como o receptor faria depois do envio
// pela Meta, grava a mensagem no espelho com origem 'painel' e quem mandou em bruto.por.
const n8n = { pedidos: [], n: 0 };
const dolar = (t) => '$q$' + String(t).replace(/\$q\$/g, '') + '$q$';
const servidorN8n = http.createServer((req, res) => {
  let corpo = ''; req.on('data', (x) => { corpo += x; }); req.on('end', () => {
    const d = (() => { try { return JSON.parse(corpo); } catch { return {}; } })();
    n8n.pedidos.push({ url: req.url, segredo: req.headers['x-painel-segredo'], corpo: d });
    const responder = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers['x-painel-segredo'] !== process.env.N8N_WEBHOOK_SEGREDO) return responder({ ok: false, erro: 'segredo' });
    if (req.url === '/painel-retomar') return responder({ ok: true });
    if (String(d.texto).includes('FALHAR')) return responder({ ok: false, erro: '131047', detalhe: 'Resposta com DADO_SENSIVEL do n8n' });
    const wamid = `wamid.TESTE${++n8n.n}`;
    sql(`insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, status, status_em, enviada_em, bruto)
           values (${dolar(d.numero_id)}, ${dolar(d.para)}, '${wamid}', 'saida', 'painel', 'text', ${dolar(d.texto)}, 'enviada', now(), now(),
                   jsonb_build_object('origem', 'registro', 'por', ${dolar(d.por)}));
         update wa_conversas set ultima_em = now(), ultima_resumo = left(${dolar(d.texto)}, 160), ultima_direcao = 'saida'
          where numero_id = ${dolar(d.numero_id)} and wa_id = ${dolar(d.para)};`);
    responder({ ok: true, wamid });
  });
});

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
  await new Promise((r) => servidorN8n.listen(Number(process.env.PORTA_N8N || 3999), '127.0.0.1', r));
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
  ok('sem inbox.responder: aviso de somente leitura', (await p.getByText('Somente leitura: sua conta não tem a permissão para responder pelo painel.').count()) === 1);

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
  ok('sem inbox.responder: sem caixa de resposta', (await p.locator('#resposta-inbox').count()) === 0);
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

  // ---- Resposta pelo painel (fase 2.3): a empresa libera e a Amanda recebe "Responder pelo painel" ----
  sql(`update empresas set modulos = array_append(modulos, 'inbox.responder') where id = 'teste' and not 'inbox.responder' = any(modulos);
       update painel_vinculos set permissoes = array_append(permissoes, 'inbox.responder')
        where usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local') and empresa_id = 'teste';`);
  const idAmanda = sql(`select id from painel_usuarios where email = 'amanda@teste.local'`);
  [ctx, p] = await novo();
  const respR = [], acoesR = []; await capturar(p, respR, acoesR);
  await entrar(p, GERAL, 'amanda@teste.local');
  await item(p, 'Beatriz Ficticia').getByRole('button').click();
  await conversa(p).getByText('Pode ser às 15h?').waitFor({ timeout: 8000 }).catch(() => {});
  ok('secretária com a permissão vê a caixa de resposta', await p.locator('#resposta-inbox').isEnabled() && (await p.getByText(/Somente leitura/).count()) === 0);
  const audEnvioAntes = Number(sql(`select count(*) from central_auditoria where acao = 'enviar_mensagem'`));
  await p.fill('#resposta-inbox', 'Resposta fictícia pelo painel'); await p.press('#resposta-inbox', 'Enter');
  await conversa(p).locator('[data-id]', { hasText: 'Resposta fictícia pelo painel' }).waitFor({ timeout: 8000 }).catch(() => {});
  const bolhaR = conversa(p).locator('[data-id]', { hasText: 'Resposta fictícia pelo painel' });
  ok('Enter envia e a bolha aparece como "Painel · Amanda Teste"', (await bolhaR.count()) === 1 && ((await bolhaR.textContent()) || '').includes('Painel · Amanda Teste'),
    ((await bolhaR.textContent().catch(() => '')) || '').slice(0, 120));
  ok('a bolha "enviando…" some quando o espelho traz a mensagem', (await conversa(p).locator('[data-pendente]').count()) === 0 && (await p.inputValue('#resposta-inbox')) === '');
  const ped = n8n.pedidos[n8n.pedidos.length - 1] || { corpo: {} };
  ok('webhook recebe o segredo e os campos certos', ped.url === '/painel-enviar' && ped.segredo === 'segredo-n8n-de-teste' && ped.corpo.evento === 'painel_enviar'
    && ped.corpo.empresa === 'teste' && ped.corpo.numero_id === NUM && ped.corpo.para === BIA && ped.corpo.texto === 'Resposta fictícia pelo painel'
    && ped.corpo.por === 'Amanda Teste' && ped.corpo.usuario_id === idAmanda, JSON.stringify(ped).slice(0, 300));
  ok('painel não grava no espelho: a linha é a do "receptor" (n8n falso)', sql(`select count(*) || '|' || min(origem) from wa_mensagens where texto = 'Resposta fictícia pelo painel'`) === '1|painel');
  const audE = sql(`select a.empresa_id || '|' || a.alvo || '|' || coalesce(a.detalhe::text, '') from central_auditoria a where a.acao = 'enviar_mensagem' order by a.id desc limit 1`);
  ok('envio registrado na auditoria central, sem o texto', Number(sql(`select count(*) from central_auditoria where acao = 'enviar_mensagem'`)) === audEnvioAntes + 1
    && audE.startsWith(`teste|${NUM}:1001|`) && audE.includes('enviada') && !audE.includes('Resposta fictícia') && !audE.includes(BIA), audE);
  // Quem responde pelo painel assume a conversa (a Sara fica quieta)
  await p.waitForTimeout(800);
  ok('responder pelo painel assume a conversa no banco', sql(`select dono || '|' || dono_por || '|' || (dono_em is not null) from wa_conversas where wa_id='${BIA}'`) === 'humano|Amanda Teste|true');
  const cab = () => p.locator('section[aria-label^="Conversa com"] header');
  ok('cabeçalho mostra "Equipe atendendo · Amanda Teste" e o botão Devolver pra Sara',
    ((await cab().textContent()) || '').includes('Equipe atendendo · Amanda Teste') && (await p.getByRole('button', { name: 'Devolver pra Sara' }).count()) === 1);
  ok('lista marca a conversa com a equipe', (await item(p, 'Beatriz Ficticia').getByText('Equipe', { exact: true }).count()) === 1
    && (await item(p, 'Carlos Ficticio').getByText('Equipe', { exact: true }).count()) === 0);
  ok('assumir ao enviar fica na auditoria', sql(`select count(*) from central_auditoria where acao = 'assumir_conversa' and alvo = '${NUM}:1001' and detalhe::text like '%ao_enviar%'`) === '1');
  // Shift+Enter quebra a linha
  const nAntesShift = n8n.pedidos.length;
  await p.fill('#resposta-inbox', 'Linha 1'); await p.press('#resposta-inbox', 'Shift+Enter'); await p.type('#resposta-inbox', 'Linha 2'); await p.waitForTimeout(500);
  ok('Shift+Enter não envia', n8n.pedidos.length === nAntesShift && (await p.inputValue('#resposta-inbox')) === 'Linha 1\nLinha 2');
  await p.getByRole('button', { name: 'Enviar', exact: true }).click(); await p.waitForTimeout(2000);
  ok('botão Enviar manda o texto com a quebra de linha', (n8n.pedidos[n8n.pedidos.length - 1] || { corpo: {} }).corpo.texto === 'Linha 1\nLinha 2');
  // Erro da Meta: mensagem curta na própria caixa, sem o corpo da resposta do n8n
  await p.fill('#resposta-inbox', 'Isto vai FALHAR'); await p.press('#resposta-inbox', 'Enter'); await p.waitForTimeout(2000);
  const erroE = (await conversa(p).locator('[role=alert]').textContent().catch(() => '')) || '';
  ok('erro da Meta aparece na caixa, sem vazar a resposta', erroE.includes('A Meta recusou o envio (código 131047)') && !respR.join('\n').includes('DADO_SENSIVEL')
    && (await p.inputValue('#resposta-inbox')) === 'Isto vai FALHAR', erroE);
  await p.screenshot({ path: out + '23_inbox_resposta.png' });
  // Devolver pra Sara: volta para a IA e, com a última mensagem do contato, avisa o n8n para ela responder já
  sql(`update wa_conversas set ultima_direcao = 'entrada' where wa_id = '${BIA}'`);
  const nRet = n8n.pedidos.filter((x) => x.url === '/painel-retomar').length;
  let antesDono = acoesR.length;
  await p.getByRole('button', { name: 'Devolver pra Sara' }).click();
  await p.getByRole('button', { name: 'Assumir', exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
  const acaoDevolver = (acoesR[antesDono] || {}).id;
  ok('Devolver pra Sara: banco volta para a IA e o cabeçalho mostra "Sara atendendo"',
    sql(`select dono || '|' || dono_por from wa_conversas where wa_id='${BIA}'`) === 'ia|Amanda Teste' && ((await cab().textContent()) || '').includes('Sara atendendo'));
  const ret = n8n.pedidos.filter((x) => x.url === '/painel-retomar');
  const ultRet = ret[ret.length - 1] || { corpo: {} };
  ok('devolver avisa o n8n (painel_retomar) com segredo e sem texto da conversa', ret.length === nRet + 1 && ultRet.segredo === 'segredo-n8n-de-teste'
    && ultRet.corpo.evento === 'conversa_devolvida' && ultRet.corpo.numero_id === NUM && ultRet.corpo.wa_id === BIA && ultRet.corpo.por === 'Amanda Teste'
    && ultRet.corpo.empresa === 'teste' && Object.keys(ultRet.corpo).length === 5, JSON.stringify(ultRet.corpo));
  ok('devolver fica na auditoria', sql(`select count(*) from central_auditoria where acao = 'devolver_conversa' and alvo = '${NUM}:1001'`) === '1');
  // Assumir pelo botão (sem enviar nada)
  antesDono = acoesR.length;
  await p.getByRole('button', { name: 'Assumir', exact: true }).click();
  await p.getByRole('button', { name: 'Devolver pra Sara' }).waitFor({ timeout: 8000 }).catch(() => {});
  const acaoAssumir = (acoesR[antesDono] || {}).id;
  ok('Assumir pelo botão: equipe no banco, sem mandar mensagem', sql(`select dono from wa_conversas where wa_id='${BIA}'`) === 'humano'
    && n8n.pedidos.filter((x) => x.url === '/painel-retomar').length === nRet + 1);
  await p.screenshot({ path: out + '24_inbox_assumida.png' });
  // Devolver com a última mensagem da clínica: não avisa o n8n (não há o que responder)
  sql(`update wa_conversas set ultima_direcao = 'saida' where wa_id = '${BIA}'`);
  const devolve2 = await chamarAcao(p, acaoDevolver, [NUM, BIA]);
  ok('devolver sem mensagem do contato pendente não avisa o n8n', devolve2.startsWith('200') && sql(`select dono from wa_conversas where wa_id='${BIA}'`) === 'ia'
    && n8n.pedidos.filter((x) => x.url === '/painel-retomar').length === nRet + 1, devolve2.slice(0, 120));
  // Equipe respondeu pelo celular agora: a Sara fica pausada (sem mudar o dono)
  sql(`insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em) values ('${NUM}', '${DANI}', 'wamid.TDCEL', 'saida', 'celular', 'text', 'Respondi pelo celular', now() - interval '1 minute')`);
  await item(p, 'Daniela Ficticia').getByRole('button').click();
  await conversa(p).getByText('Respondi pelo celular').waitFor({ timeout: 8000 }).catch(() => {});
  const cabDani = ((await cab().textContent()) || '').replace(/\s+/g, ' ');
  ok('resposta pelo celular: "Sara pausada até" com o botão Assumir', /Sara pausada até \d{2}:\d{2} \(resposta pelo celular\)/.test(cabDani)
    && (await p.getByRole('button', { name: 'Assumir', exact: true }).count()) === 1 && sql(`select dono from wa_conversas where wa_id='${DANI}'`) === 'ia', cabDani.slice(0, 160));
  await p.screenshot({ path: out + '25_inbox_pausa_celular.png' });
  await item(p, 'Beatriz Ficticia').getByRole('button').click();
  await conversa(p).getByText('Pode ser às 15h?').waitFor({ timeout: 8000 }).catch(() => {});
  const acaoEnviar = (acoesR.find((a) => a.corpo.includes('Resposta fictícia pelo painel')) || {}).id;
  ok('id da ação de enviar capturado', Boolean(acaoEnviar));
  // Janela de 24 h fechada: caixa desligada com o motivo, e a ação recusa mesmo chamada direto
  await item(p, 'Carlos Ficticio').getByRole('button').click();
  await conversa(p).getByText('Obrigado, até mais').first().waitFor({ timeout: 8000 }).catch(() => {});
  ok('fora da janela: caixa desligada com a explicação', (await p.locator('#resposta-inbox').isDisabled())
    && (await p.getByText('Fora da janela de 24 h: a Meta só permite modelo aprovado. Responda pelo celular ou espere o paciente escrever.').count()) === 1
    && (await p.getByRole('button', { name: 'Enviar', exact: true }).isDisabled()));
  const nPed = n8n.pedidos.length;
  const fora = await chamarAcao(p, acaoEnviar, [NUM, CARLOS, 'Tentativa fora da janela']);
  ok('fora da janela: a ação recusa mesmo chamada direto', fora.includes('Fora da janela de 24 h') && n8n.pedidos.length === nPed, fora.slice(0, 160));
  // Sem a permissão: a ação recusa chamada direto e a tela volta a ser só leitura
  sql(`update painel_vinculos set permissoes = array_remove(permissoes, 'inbox.responder') where usuario_id = '${idAmanda}' and empresa_id = 'teste'`);
  const semPerm = await chamarAcao(p, acaoEnviar, [NUM, BIA, 'Tentativa sem permissão']);
  ok('sem inbox.responder: a ação recusa chamada direto', semPerm.includes('não tem permissão para responder') && n8n.pedidos.length === nPed, semPerm.slice(0, 160));
  const semPermDono = await chamarAcao(p, acaoAssumir, [NUM, BIA]);
  ok('sem inbox.responder: assumir recusa chamada direto', Boolean(acaoAssumir) && semPermDono.includes('não tem permissão para atender pelo painel')
    && sql(`select dono from wa_conversas where wa_id='${BIA}'`) === 'ia', semPermDono.slice(0, 160));
  await p.goto(GERAL + '/inbox'); await item(p, 'Beatriz Ficticia').getByRole('button').click(); await p.waitForTimeout(1500);
  ok('sem inbox.responder: a caixa some', (await p.locator('#resposta-inbox').count()) === 0 && (await p.getByText(/Somente leitura/).count()) === 1);
  ok('sem inbox.responder: sem botão Assumir, mas vê quem atende', (await p.getByRole('button', { name: 'Assumir', exact: true }).count()) === 0
    && ((await cab().textContent()) || '').includes('Sara atendendo'));
  await ctx.close();
  sql(`update empresas set modulos = array_remove(modulos, 'inbox.responder') where id = 'teste'`);

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
  console.log(res.join('\n')); await b.close(); servidorN8n.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
