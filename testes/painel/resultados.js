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

  // Agendamentos da IA marcados na Feegow (03/11): o espelho grava agendado_por; crm_config "agenda_ia" diz quem é a IA,
  // quais pacientes são de teste e como começa a descrição de uma troca de modalidade.
  const cont = sql(`select id from contatos limit 1`);
  const fg = (por, pac, dias) => JSON.stringify({ feegow: { agendado_por: por, paciente_id: pac, marcado_em: sql(`select to_char((now() - interval '${dias} days') at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')`) } });
  const novo = (por, pac, situacao, tipo, descricao, dias = 1) => sql(`insert into servicos (contato_id, tipo, descricao, inicio, situacao, sistema, codigo_externo, detalhes, criado_por)
    values ('${cont}', '${tipo}', ${descricao ? `'${descricao}'` : 'null'}, now() + interval '5 days', '${situacao}', 'feegow', 'IA-${Math.random().toString(36).slice(2, 9)}', '${fg(por, pac, dias)}', 'Feegow (espelho)')`);
  const antes = d.agenda;
  novo('Agendamento Online', 501, 'confirmado', 'Consulta Fictícia', 'Agendado pela Sara (IA)');
  novo('Agendamento Online', 502, 'cancelado', 'Consulta Fictícia', 'Troca de modalidade pela Sara (IA), antes teleconsulta');
  novo('Agendamento Online', 503, 'realizado', 'Bio Fictícia', 'Bio junto da consulta. Agendado pela Sara (IA)');
  novo('Agendamento Online', 506, 'confirmado', 'Consulta Fictícia', null); // o paciente marcou sozinho pela página da Feegow
  novo('Agendamento Online', 999, 'cancelado', 'Consulta Fictícia', 'TESTE');
  novo('Secretária Fictícia', 504, 'confirmado', 'Consulta Fictícia', null);
  novo('Agendamento Online', 505, 'confirmado', 'Consulta Fictícia', 'fora do período', 60);
  const ler = async () => (await p.evaluate(async () => (await (await fetch('/api/painel/ler/resultados?periodo=30')).json()).dados)).agenda;
  let a = await ler();
  ok('sem crm_config agenda_ia: o marcado na Feegow pelo usuário da IA não conta como IA (como antes)', a.pelaIa === antes.pelaIa && a.total === antes.total + 6 && a.testes === 0, JSON.stringify({ antes: antes.pelaIa, a: a.pelaIa, t: a.total }));
  sql(`insert into crm_config (chave, valor) values ('agenda_ia', '{"feegow_agendado_por":["Agendamento Online"],"descricao_contem":["pela Sara (IA)"],"pacientes_teste":["999"],"trocas_comecam_com":["Troca de modalidade"]}')
       on conflict (chave) do update set valor = excluded.valor`);
  a = await ler();
  ok('com agenda_ia: conta os 3 da IA no período, sem o de teste, sem o de fora do período e sem o que o paciente marcou sozinho', a.pelaIa === antes.pelaIa + 3 && a.total === antes.total + 5 && a.testes === 1, JSON.stringify({ ia: a.pelaIa, t: a.total, testes: a.testes }));
  ok('separa novos e trocas de modalidade', a.ia.trocas === 1 && a.ia.novos === a.pelaIa - 1, JSON.stringify(a.ia));
  ok('da IA por situação e por tipo (o tipo sem as trocas)', a.ia.porSituacao.find((x) => x.situacao === 'realizado')?.qtde >= 1
    && a.ia.porTipo.find((x) => x.tipo === 'Consulta Fictícia')?.qtde === 1 && a.ia.porTipo.find((x) => x.tipo === 'Bio Fictícia')?.qtde === 1, JSON.stringify(a.ia));
  await p.reload(); await p.locator('[data-kpi="agenda"]').waitFor({ timeout: 10000 }); await p.waitForTimeout(800);
  ok('tela mostra a conta da IA com novos e trocas', ((await p.textContent('[data-kpi-nota="agenda"]')) || '').includes(`${a.pelaIa} pela Sara (${a.ia.novos} novos, 1 troca)`)
    && (await p.locator('[data-agenda-ia]').count()) === 1, (await p.textContent('[data-kpi-nota="agenda"]')) || '');
  sql(`delete from servicos where codigo_externo like 'IA-%'; delete from crm_config where chave = 'agenda_ia'`);

  await p.click('#periodo-resultados'); await p.click('[data-atalho="7d"]'); await p.waitForTimeout(1500);
  const d7 = await p.evaluate(async () => (await (await fetch('/api/painel/ler/resultados?periodo=7')).json()).dados);
  ok('troca de período (7 dias)', d7.periodo === '7' && new Date(d7.de) > new Date(d.de) && ((await p.textContent('#periodo-resultados')) || '').includes('Últimos 7 dias'));

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
