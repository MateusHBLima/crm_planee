// Aba Dúvidas (módulo duvidas, 03/11) e painel instalável (PWA). Roda pelo rodar.sh, na empresa de teste.
// Confere: a tela só existe com o módulo ligado e a permissão; sem o endereço do agente, avisa; a pergunta vai ao agente
// (falso, nesta porta) com o segredo, a empresa, a pessoa, o histórico e pode_ver_valores pela permissão; erro e demora do
// agente aparecem na conversa; cada pessoa vê só as suas; o Registro guarda sem o texto; a outra empresa não recebe a
// tabela. PWA: sem crm_config "app" o endereço não oferece instalar; com ele, manifesto e ícone da empresa do endereço.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const PORTA = Number(process.env.PORTA_DUVIDAS || 3995);
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const MOD_SQL = fs.readFileSync(path.join(__dirname, '../../supabase/modulos/duvidas/001_duvidas.sql'), 'utf8');
const daPessoa = (email) => `empresa_id = 'teste' and usuario_id = (select id from painel_usuarios where email = '${email}')`;
const darPermissao = (email, p) => sql(`update painel_vinculos set permissoes = array(select distinct unnest(permissoes || array['${p}'])) where ${daPessoa(email)}`);
const tirarPermissao = (email, p) => sql(`update painel_vinculos set permissoes = array_remove(permissoes, '${p}') where ${daPessoa(email)}`);

