// Testes da auditoria de segurança de 01/10: cabeçalhos, rota do Traefik, redirecionamento depois do login,
// CPF na API, lote do MCP, cartões sombra, conflito ao mover e limite de tentativas no login.
// Roda pelo rodar.sh, depois do central.js (mesmo app e mesmo Auth falso).
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const PORTA = new URL(B).port;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino = '/crm') {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

(async () => {
  // ---- Cabeçalhos de segurança ----
  let r = await fetch(B + '/entrar');
  ok('cabeçalhos: não abre dentro de outro site', r.headers.get('x-frame-options') === 'DENY' && (r.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"));
  ok('cabeçalhos: HSTS, nosniff, Referrer-Policy e sem X-Powered-By', Boolean(r.headers.get('strict-transport-security')) && r.headers.get('x-content-type-options') === 'nosniff'
    && Boolean(r.headers.get('referrer-policy')) && !r.headers.get('x-powered-by'));

  // ---- /api/traefik só pela rede interna ----
  // Node não resolve *.localhost: chama o localhost com o Host de um domínio público.
  const status = await new Promise((ok2) => require('http').get({ host: '127.0.0.1', port: PORTA, path: '/api/traefik', headers: { host: 'adm.exemplo.test' } }, (x) => { x.resume(); ok2(x.statusCode); }).on('error', () => ok2(0)));
  ok('/api/traefik pelo endereço público dá 404', status === 404, String(status));
  r = await fetch(B + '/api/traefik');
  ok('/api/traefik pela rede interna continua respondendo', r.status === 200, String(r.status));

  // ---- CPF na API e lote do MCP ----
  const chave = 'teste-seg-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Segurança teste', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura'])`);
  const api = (caminho, init = {}) => fetch(B + caminho, { ...init, headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' } })
    .then(async (x) => ({ status: x.status, texto: await x.text() }));
  r = await api('/api/v1/contatos?limite=200');
  ok('API não devolve CPF inteiro', r.status === 200 && !r.texto.includes('11122233344') && r.texto.includes('***44'), r.texto.slice(0, 160));
  const idJ = sql("select id from contatos where documento='11122233344' limit 1");
  r = await api('/api/v1/contatos/' + idJ);
  ok('API (obter) também mascara', r.status === 200 && !r.texto.includes('11122233344'));
  r = await api('/api/mcp', { method: 'POST', body: JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'ping' }))) });
  ok('MCP recusa lote com mais de 20 chamadas', r.status === 400, String(r.status));

  const b = await lancar();
  const erros = [];
  const novo = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => erros.push(e.message.slice(0, 120))); return [c, p]; };

  // ---- Redirecionamento depois do login só para o próprio painel ----
  let [ctx, p] = await novo();
  await p.goto(B + '/entrar?volta=' + encodeURIComponent('/\\exemplo-de-fora.test'));
  await p.fill('#email', 'amanda@teste.local'); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(1000);
  ok('login não leva para outro site', new URL(p.url()).hostname === 'localhost', p.url());
  await ctx.close();

  // ---- Cartões sombra: a secretária não vê; o master vê sem botões ----
  sql("insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('00000000-0000-4000-8000-000000000002','receita','[SOMBRA] Cartão sombra de teste','IA')");
  const idSombra = sql("select id from atendimentos where resumo like '[SOMBRA] Cartão sombra de teste%'");
  [ctx, p] = await novo(); await entrar(p, 'amanda@teste.local');
  ok('secretária não vê cartão sombra', (await p.locator('article', { hasText: 'Cartão sombra de teste' }).count()) === 0);
  await ctx.close();
  [ctx, p] = await novo(); await entrar(p, 'planee@teste.local', '/empresas');
  await Promise.all([p.waitForURL(/\/inbox$/), p.selectOption('#trocar-empresa', 'teste')]); await p.waitForTimeout(800);
  await p.goto(B + '/crm'); await p.waitForTimeout(800);
  const sombra = p.locator('article', { hasText: 'Cartão sombra de teste' });
  ok('master vê o cartão sombra com o selo, sem botões de mover', (await sombra.count()) === 1 && (await sombra.locator('text=sombra').count()) >= 1
    && (await sombra.locator('button:has-text("Assumir")').count()) === 0);
  await p.click('button:has-text("Só sombra")'); await p.waitForTimeout(200);
  ok('master filtra só os cartões sombra', (await p.locator('article').count()) === 1);
  await p.click('button:has-text("Todos")');
  ok('cartão sombra continua aguardando (ninguém moveu)', sql(`select etapa from atendimentos where id='${idSombra}'`) === 'aguardando');
  await ctx.close();

  // ---- Conflito: a colega já mudou o cartão ----
  [ctx, p] = await novo(); await entrar(p, 'gestor@teste.local');
  const alvo = sql("select id from atendimentos where etapa='em_atendimento' and not arquivado and resumo not like '[SOMBRA]%' order by aberto_em desc limit 1");
  const resumoAlvo = sql(`select left(resumo, 24) from atendimentos where id='${alvo}'`);
  const card = p.locator('article', { hasText: resumoAlvo }).first();
  sql(`update atendimentos set etapa='finalizado', finalizado_em=now() where id='${alvo}'`); // outra pessoa finalizou
  await card.getByRole('button', { name: 'Finalizar' }).click(); await p.waitForTimeout(1500);
  const txt = ((await p.textContent('main [role=status]')) || '');
  ok('mover cartão desatualizado avisa em vez de sobrescrever', txt.includes('Outra pessoa já mudou'), txt.slice(0, 120));
  await ctx.close();

  // ---- Limite de tentativas no login ----
  [ctx, p] = await novo();
  for (let i = 0; i < 8; i++) {
    await p.goto(B + '/entrar'); await p.fill('#email', 'semacesso@teste.local'); await p.fill('#senha', 'errada' + i);
    await p.click('button[type=submit]'); await p.waitForTimeout(400);
  }
  await p.goto(B + '/entrar'); await p.fill('#email', 'semacesso@teste.local'); await p.fill('#senha', 'senha123');
  await p.click('button[type=submit]'); await p.waitForTimeout(800);
  ok('depois de 8 erros, o login daquele e-mail espera 15 min (mesmo com a senha certa)', ((await p.textContent('[role=alert]')) || '').includes('Muitas tentativas'));
  await ctx.close();

  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
