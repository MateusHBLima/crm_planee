// Tela da agenda própria (23/11). Roda pelo rodar.sh logo depois do agenda-propria.js, que deixa na empresa de teste a
// Dra. Helena (fictícia), os tipos, a grade de segunda a sexta, um agendamento às 15 h da próxima segunda e um bloqueio
// das 16 h às 18 h. Confere: a semana mostra o agendamento; confirmar pelo detalhe; marcar pelos horários livres; fora
// da grade é recusado; remarcar; cancelar com motivo; Configurar (quem atende, horários, tipos, bloqueio); vista Dia
// com uma coluna por profissional; sem a agenda ligada, a tela volta a ser o espelho da Feegow. Tudo fictício.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
function proximaSegunda() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  for (let i = 2; i < 10; i++) {
    const partes = Object.fromEntries(f.formatToParts(new Date(Date.now() + i * 86400000)).map((p) => [p.type, p.value]));
    if (partes.weekday === 'Mon') return `${partes.year}-${partes.month}-${partes.day}`;
  }
}
const horaSP = (col) => `to_char(${col} at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')`;

(async () => {
  const seg = proximaSegunda();
  const b = await lancar(); const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1360, height: 950 }, timezoneId: 'America/Sao_Paulo' }); const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  p.on('dialog', (d) => d.accept());
  await entrar(p, 'gestor@teste.local', '/agenda');
  await p.locator('[data-agenda-propria]').waitFor({ timeout: 15000 }).catch(() => undefined);
  ok('com a agenda ligada, /agenda abre a agenda própria (semana)', (await p.locator('[data-agenda-propria]').count()) === 1 && (await p.locator('[data-coluna]').count()) === 7);

  // ---- Semana da próxima segunda ----
  for (let i = 0; i < 3 && !(await p.locator(`[data-coluna="${seg}"]`).count()); i++) { await p.click('button[aria-label="Próximo"]'); await p.waitForTimeout(900); }
  const col = p.locator(`[data-coluna="${seg}"]`);
  await col.locator('[data-agendamento]').first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const textoCol = (await col.textContent()) || '';
  ok('a semana mostra o agendamento das 15 h e o bloqueio', textoCol.includes('15:00') && textoCol.includes('Paciente Fictício Demo') && textoCol.includes('Congresso (fictício)'), textoCol.slice(0, 160));
  ok('agendamento cancelado aparece riscado (status cancelado)', (await col.locator('[data-status="cancelado"]').count()) === 1);
  await p.screenshot({ path: __dirname + '/saida/agenda-semana.png' });

  // ---- Confirmar pelo detalhe ----
  const idA5 = sql(`select id from ag_agendamentos where status = 'agendado' and ${horaSP('inicio')} = '${seg} 15:00'`);
  await p.click(`[data-agendamento="${idA5}"]`);
  await p.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await p.locator('[role=status]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('confirmar pelo detalhe grava e espelha no serviço', sql(`select a.status || '|' || s.situacao from ag_agendamentos a join servicos s on s.codigo_externo = a.id::text where a.id = '${idA5}'`) === 'confirmado|confirmado');

  // ---- Marcar pelos horários livres ----
  await p.click('[data-novo-agendamento]');
  await p.fill('[data-campo-dia]', seg);
  await p.locator('[data-horarios-livres] button').first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const chips = await p.locator('[data-horarios-livres] button').allTextContents();
  ok('novo: horários livres da segunda (sem 15 h, sem o bloqueio)', chips.join(',') === '09:00,10:00,11:00,14:00', chips.join(','));
  await p.locator('[data-horarios-livres] button', { hasText: '09:00' }).click();
  await p.fill('[data-campo-telefone]', '(47) 99999-0009');
  await p.fill('[data-campo-nome]', 'Cliente Tela Fictício');
  await p.click('[data-salvar-agendamento]');
  await p.locator('[role=status]').filter({ hasText: 'marcado' }).waitFor({ timeout: 10000 }).catch(() => undefined);
  const idNovo = sql(`select id from ag_agendamentos where origem = 'painel' and ${horaSP('inicio')} = '${seg} 09:00' and status <> 'cancelado'`);
  ok('marcar pela tela: 9 h, origem painel, contato com o telefone', Boolean(idNovo)
    && sql(`select c.telefone from ag_agendamentos a join contatos c on c.id = a.contato_id where a.id = '${idNovo}'`).endsWith('47999990009'), idNovo);

  // ---- Fora da grade é recusado (sem encaixe) ----
  await p.click('[data-novo-agendamento]');
  await p.fill('[data-campo-dia]', seg); await p.fill('[data-campo-hora]', '12:30');
  await p.fill('[data-campo-telefone]', '47999990010');
  await p.click('[data-salvar-agendamento]');
  await p.getByRole('dialog').locator('[role=alert]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('12h30 fora da grade: a tela mostra o erro e não grava', (await p.getByRole('dialog').locator('[role=alert]').count()) === 1
    && sql(`select count(*) from ag_agendamentos where ${horaSP('inicio')} = '${seg} 12:30'`) === '0');
  await p.click('button[aria-label="Fechar"]');

  // ---- Remarcar e cancelar ----
  await p.locator(`[data-agendamento="${idNovo}"]`).waitFor({ timeout: 10000 }).catch(() => undefined);
  await p.click(`[data-agendamento="${idNovo}"]`);
  await p.click('[data-remarcar]');
  await p.getByRole('dialog').locator('input[type=time]').fill('10:00');
  await p.click('[data-confirmar-remarcar]');
  await p.locator('[role=status]').filter({ hasText: 'remarcado' }).waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('remarcar para 10 h', sql(`select ${horaSP('inicio')} from ag_agendamentos where id = '${idNovo}'`) === `${seg} 10:00`);
  await p.click(`[data-agendamento="${idNovo}"]`);
  await p.click('[data-cancelar]');
  await p.getByRole('dialog').locator('input').fill('Desistiu (teste)');
  await p.click('[data-confirmar-cancelar]');
  await p.locator('[role=status]').filter({ hasText: 'cancelado' }).waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('cancelar com motivo', sql(`select status || '|' || cancelado_motivo from ag_agendamentos where id = '${idNovo}'`) === 'cancelado|Desistiu (teste)');

  // ---- Configurar ----
  await p.click('[data-configurar-agenda]');
  await p.click('[data-aba-agenda="profissionais"]');
  await p.fill('[data-campo-prof-nome]', 'Técnico Fictício');
  await p.click('[data-salvar-profissional]');
  await p.locator('[data-item-profissional="Técnico Fictício"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  const idTec = sql(`select id from ag_profissionais where nome = 'Técnico Fictício' and not arquivado`);
  ok('Configurar: adicionar quem atende', Boolean(idTec));
  await p.click('[data-aba-agenda="horarios"]');
  await p.selectOption('[data-grade-profissional]', idTec);
  await p.click('[data-somar-periodo="1"]');
  await p.click('[data-copiar-segunda]');
  await p.click('[data-salvar-grade]');
  await p.locator('[role=status]').filter({ hasText: 'Horários salvos' }).waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('Configurar: horários de segunda copiados para terça a sexta (5 períodos, 9 h às 12 h)',
    sql(`select count(*) || '|' || min(inicio)::text || '|' || max(fim)::text from ag_grade where profissional_id = '${idTec}' and not arquivado`) === '5|09:00:00|12:00:00');
  await p.click('[data-aba-agenda="tipos"]');
  await p.fill('[data-campo-tipo-nome]', 'Visita técnica');
  await p.fill('[data-campo-tipo-duracao]', '90');
  await p.click('[data-salvar-tipo]');
  await p.locator('[data-item-tipo="Visita técnica"]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('Configurar: tipo novo com 90 min', sql(`select duracao_min from ag_tipos where nome = 'Visita técnica' and not arquivado`) === '90');
  await p.click('[data-aba-agenda="bloqueios"]');
  await p.getByRole('dialog').locator('input[placeholder^="Férias"]').fill('Feriado (teste)');
  await p.click('[data-salvar-bloqueio]');
  await p.locator('[role=status]').filter({ hasText: 'Bloqueio criado' }).waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('Configurar: bloqueio para todos', sql(`select count(*) from ag_bloqueios where motivo = 'Feriado (teste)' and profissional_id is null`) === '1');
  ok('Configurar: tudo na auditoria', Number(sql(`select count(*) from painel_auditoria where recurso in ('agenda_profissionais','agenda_grade','agenda_tipos','agenda_bloqueios') and acao in ('criar','salvar_grade')`)) >= 4);
  await p.screenshot({ path: __dirname + '/saida/agenda-config.png' });
  await p.click('button[aria-label="Fechar"]');

  // ---- Vista Dia: uma coluna por profissional ----
  await p.getByRole('button', { name: 'Dia', exact: true }).click();
  await p.waitForTimeout(1200);
  const cab = (await p.locator('[data-agenda-propria] [class*="cabCelula"]').allTextContents()).join('|');
  ok('vista Dia: uma coluna por profissional', cab.includes('Dra. Helena Duarte (fictícia)') && cab.includes('Técnico Fictício'), cab);
  ok('nenhum erro de página', erros.length === 0, erros.join(' / '));

  // ---- Sem a agenda ligada: volta o espelho da Feegow ----
  sql(`update empresas set modulos = array_remove(modulos, 'agenda.ver') where id = 'teste'`);
  await espera(16000); // cache da sessão (15 s)
  await p.goto(B + '/agenda'); await p.waitForTimeout(1500);
  ok('sem agenda.ver na empresa, a agenda própria some', (await p.locator('[data-agenda-propria]').count()) === 0);
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['agenda.ver'])) where id = 'teste'`);
  ok('a outra empresa não recebe nada', sql('select count(*) from ag_profissionais', process.env.OUTRA_DATABASE_URL) === '0');

  await b.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`${res.length - falhas}/${res.length} ok`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