async function entrar(p, email, destino = '/crm') {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

(async () => {
  // ---- Agente falso (o n8n da empresa) ----
  const pedidos = [];
  const agente = http.createServer((req, resp) => {
    let corpo = ''; req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const j = JSON.parse(corpo || '{}');
      pedidos.push({ segredo: req.headers['x-painel-segredo'], caminho: req.url, j });
      const responder = (o, status = 200) => { resp.writeHead(status, { 'content-type': 'application/json' }); resp.end(JSON.stringify(o)); };
      if (/demora/.test(j.pergunta)) return setTimeout(() => responder({ resposta: 'tarde demais' }), 6000);
      if (/quebrado/.test(j.pergunta)) return responder({ resposta: 'O sistema de impressoras não respondeu agora, tente de novo em 1 minuto.', erro: 'indisponivel' });
      return responder({ resposta: `Resposta fictícia para: ${j.pergunta}\nSegunda linha.`, erro: null });
    });
  });
  await new Promise((r) => agente.listen(PORTA, '127.0.0.1', r));

  const b = await lancar(); const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  await entrar(p, 'amanda@teste.local');

  // ---- Desligado: sem tela, sem menu ----
  darPermissao('amanda@teste.local', 'm.duvidas.ver');
  await p.goto(B + '/duvidas'); await p.waitForLoadState('networkidle');
  ok('módulo desligado: /duvidas volta para outra tela e o menu não tem Dúvidas', !p.url().endsWith('/duvidas')
    && (await p.locator('nav a[href="/duvidas"]').count()) === 0, p.url());

  // ---- Marcado sem o SQL: ainda nada ----
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['m.duvidas.ver','m.duvidas.valores'])) where id = 'teste'`);
  await p.goto(B + '/duvidas'); await p.waitForLoadState('networkidle');
  ok('marcado sem o SQL: a tela ainda não abre', !p.url().endsWith('/duvidas'), p.url());

  // ---- SQL no banco certo: liga ----
  sql(MOD_SQL.replace('TROQUE_PELO_ID_DA_EMPRESA', 'teste'));
  ok('SQL do módulo registra duvidas/001', sql(`select count(*) from painel_migracoes where id = 'duvidas/001'`) === '1');
  await p.goto(B + '/duvidas'); await p.waitForLoadState('networkidle');
  ok('ligado: a tela abre e o menu tem Dúvidas', p.url().endsWith('/duvidas') && (await p.locator('nav a[href="/duvidas"]').count()) >= 1, p.url());
  ok('sem m.duvidas.valores: a tela avisa que valores não aparecem', ((await p.locator('main').textContent()) || '').includes('Valores e preços não aparecem'));

  // ---- Sem o endereço do agente: avisa e não grava resposta ----
  await p.fill('[data-duvida-texto]', 'Pergunta sem agente');
  await p.click('[data-duvida-enviar]'); await p.waitForTimeout(1200);
  ok('sem crm_config duvidas: a tela avisa e devolve o texto ao campo', ((await p.locator('[data-duvida-erro]').textContent()) || '').includes('ainda não foi ligado')
    && (await p.inputValue('[data-duvida-texto]')) === 'Pergunta sem agente');

  // ---- Com o agente ----
  sql(`insert into crm_config (chave, valor) values ('duvidas', '{"url":"http://127.0.0.1:${PORTA}/webhook/painel-duvidas"}') on conflict (chave) do update set valor = excluded.valor`);
  await p.fill('[data-duvida-texto]', 'Quantos chamados estão parados?');
  await p.press('[data-duvida-texto]', 'Enter');
  await p.locator('[data-duvida] [data-resposta]').first().waitFor({ timeout: 10000 });
  const r1 = pedidos.at(-1);
  ok('Enter envia e a resposta aparece com a quebra de linha', ((await p.locator('[data-duvida] [data-resposta]').first().innerText()) || '').includes('Resposta fictícia para: Quantos chamados estão parados?\nSegunda linha.'));
  ok('o agente recebe o segredo, a empresa e a pessoa', r1?.segredo === 'segredo-n8n-de-teste' && r1?.j.empresa === 'teste' && r1?.j.usuario?.nome === 'Amanda Teste'
    && r1?.caminho === '/webhook/painel-duvidas', JSON.stringify(r1).slice(0, 200));
  const id1 = sql(`select id from mod_duvidas order by criado_em desc limit 1`);
  ok('o agente recebe id_pergunta = id gravado, histórico vazio e pode_ver_valores false', r1?.j.id_pergunta === id1 && Array.isArray(r1?.j.historico)
    && r1.j.historico.length === 0 && r1.j.pode_ver_valores === false);
  ok('pergunta e resposta gravadas no banco da empresa', sql(`select erro is null and resposta like 'Resposta fictícia%' and not pode_ver_valores from mod_duvidas where id = '${id1}'`) === 't');

  darPermissao('amanda@teste.local', 'm.duvidas.valores');
  await p.reload(); await p.waitForLoadState('networkidle');
  ok('com m.duvidas.valores: sem o aviso de valores', !((await p.locator('main').textContent()) || '').includes('Valores e preços não aparecem'));
  ok('a conversa continua lá depois de recarregar', (await p.locator('[data-duvida]').count()) === 1);
  await p.fill('[data-duvida-texto]', 'Qual o preço do toner?');
  await p.click('[data-duvida-enviar]');
  await p.locator('[data-duvida]').nth(1).locator('[data-resposta]').waitFor({ timeout: 10000 });
  const r2 = pedidos.at(-1);
  ok('segunda pergunta: histórico com a primeira e pode_ver_valores true', r2?.j.pode_ver_valores === true && r2.j.historico.length === 1
    && r2.j.historico[0].pergunta === 'Quantos chamados estão parados?' && /^Resposta fictícia/.test(r2.j.historico[0].resposta), JSON.stringify(r2?.j.historico));

  // ---- Erro e demora do agente ----
  await p.fill('[data-duvida-texto]', 'Sistema quebrado?');
  await p.click('[data-duvida-enviar]');
  await p.locator('[data-duvida]').nth(2).locator('[data-resposta]').waitFor({ timeout: 10000 });
  ok('erro do agente: mostra a frase dele marcada como erro', (await p.locator('[data-duvida]').nth(2).locator('[data-resposta]').getAttribute('data-erro')) === 'indisponivel'
    && ((await p.locator('[data-duvida]').nth(2).locator('[data-resposta]').innerText()) || '').includes('não respondeu agora'));
  await p.fill('[data-duvida-texto]', 'Esta demora?');
  await p.click('[data-duvida-enviar]');
  ok('enquanto espera, aparece "Procurando a resposta"', (await p.locator('[data-pensando]').count()) === 1);
  await p.locator('[data-duvida]').nth(3).locator('[data-resposta]').waitFor({ timeout: 15000 });
  ok('agente que passa do limite: a tela diz que demorou', ((await p.locator('[data-duvida]').nth(3).locator('[data-resposta]').innerText()) || '').includes('demorou demais'));
  await p.fill('[data-duvida-texto]', 'Depois do erro');
  await p.click('[data-duvida-enviar]');
  await p.locator('[data-duvida]').nth(4).locator('[data-resposta]').waitFor({ timeout: 10000 });
  ok('o histórico enviado não leva as respostas com erro', pedidos.at(-1)?.j.historico.length === 2, String(pedidos.at(-1)?.j.historico.length));

  await p.screenshot({ path: (process.env.SAIDA || __dirname + '/saida') + '/duvidas.png' }).catch(() => undefined);

  // ---- Registro sem o texto ----
  ok('Registro: uma linha por pergunta, sem o texto', sql(`select count(*) from central_auditoria where acao = 'duvidas_perguntar' and empresa_id = 'teste'`) === '5'
    && sql(`select count(*) from central_auditoria where acao = 'duvidas_perguntar' and detalhe::text like '%toner%'`) === '0');

  // ---- Cada pessoa vê só as suas (o gestor, na mesma empresa) ----
  darPermissao('gestor@teste.local', 'm.duvidas.ver');
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } }); const m = await ctx2.newPage();
  await entrar(m, 'gestor@teste.local', '/duvidas');
  if (!m.url().endsWith('/duvidas')) { await m.goto(B + '/duvidas'); await m.waitForLoadState('networkidle'); }
  ok('outra pessoa abre a aba e não vê as perguntas da Amanda', m.url().endsWith('/duvidas') && (await m.locator('[data-duvida]').count()) === 0, m.url());
  await ctx2.close();

  // ---- Celular: o campo fica à vista e nada sai para o lado ----
  const cel = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); const c = await cel.newPage();
  await entrar(c, 'amanda@teste.local', '/duvidas');
  if (!c.url().endsWith('/duvidas')) { await c.goto(B + '/duvidas'); await c.waitForLoadState('networkidle'); }
  const caixa = await c.locator('[data-duvida-texto]').boundingBox();
  const largura = await c.evaluate(() => document.documentElement.scrollWidth);
  ok('celular: campo de pergunta visível e sem rolagem para o lado', Boolean(caixa) && caixa.y + caixa.height <= 780 && largura <= 390, `${JSON.stringify(caixa)} ${largura}`);
  await cel.close();

  // ---- Outra empresa não recebe nada ----
  ok('outra empresa: a tabela do módulo não existe no banco dela', sql(`select count(*) from pg_tables where tablename = 'mod_duvidas'`, process.env.OUTRA_DATABASE_URL) === '0');

  // ---- Sem permissão: some da tela ----
  tirarPermissao('amanda@teste.local', 'm.duvidas.ver');
  await p.goto(B + '/duvidas'); await p.waitForLoadState('networkidle');
  ok('sem m.duvidas.ver: a tela não abre', !p.url().endsWith('/duvidas'), p.url());
  ok('sem erro de JavaScript nas telas', erros.length === 0, erros.join(' | '));
  await ctx.close(); await b.close();

  // ---- PWA: manifesto e ícone pela empresa do endereço ----
  const HOST = 'app-teste.localhost';
  sql(`insert into empresa_dominios (dominio, empresa_id) values ('${HOST}', 'teste') on conflict do nothing`);
  const pedir = (c2) => fetch(B + c2, { headers: { 'x-forwarded-host': HOST }, redirect: 'manual' });
  let r = await pedir('/manifest.webmanifest');
  ok('sem crm_config app: manifesto 404 (sem login)', r.status === 404, String(r.status));
  r = await pedir('/entrar');
  ok('sem crm_config app: a página não aponta para manifesto', r.status === 200 && !(await r.text()).includes('rel="manifest"'));
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  sql(`insert into crm_config (chave, valor) values ('app', '${JSON.stringify({ nome: 'Empresa Teste Ficticia', nome_curto: 'Teste', cor: '#0b5cab', icone_192: PNG, icone_512: PNG })}')
       on conflict (chave) do update set valor = excluded.valor`);
  r = await pedir('/manifest.webmanifest');
  const man = await r.json().catch(() => null);
  ok('com crm_config app: manifesto com nome, cor e ícones', r.status === 200 && (r.headers.get('content-type') || '').includes('manifest+json')
    && man?.name === 'Empresa Teste Ficticia' && man?.short_name === 'Teste' && man?.theme_color === '#0b5cab' && man?.display === 'standalone'
    && man?.icons?.some((i) => i.src === '/app-icone/512' && i.purpose === 'maskable'), JSON.stringify(man).slice(0, 200));
  r = await pedir('/app-icone/192');
  const bytes = Buffer.from(await r.arrayBuffer());
  ok('ícone 192 sai como PNG, sem login', r.status === 200 && r.headers.get('content-type') === 'image/png' && bytes.equals(Buffer.from(PNG.split(',')[1], 'base64')));
  ok('ícone de tamanho que não existe: 404', (await pedir('/app-icone/64')).status === 404);
  r = await pedir('/entrar');
  const html = await r.text();
  ok('com crm_config app: a página aponta o manifesto e o ícone da Apple', html.includes('rel="manifest"') && html.includes('href="/manifest.webmanifest"') && html.includes('apple-touch-icon'));
  r = await fetch(B + '/manifest.webmanifest', { redirect: 'manual' });
  ok('endereço de outra empresa (ou geral) não leva o app desta', r.status === 404, String(r.status));
  sql(`update crm_config set valor = jsonb_set(valor, '{icone_192}', '"data:image/png;base64,bmFvLWVoLXBuZw=="') where chave = 'app'`);
  ok('ícone que não é PNG: o app não é oferecido', (await pedir('/manifest.webmanifest')).status === 404);

  // ---- Limpeza ----
  sql(`delete from crm_config where chave in ('app', 'duvidas'); delete from empresa_dominios where dominio = '${HOST}';
       update empresas set modulos = array_remove(array_remove(modulos, 'm.duvidas.ver'), 'm.duvidas.valores') where id = 'teste'`);
  tirarPermissao('amanda@teste.local', 'm.duvidas.valores');
  tirarPermissao('gestor@teste.local', 'm.duvidas.ver');
  agente.close();

  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas}/${res.length} ok`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
