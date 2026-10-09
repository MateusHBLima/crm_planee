// Resultados (fase 1.3, 09/10): números conferidos contra o banco, troca de período, permissão e nenhum dado
// pessoal na resposta. Roda pelo rodar.sh depois do comprovante-whatsapp.js (usa as conversas, cartões, envios e
// pagamentos fictícios dos testes anteriores).
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

(async () => {
  const b = await lancar();
  const erros = [];
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  await entrar(p, 'gestor@teste.local', '/resultados');
  await p.locator('[data-kpi="contatos"]').waitFor({ timeout: 10000 });

  const d = await p.evaluate(async () => (await (await fetch('/api/painel/ler/resultados?periodo=30')).json()).dados);
  const ini = "date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' - interval '29 days'";
  ok('pessoas que escreveram batem com o banco', d.conversas.contatos === Number(sql(`select count(distinct wa_id) from wa_mensagens where direcao = 'entrada' and tipo <> 'reaction' and enviada_em >= ${ini}`)), String(d.conversas.contatos));
  ok('respostas da Sara e da equipe batem', d.conversas.respostasSara === Number(sql(`select count(*) from wa_mensagens where direcao = 'saida' and origem = 'api' and tipo <> 'reaction' and enviada_em >= ${ini}`))
    && d.conversas.respostasEquipe === Number(sql(`select count(*) from wa_mensagens where direcao = 'saida' and origem in ('celular','painel') and tipo <> 'reaction' and enviada_em >= ${ini}`)));
  ok('pedidos abertos no quadro batem (sem sombra)', d.quadro.abertos === Number(sql(`select count(*) from atendimentos where not arquivado and resumo !~ '^\\s*\\[SOMBRA\\]' and aberto_em >= ${ini}`)), String(d.quadro.abertos));
  ok('quadro por assunto traz todos os assuntos', d.quadro.agora.length === Number(sql(`select count(*) from crm_topicos where not arquivado`)));
  ok('agendamentos e comprovantes do período', d.agenda !== null && d.comprovantes.total === Number(sql(`select count(*) from pagamentos where not arquivado and criado_em >= ${ini}`)), JSON.stringify(d.comprovantes));
  ok('mensagens automáticas por tipo', Array.isArray(d.automaticas) && d.automaticas.reduce((s, a) => s + a.enviado + a.falhou + a.cancelado, 0) === Number(sql(`select count(*) from envios_automaticos where quando >= ${ini}`)));
  ok('espera pela equipe com faixas', d.espera && d.espera.faixas.length === 4 && d.espera.faixas.reduce((s, f) => s + f.qtde, 0) === d.espera.respostas);
  const txt = JSON.stringify(d);
  ok('nenhum telefone nem texto de paciente na resposta', !/\d{10,}/.test(txt.replace(/"\d{4}-\d{2}-\d{2}T[^"]*"/g, '')) && !txt.includes('Beatriz'), txt.match(/\d{10,}/)?.[0] ?? '');
  ok('tela mostra os números', ((await p.textContent('[data-kpi="contatos"]')) || '').trim() === d.conversas.contatos.toLocaleString('pt-BR'));

  await p.click('button:has-text("7 dias")'); await p.waitForTimeout(1500);
  const d7 = await p.evaluate(async () => (await (await fetch('/api/painel/ler/resultados?periodo=7')).json()).dados);
  ok('troca de período (7 dias)', d7.periodo === '7' && new Date(d7.de) > new Date(d.de));

  // Sem a permissão resultados.ver: a leitura recusa
  const amanda = await (await b.newContext()).newPage();
  await entrar(amanda, 'amanda@teste.local', '/crm');
  const r = await amanda.evaluate(async () => { const x = await fetch('/api/painel/ler/resultados'); return { s: x.status, j: await x.json() }; });
  ok('sem permissão, a leitura recusa', r.s === 403 && r.j.ok === false, JSON.stringify(r));

  ok('sem erro de página', erros.length === 0, erros.join(' | '));
  await b.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
