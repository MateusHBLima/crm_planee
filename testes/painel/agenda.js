// Espelho da agenda da Feegow e tela Agenda (09/10), contra uma Feegow falsa (FEEGOW_API_URL). Confere: token só
// pela variável da stack, cadastros, próximos dias, carga do histórico até um ano vazio, pacientes ligados a
// contatos (sem duplicar), situação pelo status, agendamento da Sara sem duplicar, rodar de novo sem duplicar e a
// tela do dia. Roda pelo rodar.sh depois do resultados.js. Dados fictícios.
const http = require('http');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

// Datas no fuso do painel
const diaSp = (n) => { const d = new Date(Date.now() + n * 86400_000); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
const fg = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const deFg = (s) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
const HOJE = diaSp(0), AMANHA = diaSp(1), ANTIGO = diaSp(-40);

const AGENDA = [
  { agendamento_id: 9101, data: fg(AMANHA), horario: '10:00:00', paciente_id: 501, procedimento_id: 10, status_id: 1, local_id: 1, profissional_id: 1, agendado_por: 'Recepção', encaixe: false, telemedicina: false, primeiro_agendamento: 1, valor_total_agendamento: 'R$ 300,00' },
  { agendamento_id: 9102, data: fg(HOJE), horario: '14:30:00', paciente_id: 502, procedimento_id: 10, status_id: 7, local_id: 0, profissional_id: 1, telemedicina: true, valor_total_agendamento: 'R$ 250,00' },
  { agendamento_id: 9103, data: fg(ANTIGO), horario: '09:00:00', paciente_id: 501, procedimento_id: 10, status_id: 3, local_id: 1, profissional_id: 2 },
  { agendamento_id: 9104, data: fg(HOJE), horario: '16:00:00', paciente_id: 503, procedimento_id: 10, status_id: 1, local_id: 1, profissional_id: 1 },
];
const PACIENTES = {
  501: { nome: 'Agenda Ficticia Um', celulares: ['00990000091', null], telefones: [null, null] },
  502: { nome: 'Agenda Ficticia Dois', celulares: [null, null], telefones: [null, null] },
  503: { nome: 'Agenda Ficticia Tres', celulares: ['00990000093', null], telefones: [null, null] },
};
const feegow = { chamadas: 0, semToken: 0 };
const servidor = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const responder = (content, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: status === 200, content })); };
  feegow.chamadas++;
  if (req.headers['x-access-token'] !== 'token-feegow-falso') { feegow.semToken++; return responder('Chave da API inativa', 403); }
  const q = u.searchParams; const rota = u.pathname.replace(/^\/+/, '');
  if (rota === 'professional/list') return responder(q.get('ativo') === '1' ? [{ profissional_id: 1, nome: 'Ficticia Neuro', tratamento: 'Dra.' }] : [{ profissional_id: 2, nome: 'Antigo Ficticio', tratamento: 'Dr.' }]);
  if (rota === 'company/list-local') return responder([{ id: 1, local: 'Sala 1' }]);
  if (rota === 'appoints/status') return responder([{ id: 1, status: 'Marcado - não confirmado' }, { id: 3, status: 'Atendido' }, { id: 7, status: 'Marcado - confirmado' }]);
  if (rota === 'procedures/types') return responder([{ id: 2, tipo: 'Consulta' }]);
  if (rota === 'procedures/list') return responder([{ procedimento_id: 10, nome: 'Consulta neurológica' }]);
  if (rota === 'patient/search') { const p = PACIENTES[q.get('paciente_id')]; return p ? responder(p) : responder('Paciente não existe', 409); }
  if (rota === 'appoints/search') {
    const de = deFg(q.get('data_start')), ate = deFg(q.get('data_end'));
    return responder(AGENDA.filter((a) => String(a.profissional_id) === q.get('profissional_id') && deFg(a.data) >= de && deFg(a.data) <= ate));
  }
  return responder('rota inexistente', 403);
});

