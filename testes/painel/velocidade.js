// Velocidade (09/10): leituras comprimidas, resumo cortado no quadro (inteiro no detalhe), clique com resposta na
// hora (assumir aparece antes do servidor responder), ação do quadro gravando a auditoria, leitura antecipada da
// conversa sem marcar como lida e troca de tela pela memória da aba. Roda pelo rodar.sh depois do automaticas.js
// (usa a conversa da Beatriz do inbox.js). Dados fictícios.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
}
const NUM = '100000000000001'; const BIA = '5547900001001';

(async () => {
  const LONGO = 'Resumo longo da Velocidade Ficticia. ' + 'Detalhe do pedido que continua por bastante tempo. '.repeat(30);
  const contato = sql(`insert into contatos (nome, telefone) values ('Velocidade Ficticia', '5500990000071') returning id`).split('\n')[0];
  const alvo = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${contato}', 'receita', '${LONGO}', 'IA') returning id`).split('\n')[0];

  const b = await lancar();
  const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  await entrar(p, 'gestor@teste.local', '/crm');
  await p.locator('article', { hasText: 'Velocidade Ficticia' }).first().waitFor({ timeout: 10000 });

  // Leituras comprimidas e resumo cortado no quadro, inteiro no detalhe.
  const q = await p.evaluate(async (id) => {
    const r = await fetch('/api/painel/ler/quadro'); const j = await r.json();
    const d = await (await fetch('/api/painel/ler/detalhe?id=' + id)).json();
    return { enc: r.headers.get('content-encoding'), quadro: j.dados.cartoes.find((k) => k.id === id)?.resumo.length, detalhe: d.dados.cartao.resumo.length };
  }, alvo);
  ok('leitura do quadro vem comprimida (gzip)', q.enc === 'gzip', String(q.enc));
  ok('resumo cortado no quadro e inteiro no detalhe', q.quadro === 600 && q.detalhe === LONGO.length, `${q.quadro} / ${q.detalhe}`);

  // Clique com resposta na hora: o cartão muda antes do servidor responder (servidor atrasado de propósito).
  await p.route((u) => u.pathname === '/crm', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500));
    return route.continue();
  });
  const card = p.locator('article', { hasText: 'Velocidade Ficticia' }).first();
  // Posição do cartão na coluna (entre os cartões da mesma coluna), para conferir que assumir não o tira do lugar.
  const posicao = () => card.evaluate((el) => [...el.parentElement.querySelectorAll(':scope > article')].indexOf(el));
  const antes = await posicao();
  await card.getByRole('button', { name: 'Assumir' }).click();
  await p.waitForTimeout(300);
  ok('assumir aparece na hora (antes da resposta do servidor)', ((await card.textContent()) || '').includes('Gestor Teste')
    && sql(`select etapa from atendimentos where id = '${alvo}'`) === 'aguardando');
  await p.getByText('Você assumiu o atendimento.').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('servidor confirma e grava', sql(`select etapa || '|' || responsavel || '|' || (assumido_em is not null) from atendimentos where id = '${alvo}'`) === 'em_atendimento|Gestor Teste|true');
  ok('auditoria da ação com a pessoa e o que mudou', sql(`select count(*) from painel_auditoria where recurso = 'atendimentos' and alvo_id = '${alvo}'
      and usuario_id is not null and detalhe->>'etapa' = 'em_atendimento' and detalhe->>'responsavel' = 'Gestor Teste'`) === '1');
  ok('assumir não tira o cartão do lugar na coluna', (await posicao()) === antes, `${antes} → ${await posicao()}`);
  await p.unroute((u) => u.pathname === '/crm');

  // Assunto, nota e arquivar pelo caminho novo (um comando só no banco).
  await card.getByRole('button', { name: 'Velocidade Ficticia' }).click(); await p.locator('#det-assunto').waitFor({ timeout: 5000 });
  await p.selectOption('#det-assunto', 'exames');
  for (let i = 0; i < 20 && sql(`select topico_id from atendimentos where id = '${alvo}'`) !== 'exames'; i++) await p.waitForTimeout(250);
  ok('mudar assunto grava e audita', sql(`select topico_id from atendimentos where id = '${alvo}'`) === 'exames'
    && sql(`select count(*) from painel_auditoria where alvo_id = '${alvo}' and detalhe->>'topico_id' = 'exames'`) === '1',
    sql(`select topico_id from atendimentos where id = '${alvo}'`) + ' ' + sql(`select count(*) from painel_auditoria where alvo_id = '${alvo}'`));
  ok('detalhe mostra o resumo inteiro', ((await p.textContent('aside[aria-label^="Atendimento"]')) || '').includes(LONGO.trim().slice(-40)));
  await p.keyboard.press('Escape');

  // Leitura antecipada da conversa não marca como lida; abrir marca.
  sql(`update wa_conversas set nao_lidas = 3, lida_ate = null where numero_id = '${NUM}' and wa_id = '${BIA}'`);
  const prev = await p.evaluate(async ([n, w]) => (await (await fetch(`/api/painel/ler/conversa?numero=${n}&wa=${w}&previa=1`)).json()).ok, [NUM, BIA]);
  ok('leitura antecipada não marca como lida', prev === true && sql(`select nao_lidas from wa_conversas where numero_id = '${NUM}' and wa_id = '${BIA}'`) === '3');
  const aberta = await p.evaluate(async ([n, w]) => (await (await fetch(`/api/painel/ler/conversa?numero=${n}&wa=${w}`)).json()).dados, [NUM, BIA]);
  ok('abrir marca como lida e já devolve zerado', aberta.conversa.nao_lidas === 0 && aberta.mensagens.length > 0
    && sql(`select nao_lidas from wa_conversas where numero_id = '${NUM}' and wa_id = '${BIA}'`) === '0');

  // Troca de tela pelo menu: a Inbox e o CRM aparecem pela memória da aba / leitura antecipada.
  await p.waitForTimeout(1500);
  await p.click('nav a[href="/inbox"]');
  await p.locator('section[aria-label="Conversas"] li').first().waitFor({ timeout: 5000 }).catch(() => undefined);
  ok('Inbox abre pelo menu com a lista', (await p.locator('section[aria-label="Conversas"] li').count()) > 0);
  await p.click('nav a[href="/crm"]');
  await p.waitForTimeout(250);
  ok('voltar ao CRM mostra o quadro na hora (memória da aba)', (await p.locator('article').count()) > 0);

  sql(`update atendimentos set arquivado = true where id = '${alvo}'`);
  ok('sem erro de página', erros.length === 0, erros.join(' | '));
  await b.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
