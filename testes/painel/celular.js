// Celular e tablet (27/10): o painel abre no celular com uma barra fina no topo e o menu em gaveta; a Inbox mostra
// a lista ou a conversa (uma por vez) com a caixa de resposta à vista; no tablet a conversa não fica espremida;
// nenhuma tela sai para o lado; no computador nada muda. Roda depois do inbox.js. Dados 100% fictícios.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${process.env.DATABASE_URL}"`, { input: q, env: process.env }).toString().trim();
const PORTA = new URL(process.env.BASE_URL || 'http://localhost:3100').port;
const GERAL = `http://localhost:${PORTA}`;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, senha = 'senha123', destino = '/inbox') {
  await p.goto(GERAL + destino); await p.fill('#email', email); await p.fill('#senha', senha);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const NUM = '100000000000001', WA = '5547900009901';
const caixa = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, visivel: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; }, sel);
const sobra = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

(async () => {
  const tinha = sql(`select array_to_string(modulos, ',') from empresas where id = 'teste'`);
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['inbox.ver','inbox.responder','crm.ver'])) where id = 'teste';
       update painel_vinculos set permissoes = array(select distinct unnest(permissoes || array['inbox.ver','inbox.responder','crm.ver']))
        where usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local') and empresa_id = 'teste';
       delete from wa_mensagens where wa_id = '${WA}'; delete from wa_conversas where wa_id = '${WA}'; delete from wa_contatos where wa_id = '${WA}';
       insert into wa_contatos (numero_id, wa_id, nome_salvo) values ('${NUM}', '${WA}', 'Celia Celular Ficticia');
       insert into wa_conversas (numero_id, wa_id, ultima_em, ultima_resumo, ultima_direcao, ultima_entrada_em, nao_lidas)
         values ('${NUM}', '${WA}', now() + interval '1 minute', 'Oi, tudo bem?', 'entrada', now() + interval '1 minute', 1);
       insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em)
         select '${NUM}', '${WA}', 'wamid.CEL' || g, case when g % 2 = 0 then 'saida' else 'entrada' end, case when g % 2 = 0 then 'api' else 'contato' end,
                'text', 'Mensagem fictícia número ' || g || ' para encher a conversa no celular', now() - make_interval(mins => 40 - g)
           from generate_series(1, 30) g;`);
  const b = await lancar();
  const erros = [];
  const novo = async (vp, movel) => { const c = await b.newContext({ viewport: vp, isMobile: movel, hasTouch: movel }); const p = await c.newPage(); p.on('pageerror', (e) => erros.push(p.url() + ' ' + e.message.slice(0, 120))); return [c, p]; };

  // ---- Celular (390 x 844) ----
  let [ctx, p] = await novo({ width: 390, height: 844 }, true);
  await entrar(p, 'amanda@teste.local');
  const barra = await caixa(p, 'header[class*="barraCelular"]');
  ok('celular: barra fina no topo (até 56 px)', barra && barra.visivel && barra.top === 0 && barra.bottom <= 56, JSON.stringify(barra));
  const lateral = await caixa(p, '#menu-lateral');
  ok('celular: menu fechado não aparece nem ocupa a tela', lateral && (!lateral.visivel || lateral.right <= 0), JSON.stringify(lateral));
  ok('celular: o título da barra é a tela atual', ((await p.textContent('header[class*="barraCelular"]')) || '').includes('Inbox'));
  await p.click('[data-menu-celular]'); await p.waitForTimeout(400);
  const aberta = await caixa(p, '#menu-lateral');
  ok('celular: o ☰ abre a gaveta com as telas', aberta && aberta.visivel && aberta.left >= 0 && await p.locator('#menu-lateral nav a', { hasText: 'CRM' }).isVisible(), JSON.stringify(aberta));
  ok('celular: botão do menu diz que está aberto', (await p.getAttribute('[data-menu-celular]', 'aria-expanded')) === 'true');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok('celular: Esc fecha a gaveta', (await p.getAttribute('[data-menu-celular]', 'aria-expanded')) === 'false');
  await p.click('[data-menu-celular]'); await p.waitForTimeout(400);
  await Promise.all([p.waitForURL('**/crm', { timeout: 10000 }).catch(() => {}), p.locator('#menu-lateral nav a', { hasText: 'CRM' }).click()]);
  await p.waitForTimeout(800);
  ok('celular: tocar numa tela navega e fecha a gaveta', p.url().endsWith('/crm') && (await p.getAttribute('[data-menu-celular]', 'aria-expanded')) === 'false'
    && ((await p.textContent('header[class*="barraCelular"]')) || '').includes('CRM'), p.url());
  ok('celular: o CRM não sai para o lado', (await sobra(p)) <= 0, String(await sobra(p)));
  // 28/10: no iPhone a página rolava junto com o quadro (100vh maior que a tela) e o quadro rolava de lado e para baixo
  // ao mesmo tempo. Agora: altura medida da tela, página travada, uma coluna por vez escolhida nas abas de assunto.
  await p.locator('[data-colunas-celular]').waitFor({ timeout: 8000 }).catch(() => {});
  ok('celular: a página usa a altura medida da tela e não rola por fora', await p.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'
    && /px$/.test(document.documentElement.style.getPropertyValue('--altura-visivel'))), await p.evaluate(() => document.documentElement.style.getPropertyValue('--altura-visivel')));
  const abas = p.locator('[data-colunas-celular] [role=tab]');
  const nAbas = await abas.count();
  ok('celular: CRM com abas de assunto e uma coluna só no quadro', nAbas >= 2 && (await p.locator('[class*="quadroCaixa"] section').count()) === 1, `${nAbas} abas`);
  ok('celular: o quadro não rola de lado', await p.evaluate(() => { const q = document.querySelector('[data-quadro]'); return !q || q.scrollWidth <= q.clientWidth + 1; }));
  const segunda = await abas.nth(1).getAttribute('data-coluna');
  await abas.nth(1).click(); await p.waitForTimeout(300);
  ok('celular: tocar numa aba troca a coluna', (await abas.nth(1).getAttribute('aria-selected')) === 'true'
    && (await p.locator('[class*="quadroCaixa"] section').first().getAttribute('aria-label')) === (await abas.nth(1).textContent()).replace(/\s*\d+\s*$/, '').trim(), segunda);
  ok('celular: filtros escondidos até tocar em Filtros', !(await p.locator('#ver-crm').isVisible()));
  await p.click('[data-filtros-celular]'); await p.waitForTimeout(200);
  ok('celular: Filtros mostra o resto da barra', await p.locator('#ver-crm').isVisible());
  await p.click('[data-filtros-celular]');

  await p.goto(GERAL + '/inbox'); await p.waitForLoadState('networkidle').catch(() => {});
  const item = p.locator('section[aria-label="Conversas"] li', { hasText: 'Celia Celular Ficticia' });
  await item.waitFor({ timeout: 8000 }).catch(() => {});
  ok('celular: a lista da Inbox começa logo abaixo da barra', ((await caixa(p, 'section[aria-label="Conversas"]'))?.top ?? 999) <= 70);
  await item.getByRole('button').click();
  await p.getByText('Mensagem fictícia número 30', { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  const resp = await caixa(p, '#resposta-inbox');
  ok('celular: na conversa, a caixa de resposta fica à vista sem rolar a página', resp && resp.bottom <= 844 && resp.top > 400, JSON.stringify(resp));
  ok('celular: a página não rola (quem rola é a conversa)', (await p.evaluate(() => document.documentElement.scrollHeight)) <= 846, String(await p.evaluate(() => document.documentElement.scrollHeight)));
  ok('celular: cabeçalho da conversa compacto (até 160 px)', ((await caixa(p, 'header[class*="cabeca"]'))?.bottom ?? 999) - ((await caixa(p, 'header[class*="cabeca"]'))?.top ?? 0) <= 160, JSON.stringify(await caixa(p, 'header[class*="cabeca"]')));
  await p.click('[data-menu-mais]'); await p.waitForTimeout(300);
  const folha = await caixa(p, '[role=menu]');
  ok('celular: o Mais abre de baixo, inteiro na tela', folha && folha.bottom <= 844 && folha.left >= 0 && folha.right <= 390 && folha.top > 500, JSON.stringify(folha));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('celular: só a conversa aparece, com Voltar', !(await p.locator('section[aria-label="Conversas"]').isVisible()) && await p.getByRole('button', { name: 'Voltar para a lista' }).isVisible());
  ok('celular: a conversa não sai para o lado', (await sobra(p)) <= 0);
  const fonte = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#resposta-inbox')).fontSize));
  ok('celular: campo com letra de 16 px (o iPhone não dá zoom ao tocar)', fonte >= 16, String(fonte));
  for (const t of ['crm', 'equipe', 'planee']) {
    await p.goto(GERAL + '/' + t); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(500);
    ok(`celular: /${t} não sai para o lado`, (await sobra(p)) <= 0, String(await sobra(p)));
  }
  await ctx.close();

  // ---- Tablet (768 x 1024): lista ou conversa, uma por vez ----
  [ctx, p] = await novo({ width: 768, height: 1024 }, true);
  await entrar(p, 'amanda@teste.local');
  ok('tablet: menu lateral fixo, sem a barra do celular', await p.locator('#menu-lateral').isVisible() && !(await p.locator('header[class*="barraCelular"]').isVisible()));
  await p.locator('section[aria-label="Conversas"] li', { hasText: 'Celia Celular Ficticia' }).getByRole('button').click();
  await p.waitForTimeout(1200);
  const conv = await caixa(p, '[class*="compositor"]');
  ok('tablet: a conversa ocupa a largura toda (antes ficava com ~120 px)', conv && conv.width > 480, JSON.stringify(conv));
  ok('tablet: a lista sai enquanto a conversa está aberta', !(await p.locator('section[aria-label="Conversas"]').isVisible()));
  await ctx.close();

  // ---- Computador (1366 x 768): igual a antes ----
  [ctx, p] = await novo({ width: 1366, height: 768 }, false);
  await entrar(p, 'amanda@teste.local');
  await p.locator('section[aria-label="Conversas"] li', { hasText: 'Celia Celular Ficticia' }).getByRole('button').click();
  await p.waitForTimeout(1000);
  ok('computador: lista e conversa lado a lado, menu fixo, sem a barra do celular',
    await p.locator('section[aria-label="Conversas"]').isVisible() && await p.locator('#resposta-inbox').isVisible()
    && await p.locator('#menu-lateral').isVisible() && !(await p.locator('header[class*="barraCelular"]').isVisible()));
  await ctx.close();

  sql(`delete from wa_mensagens where wa_id = '${WA}'; delete from wa_conversas where wa_id = '${WA}'; delete from wa_contatos where wa_id = '${WA}';
       update empresas set modulos = string_to_array('${tinha}', ',') where id = 'teste';`);
  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
