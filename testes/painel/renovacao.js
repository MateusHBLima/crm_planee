// Renovação do token: rodar com o Auth falso em TTL=30 (o token vence durante o teste).
const { chromium } = require('playwright');
const B = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.goto(B + '/crm'); await p.fill('#email', 'amanda@teste.local'); await p.fill('#senha', 'senha123'); await p.click('button[type=submit]'); await p.waitForTimeout(2000);
  // Espera as leituras em segundo plano (antecipadas, faixa) terminarem: cada uma pode renovar e regravar o cookie.
  await p.waitForLoadState('networkidle').catch(() => undefined); await p.waitForTimeout(1500);
  const a1 = (await ctx.cookies()).find((c) => c.name === 'pp_at').value;
  await p.goto(B + '/crm'); await p.waitForLoadState('networkidle').catch(() => undefined); await p.waitForTimeout(1000);
  const a2 = (await ctx.cookies()).find((c) => c.name === 'pp_at').value;
  const cards = await p.locator('article').count();
  await p.waitForTimeout(31000); // o token de 30 s vence
  await p.locator('article').first().getByRole('button').first().click(); await p.waitForTimeout(1200);
  const aberto = await p.locator('aside[aria-label^="Atendimento"]').count();
  await p.fill('#nova-nota', 'nota depois do token vencer'); await p.click('text=Salvar nota'); await p.waitForTimeout(1500);
  const hist = await p.textContent('aside ol');
  const ok = a1 !== a2 && cards > 0 && aberto === 1 && hist.includes('depois do token vencer') && p.url().endsWith('/crm');
  console.log((ok ? 'OK   ' : 'FALHA') + ' renovação do token: renovou=' + (a1 !== a2) + ' cartões=' + cards + ' nota salva depois de vencer=' + hist.includes('depois do token vencer'));
  if (!ok) process.exitCode = 1;
  await b.close();
})();
