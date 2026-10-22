// Fila "Comprovantes a conferir" (22/10): contador no menu, tela da fila, Conferido, marca "Baixado na Feegow"
// (token falso da Feegow na variável, migração 028), link para o cartão e permissão. Roda pelo rodar.sh depois do
// agenda.js. Dados fictícios.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const out = (process.env.SAIDA || __dirname + '/saida') + '/';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const aConferir = () => Number(sql(`select count(*) from pagamentos where not arquivado and conferido_em is null`));

(async () => {
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['pagamentos.ver','pagamentos.conferir'])) where id = 'teste'`);
  const contato = sql(`insert into contatos (nome, telefone) values ('Fila Comprovante Ficticia', '55009900' || lpad((floor(random() * 99999))::int::text, 5, '0')) returning id`);
  const cartao = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${contato}', 'outros', 'FILA-COMP alerta de comprovante', 'IA') returning id`);
  const p1 = sql(`insert into pagamentos (contato_id, valor, forma, criado_por, criado_em) values ('${contato}', 123.45, 'pix', 'IA', now() - interval '5 minutes') returning id`);
  const p2 = sql(`insert into pagamentos (contato_id, valor, forma, criado_por, analise, analise_motivos, alerta_atendimento_id) values ('${contato}', 77, 'pix', 'IA', 'suspeito', '["Valor diferente do combinado"]'::jsonb, '${cartao}') returning id`);
  const p3 = sql(`insert into pagamentos (contato_id, valor, criado_por, conferido_em, conferido_por) values ('${contato}', 50, 'IA', now() - interval '30 days', 'Amanda Teste') returning id`);
  const total = aConferir();

  const b = await lancar();
  const erros = [];
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  await entrar(p, 'planee@teste.local', '/empresas');
  await Promise.all([p.waitForURL(/\/(crm|inbox)$/), p.selectOption('#trocar-empresa', 'teste')]); await p.waitForTimeout(800);
  await p.locator('nav [data-contador-comprovantes]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('Comprovantes é uma tela do menu, com o contador', (await p.locator('nav a[href="/comprovantes"]').count()) === 1
    && (await p.getAttribute('nav [data-contador-comprovantes]', 'data-contador-comprovantes')) === String(total), `${total} no banco`);

  await p.click('nav a[href="/comprovantes"]'); await p.locator(`[data-comprovante="${p1}"]`).waitFor({ timeout: 10000 });
  const fila = await p.locator('[data-fila-comprovantes] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-comprovante')));
  ok('fila mostra os não conferidos, do mais novo ao mais antigo', fila.length === Math.min(total, 100) && fila.indexOf(p2) >= 0 && fila.indexOf(p2) < fila.indexOf(p1) && !fila.includes(p3), `${fila.length} na fila`);
  const item2 = p.locator(`[data-comprovante="${p2}"]`);
  ok('suspeito aparece com o motivo e o link para o cartão', ((await item2.textContent()) || '').includes('Valor diferente do combinado')
    && (await item2.getAttribute('data-estado')) === 'suspeito' && (await item2.locator('[data-abrir-cartao]').getAttribute('href')) === `/crm?cartao=${cartao}`);
  ok('marca "Baixado na Feegow" aparece (empresa com Feegow e migração 028)', (await p.locator(`[data-baixado="${p1}"]`).count()) === 1);
  await p.screenshot({ path: out + '22_comprovantes_fila.png' });

  // Conferido: sai da fila, contador desce, vai para "falta baixar na Feegow".
  await p.click(`[data-conferir="${p1}"]`); await p.locator(`[data-fila-comprovantes] [data-comprovante="${p1}"]`).waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
  ok('Conferido grava quem e quando', sql(`select (conferido_em is not null)::int || '|' || (conferido_por is not null)::int from pagamentos where id = '${p1}'`) === '1|1');
  ok('conferido sai da fila e o contador desce', (await p.locator(`[data-fila-comprovantes] [data-comprovante="${p1}"]`).count()) === 0
    && (await p.getAttribute('nav [data-contador-comprovantes]', 'data-contador-comprovantes')) === String(total - 1));
  ok('conferido sem baixa aparece em "falta baixar na Feegow"', (await p.locator(`[data-falta-baixar] [data-comprovante="${p1}"]`).count()) === 1
    && (await p.locator(`[data-falta-baixar] [data-comprovante="${p3}"]`).count()) === 0);
  await p.check(`[data-baixado="${p1}"]`); await p.locator(`[data-falta-baixar] [data-comprovante="${p1}"]`).waitFor({ state: 'detached', timeout: 8000 }).catch(() => undefined);
  ok('"Baixado na Feegow" grava quem e quando, com auditoria', sql(`select (baixado_em is not null)::int || '|' || (baixado_por is not null)::int from pagamentos where id = '${p1}'`) === '1|1'
    && sql(`select count(*) from painel_auditoria where recurso = 'pagamentos' and alvo_id = '${p1}' and detalhe->>'baixado' = 'true'`) === '1');
  await p.check(`[data-baixado="${p2}"]`); await p.waitForTimeout(1500);
  await p.uncheck(`[data-baixado="${p2}"]`); await p.waitForTimeout(1500);
  ok('tirar a marca de baixa', sql(`select (baixado_em is null)::int from pagamentos where id = '${p2}'`) === '1');
  await Promise.all([p.waitForURL(/\/crm\?cartao=/), p.click(`[data-comprovante="${p2}"] [data-abrir-cartao]`)]);
  await p.locator('[data-abrir-inbox]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('"Abrir cartão" leva ao CRM com o cartão aberto', ((await p.textContent('main')) || '').includes('FILA-COMP alerta de comprovante') && (await p.locator('[data-abrir-inbox]').count()) === 1);

  // Sem pagamentos.ver (secretária): sem a tela e a leitura recusa.
  const a = await (await b.newContext()).newPage();
  await entrar(a, 'amanda@teste.local', '/crm');
  const st = await a.evaluate(async () => (await fetch('/api/painel/ler/comprovantes?contar=1')).status);
  ok('sem pagamentos.ver: sem a tela no menu e a leitura recusa', (await a.locator('nav a[href="/comprovantes"]').count()) === 0 && st === 403, String(st));

  ok('sem erro de página', erros.length === 0, erros.join(' | '));
  await b.close();
  sql(`update pagamentos set arquivado = true where contato_id = '${contato}'`);
  console.log(res.join('\n'));
  const falhas = res.filter((r) => r.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram.`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
