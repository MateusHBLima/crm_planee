// Etiquetas dos cartões (migração 032, 30/10). Roda pelo rodar.sh, na empresa de teste (banco do DATABASE_URL).
// Confere: API das etiquetas (cor do Trello, listas de ids), etiquetas no atendimento pela API, e na tela o botão
// "Etiqueta" no lugar de Finalizar/Passar, pôr e tirar, mover para a coluna de destino só a partir de "mover_de",
// tirar não move, o detalhe sem a etapa e com a coluna, o histórico, e a empresa voltando ao normal sem etiquetas.
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const out = (process.env.SAIDA || __dirname + '/saida') + '/';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => { res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : '')); };

async function entrar(p, email) {
  await p.goto(B + '/crm'); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

(async () => {
  const chave = 'teste-etq-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Etiquetas teste', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm','config'])`);
  const api = (caminho, init = {}) => fetch(B + caminho, { ...init, headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json', ...(init.headers || {}) } })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const post = (c, corpo) => api(c, { method: 'POST', body: JSON.stringify(corpo) });
  const patch = (c, corpo) => api(c, { method: 'PATCH', body: JSON.stringify(corpo) });

  // ---------- API ----------
  let r = await post('/api/v1/etiquetas', { id: 'ruim', nome: 'Ruim', cor: 'verde' });
  ok('cor fora do Trello é recusada', r.status === 400 && /Cor inválida/.test(r.json?.erro ?? JSON.stringify(r.json)), String(r.status));
  r = await post('/api/v1/etiquetas', { id: 'ruim', nome: 'Ruim', mover_de: 'receita' });
  ok('mover_de que não é lista é recusado', r.status === 400, String(r.status));
  r = await post('/api/v1/etiquetas', { id: 'etq-avaliacao', nome: 'EM AVALIAÇÃO', cor: 'green_light', ordem: 1, topico_destino: 'docs', mover_de: ['receita'] });
  ok('cria etiqueta com destino e mover_de', r.status === 201 || r.status === 200, String(r.status) + ' ' + JSON.stringify(r.json).slice(0, 200));
  await post('/api/v1/etiquetas', { id: 'etq-concluido', nome: 'CONCLUÍDO', cor: 'lime', ordem: 2, topico_destino: 'exames' });
  await post('/api/v1/etiquetas', { id: 'etq-urgente', nome: 'URGENTE', cor: 'red_dark', ordem: 3 });
  await post('/api/v1/etiquetas', { id: 'etq-velha', nome: 'VELHA', cor: 'black', ordem: 4, mostrar: false });
  ok('as quatro etiquetas estão no banco', sql(`select string_agg(id || ':' || coalesce(topico_destino, '-') || ':' || array_to_string(mover_de, ',') || ':' || mostrar, ' ' order by ordem) from crm_etiquetas`)
    === 'etq-avaliacao:docs:receita:true etq-concluido:exames::true etq-urgente:-::true etq-velha:-::false');
  r = await api('/api/v1/etiquetas');
  ok('GET /etiquetas lista', r.status === 200 && JSON.stringify(r.json).includes('etq-concluido'), String(r.status));

  const cart = sql(`insert into atendimentos (topico_id, resumo, aberto_por) values ('receita', 'ETQ-1 cartão das etiquetas', 'IA') returning id`);
  r = await patch(`/api/v1/atendimentos/${cart}`, { etiquetas: ['etq-urgente', 'etq-urgente'] });
  ok('PATCH etiquetas no atendimento grava a lista sem repetir', r.status === 200 && sql(`select array_to_string(etiquetas, ',') || '|' || topico_id from atendimentos where id = '${cart}'`) === 'etq-urgente|receita',
    String(r.status));
  r = await patch(`/api/v1/atendimentos/${cart}`, { etiquetas: 'etq-urgente' });
  ok('etiquetas que não é lista é recusado', r.status === 400, String(r.status));

  // ---------- Tela ----------
  const b = await lancar(); const erros = [];
  let ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); let p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await entrar(p, 'amanda@teste.local');
  await p.goto(B + '/crm'); const card = p.locator('article', { hasText: 'ETQ-1' }); await card.waitFor({ timeout: 10000 });
  ok('cartão mostra a etiqueta com a cor do Trello', (await card.locator('[data-etiqueta="etq-urgente"]').count()) === 1
    && (await card.locator('[data-etiqueta="etq-urgente"]').getAttribute('style') || '').includes('rgb(201, 55, 44)'));
  ok('com etiquetas, o cartão não tem Finalizar nem Passar, e tem o botão Etiqueta', (await card.getByRole('button', { name: 'Finalizar' }).count()) === 0
    && (await card.locator('[data-passar]').count()) === 0 && (await card.locator('[data-botao-etiqueta]').count()) === 1);
  ok('quadro de outras cartões também troca (sem Finalizar no quadro)', (await p.locator('main article').getByRole('button', { name: 'Finalizar' }).count()) === 0);
  await card.locator('[data-botao-etiqueta]').click();
  ok('o botão abre as etiquetas visíveis (a escondida não aparece)', (await card.locator('[data-escolher-etiqueta]').count()) === 3
    && (await card.locator('[data-escolher-etiqueta="etq-velha"]').count()) === 0);
  await p.screenshot({ path: out + '32_etiquetas_escolher.png' });
  await card.locator('[data-escolher-etiqueta="etq-avaliacao"]').click(); await p.waitForTimeout(1500);
  ok('pôr EM AVALIAÇÃO num cartão de "receita" leva para "docs"', sql(`select topico_id || '|' || array_to_string(etiquetas, ',') from atendimentos where id = '${cart}'`) === 'docs|etq-urgente,etq-avaliacao');
  ok('na tela o cartão foi para a coluna de destino', (await p.locator('section[aria-label="Notas fiscais e documentos"] article', { hasText: 'ETQ-1' }).count()) === 1);
  ok('aviso diz o que aconteceu', /etiqueta posta · foi para Notas fiscais e documentos/.test(await p.locator('main [role=status]').textContent().catch(() => '') || ''));
  const card2 = p.locator('article', { hasText: 'ETQ-1' });
  await card2.locator('[data-botao-etiqueta]').click(); await card2.locator('[data-escolher-etiqueta="etq-avaliacao"]').click(); await p.waitForTimeout(1500);
  ok('tirar a etiqueta não move', sql(`select topico_id || '|' || array_to_string(etiquetas, ',') from atendimentos where id = '${cart}'`) === 'docs|etq-urgente');
  await card2.locator('[data-botao-etiqueta]').click(); await card2.locator('[data-escolher-etiqueta="etq-avaliacao"]').click(); await p.waitForTimeout(1500);
  ok('fora de "mover_de", a etiqueta só marca (não move)', sql(`select topico_id || '|' || array_to_string(etiquetas, ',') from atendimentos where id = '${cart}'`) === 'docs|etq-urgente,etq-avaliacao');

  // Detalhe: sem etapa, com a coluna e as etiquetas sempre à vista.
  await card2.getByRole('button', { name: 'Contato sem nome' }).click(); await p.locator('[data-etiquetas-detalhe]').waitFor({ timeout: 5000 });
  ok('detalhe sem a etapa e com "Coluna"', (await p.locator('#det-etapa').count()) === 0 && (await p.locator('label', { hasText: 'Coluna' }).count()) >= 1
    && (await p.locator('#det-passar').count()) === 0);
  await p.locator('[data-etiquetas-detalhe] [data-escolher-etiqueta="etq-concluido"]').click(); await p.waitForTimeout(1800);
  ok('CONCLUÍDO pelo detalhe leva para "exames"', sql(`select topico_id from atendimentos where id = '${cart}'`) === 'exames');
  ok('o detalhe marca as etiquetas que o cartão tem', (await p.locator('[data-etiquetas-detalhe] [data-escolher-etiqueta="etq-concluido"][aria-pressed="true"]').count()) === 1);
  await p.waitForTimeout(800);
  const hist = (await p.locator('aside[role=dialog]').textContent()) || '';
  ok('histórico conta a etiqueta e para onde foi', hist.includes('Pôs a etiqueta CONCLUÍDO · foi para Exames') && hist.includes('Tirou a etiqueta EM AVALIAÇÃO'), hist.slice(0, 300));
  await p.screenshot({ path: out + '32_etiquetas_detalhe.png' });
  await ctx.close();

  // Membro só com "Ver o CRM": vê as etiquetas, sem o botão.
  sql(`insert into painel_usuarios (email, nome) values ('semacesso@teste.local', 'Leitor Teste') on conflict do nothing;
       insert into painel_vinculos (usuario_id, empresa_id, nivel, permissoes) select id, 'teste', 'membro', array['crm.ver'] from painel_usuarios where email='semacesso@teste.local' on conflict do nothing;`);
  ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); p = await ctx.newPage();
  await entrar(p, 'semacesso@teste.local'); await p.goto(B + '/crm');
  const card3 = p.locator('article', { hasText: 'ETQ-1' }); await card3.waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('quem só vê o CRM vê as etiquetas e não tem o botão', (await card3.locator('[data-etiqueta="etq-concluido"]').count()) === 1 && (await card3.locator('[data-botao-etiqueta]').count()) === 0);
  await ctx.close();
  sql(`delete from painel_vinculos where usuario_id in (select id from painel_usuarios where email='semacesso@teste.local');
       delete from painel_usuarios where email='semacesso@teste.local';`);

  // Sem etiquetas (todas arquivadas): a empresa volta ao quadro de sempre.
  sql(`update crm_etiquetas set arquivado = true`);
  ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); p = await ctx.newPage();
  await entrar(p, 'amanda@teste.local'); await p.goto(B + '/crm');
  const card4 = p.locator('article', { hasText: 'ETQ-1' }); await card4.waitFor({ timeout: 10000 });
  ok('sem etiquetas na empresa: volta o Finalizar e somem os chips', (await card4.getByRole('button', { name: 'Finalizar' }).count()) === 1
    && (await card4.locator('[data-etiqueta]').count()) === 0 && (await card4.locator('[data-botao-etiqueta]').count()) === 0);
  await ctx.close(); await b.close();

  // Limpeza: o cartão sai do quadro e as etiquetas do banco (os outros testes não as conhecem).
  sql(`update atendimentos set arquivado = true where id = '${cart}'; delete from crm_etiquetas; update api_chaves set ativa = false where nome = 'Etiquetas teste'`);
  ok('sem erro no console', erros.length === 0, erros.slice(0, 3).join(' | '));
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