(async () => {
  await new Promise((r) => servidor.listen(Number(new URL(process.env.FEEGOW_API_URL || 'http://127.0.0.1:3997').port), '127.0.0.1', r));
  sql(`insert into empresa_integracoes (empresa_id, sistema, rotulo, ativo) values ('teste', 'feegow', 'Feegow', true)
       on conflict (empresa_id, sistema) do update set ativo = true`);
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['pagamentos.ver'])) where id = 'teste'`);
  // Sara já registrou o agendamento 9104 pela API (mesmo código): o espelho atualiza o mesmo registro.
  const chave = 'teste-agenda-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Sara agenda', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm'])`);
  const reg = await fetch(B + '/api/v1/servicos/registrar', { method: 'POST', headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' },
    body: JSON.stringify({ telefone: '5500990000093', nome: 'Agenda Ficticia Tres', tipo: 'Consulta', inicio: `${HOJE}T19:00:00Z`, sistema: 'feegow', codigo_externo: '9104' }) });
  ok('Sara registra um agendamento antes do espelho', reg.status < 300, String(reg.status));

  const b = await lancar();
  const erros = [];
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on('pageerror', (e) => erros.push(String(e)));
  await entrar(p, 'planee@teste.local', '/empresas');
  await Promise.all([p.waitForURL(/\/(crm|inbox)$/), p.selectOption('#trocar-empresa', 'teste')]); await p.waitForTimeout(800);
  await p.goto(B + '/agenda'); await p.locator('h1', { hasText: 'Agenda' }).waitFor({ timeout: 10000 });
  ok('tela Agenda abre (módulo de agendamentos)', p.url().endsWith('/agenda'));

  await p.getByRole('button', { name: 'Ler a agenda agora' }).click();
  await p.locator('[role=status]', { hasText: 'agendamentos gravados' }).waitFor({ timeout: 30000 }).catch(() => undefined);
  const st = (await p.textContent('[role=status]').catch(() => '')) || '';
  ok('espelho lê a agenda na hora', /4 agendamentos gravados, 2 contatos novos/.test(st), st);
  ok('token só pela variável da stack (todas as chamadas com o token)', feegow.semToken === 0 && feegow.chamadas > 10, `${feegow.chamadas} chamadas, ${feegow.semToken} sem token`);

  const linhas = sql(`select codigo_externo || '|' || situacao || '|' || tipo || '|' || coalesce(profissional, '') || '|' || coalesce(local, '') || '|' || coalesce(valor::text, '')
                        from servicos where sistema = 'feegow' and codigo_externo in ('9101','9102','9103','9104') order by codigo_externo`).split('\n');
  ok('agendamentos gravados com situação, tipo, profissional e local', linhas.length === 4
    && linhas[0] === '9101|agendado|Consulta neurológica|Dra. Ficticia Neuro|Sala 1|300.00'
    && linhas[1] === '9102|confirmado|Consulta neurológica|Dra. Ficticia Neuro|Online (teleconsulta)|250.00'
    && linhas[2] === '9103|realizado|Consulta neurológica|Dr. Antigo Ficticio|Sala 1|', linhas.join(' ; '));
  ok('horário no fuso da clínica', sql(`select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') from servicos where codigo_externo = '9101'`) === '10:00');
  ok('agendamento da Sara não duplicou e continua dela', sql(`select count(*) || '|' || min(criado_por) from servicos where sistema = 'feegow' and codigo_externo = '9104'`) === '1|IA');
  ok('paciente com telefone vira um contato só (o da Sara foi reaproveitado)', sql(`select count(*) from contatos where right(telefone, 8) = '90000093'`) === '1'
    && sql(`select count(*) from contatos where nome = 'Agenda Ficticia Um' and telefone = '5500990000091'`) === '1');
  ok('paciente sem telefone vira contato só com o nome', sql(`select count(*) from contatos where nome = 'Agenda Ficticia Dois' and telefone is null`) === '1');
  ok('carga do histórico termina num ano vazio', sql(`select carga_completa::int || '|' || (ultimo_erro is null)::int from agenda_espelho where sistema = 'feegow'`) === '1|1');

  // Rodar de novo: nada duplica (contatos, serviços), status novo na Feegow muda a situação.
  AGENDA[0].status_id = 7;
  await p.getByRole('button', { name: 'Ler a agenda agora' }).click(); await p.waitForTimeout(4000);
  ok('rodar de novo não duplica e atualiza a situação', sql(`select count(*) from servicos where sistema = 'feegow' and codigo_externo in ('9101','9102','9103','9104')`) === '4'
    && sql(`select count(*) from agenda_pacientes`) === '3' && sql(`select situacao from servicos where codigo_externo = '9101'`) === 'confirmado');

  // Tela do dia
  await p.goto(B + '/agenda'); await p.locator('[data-agendamento]').first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const hoje = (await p.textContent('main')) || '';
  ok('tela mostra os agendamentos de hoje por profissional', hoje.includes('Dra. Ficticia Neuro') && hoje.includes('Agenda Ficticia Dois') && hoje.includes('Online (teleconsulta)') && hoje.includes('Confirmado'), hoje.slice(0, 200));
  ok('agendamento registrado pela Sara leva a etiqueta Sara', (await p.locator('[data-agendamento]', { hasText: 'Agenda Ficticia Tres' }).locator('[data-origem="sara"]').count()) === 1);
  await p.getByRole('button', { name: 'Próximo dia' }).click(); await p.waitForTimeout(1500);
  ok('próximo dia', ((await p.textContent('main')) || '').includes('Agenda Ficticia Um'));

  // Sem o módulo de agendamentos: a leitura recusa
  sql(`update empresas set modulos = array_remove(modulos, 'pagamentos.ver') where id = 'teste'`);
  const g = await (await b.newContext()).newPage();
  await entrar(g, 'gestor@teste.local', '/crm');
  const r = await g.evaluate(async () => (await fetch('/api/painel/ler/agenda')).status);
  ok('sem o módulo, a agenda não abre', r === 403, String(r));
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['pagamentos.ver'])) where id = 'teste'`);

  ok('sem erro de página', erros.length === 0, erros.join(' | '));
  await b.close(); servidor.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
