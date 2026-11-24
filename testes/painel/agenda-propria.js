// Agenda própria (migração 035, 23/11) pela API, como a IA da demo usa. Roda pelo rodar.sh, na empresa de teste.
// Confere: cadastro pelos recursos agenda_*; horários livres pela grade (fuso da empresa); marcar (com contato e serviço
// espelhado), idempotência, vaga ocupada, fora da grade, bloqueio, remarcar, cancelar, busca por telefone; empresa sem
// a agenda ligada responde 404; a outra empresa não recebe nada. Tudo fictício.
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));

// Próxima segunda-feira (pelo menos 2 dias à frente), no fuso de São Paulo, como AAAA-MM-DD.
function proximaSegunda() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  for (let i = 2; i < 10; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const partes = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
    if (partes.weekday === 'Mon') return `${partes.year}-${partes.month}-${partes.day}`;
  }
}
const SP = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`).toISOString();

(async () => {
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['agenda.ver','agenda.editar','agenda.config'])) where id = 'teste'`);
  const chave = 'teste-agenda-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('IA demo agenda', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm','config'])`);
  const api = async (caminho, corpo, metodo = corpo ? 'POST' : 'GET') => {
    const r = await fetch(B + '/api/v1/' + caminho, { method: metodo, headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    return { s: r.status, j: await r.json().catch(() => null) };
  };

  // ---- Cadastro (recursos genéricos) ----
  const prof = await api('agenda_profissionais', { nome: 'Dra. Helena Duarte (fictícia)', descricao: 'Clínica geral' });
  const P = prof.j?.id;
  const presencial = await api('agenda_tipos', { nome: 'Consulta presencial', duracao_min: 60, valor: 400, modalidade: 'presencial' });
  const online = await api('agenda_tipos', { nome: 'Consulta online', duracao_min: 60, valor: 400, modalidade: 'online' });
  const T = presencial.j?.id;
  let gradeOk = true;
  for (const dia of [1, 2, 3, 4, 5]) for (const [ini, fim] of [['09:00', '12:00'], ['14:00', '18:00']]) {
    const g = await api('agenda_grade', { profissional_id: P, dia_semana: dia, inicio: ini, fim });
    gradeOk = gradeOk && g.s < 300;
  }
  ok('cadastro pelos recursos: profissional, 2 tipos e a grade de segunda a sexta', prof.s < 300 && presencial.s < 300 && online.s < 300 && gradeOk,
    `${prof.s} ${presencial.s} ${online.s}`);
  const resumo = await api('agenda');
  ok('GET /agenda lista profissionais e tipos com valor', resumo.s === 200 && resumo.j?.profissionais?.length === 1 && resumo.j?.tipos?.find((t) => t.id === T)?.valor === 400
    && resumo.j?.fuso === 'America/Sao_Paulo', JSON.stringify(resumo.j).slice(0, 200));

  // ---- Horários livres ----
  const seg = proximaSegunda();
  const h1 = await api(`agenda/horarios?tipo=${T}&de=${seg}&ate=${seg}`);
  const horas = (h) => (h.j?.horarios ?? []).map((x) => new Date(x.inicio).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }));
  ok('horários de segunda: 9, 10, 11, 14, 15, 16 e 17 h (fuso da empresa)', horas(h1).join(',') === '09:00,10:00,11:00,14:00,15:00,16:00,17:00', horas(h1).join(','));
  const ruim = await api(`agenda/horarios?tipo=${T}&de=2026-01-01&ate=2026-12-31`);
  ok('horários: período longo demais é recusado', ruim.s === 400);

  // ---- Marcar ----
  const pedido = { tipo: T, profissional: P, inicio: SP(seg, '10:00'), telefone: '5547999990001', nome: 'Paciente Fictício Demo', origem: 'IA', chave: 'demo-1' };
  const a1 = await api('agenda/agendamentos', pedido);
  const A = a1.j?.id;
  ok('IA marca às 10 h: agendamento com contato, fim pela duração e valor do tipo', a1.s === 200 && a1.j?.repetido === false && a1.j?.status === 'agendado'
    && Date.parse(a1.j?.fim) - Date.parse(a1.j?.inicio) === 3600000 && a1.j?.valor === 400 && Boolean(a1.j?.contato_id), JSON.stringify(a1.j).slice(0, 200));
  ok('o agendamento vira serviço do contato (ficha, Inbox, comprovantes)', sql(`select tipo || '|' || situacao || '|' || profissional from servicos where sistema = 'agenda' and codigo_externo = '${A}'`)
    === 'Consulta presencial|agendado|Dra. Helena Duarte (fictícia)');
  const a2 = await api('agenda/agendamentos', pedido);
  ok('mesma chave devolve o mesmo (repetido)', a2.j?.repetido === true && a2.j?.id === A);
  const a3 = await api('agenda/agendamentos', { ...pedido, chave: 'demo-2', telefone: '5547999990002' });
  ok('mesmo horário: ocupado (409)', a3.s === 409 && a3.j?.detalhe?.codigo === 'ocupado', JSON.stringify(a3.j));
  const a4 = await api('agenda/agendamentos', { ...pedido, chave: 'demo-3', inicio: SP(seg, '12:30') });
  ok('fora da grade (12h30): 409', a4.s === 409 && a4.j?.detalhe?.codigo === 'fora_da_grade', JSON.stringify(a4.j));
  const a5 = await api('agenda/agendamentos', { ...pedido, chave: 'demo-4', profissional: undefined, inicio: SP(seg, '15:00'), telefone: '5547999990003' });
  ok('sem profissional: escolhe quem está livre', a5.s === 200 && a5.j?.profissional_id === P, JSON.stringify(a5.j).slice(0, 160));
  const h2 = await api(`agenda/horarios?tipo=${T}&profissional=${P}&de=${seg}&ate=${seg}`);
  ok('os horários marcados somem da lista', !horas(h2).includes('10:00') && !horas(h2).includes('15:00') && horas(h2).length === 5, horas(h2).join(','));

  // ---- Bloqueio ----
  const blq = await api('agenda_bloqueios', { profissional_id: P, inicio: SP(seg, '16:00'), fim: SP(seg, '18:00'), motivo: 'Congresso (fictício)' });
  const h3 = await api(`agenda/horarios?tipo=${T}&de=${seg}&ate=${seg}`);
  const a6 = await api('agenda/agendamentos', { ...pedido, chave: 'demo-5', inicio: SP(seg, '16:00') });
  ok('bloqueio tira 16 e 17 h e recusa marcar ali', blq.s < 300 && horas(h3).join(',') === '09:00,11:00,14:00' && a6.s === 409 && a6.j?.detalhe?.codigo === 'bloqueado', horas(h3).join(','));

  // ---- Remarcar, status, cancelar ----
  const r1 = await api(`agenda/agendamentos/${A}`, { inicio: SP(seg, '11:00') }, 'PATCH');
  const h4 = await api(`agenda/horarios?tipo=${T}&de=${seg}&ate=${seg}`);
  ok('remarcar para 11 h libera as 10 h', r1.s === 200 && horas(h4).includes('10:00') && !horas(h4).includes('11:00')
    && sql(`select to_char(inicio at time zone 'America/Sao_Paulo', 'HH24:MI') from servicos where codigo_externo = '${A}'`) === '11:00', horas(h4).join(','));
  const r2 = await api(`agenda/agendamentos/${A}`, { status: 'confirmado' }, 'PATCH');
  ok('confirmar muda o status e o serviço', r2.j?.status === 'confirmado' && sql(`select situacao from servicos where codigo_externo = '${A}'`) === 'confirmado');
  const lista = await api(`agenda/agendamentos?de=${seg}&ate=${seg}&telefone=47999990001`);
  ok('lista por telefone traz o agendamento', lista.s === 200 && lista.j?.itens?.length === 1 && lista.j.itens[0].id === A, JSON.stringify(lista.j).slice(0, 160));
  const c1 = await api(`agenda/agendamentos/${A}/cancelar`, { motivo: 'Paciente pediu (teste)' });
  const h5 = await api(`agenda/horarios?tipo=${T}&de=${seg}&ate=${seg}`);
  ok('cancelar libera o horário e o serviço fica cancelado', c1.j?.status === 'cancelado' && horas(h5).includes('11:00')
    && sql(`select situacao from servicos where codigo_externo = '${A}'`) === 'cancelado');
  const c2 = await api(`agenda/agendamentos/${A}`, { inicio: SP(seg, '09:00') }, 'PATCH');
  ok('cancelado não remarca (409)', c2.s === 409);
  ok('tudo vai para a auditoria', Number(sql(`select count(*) from painel_auditoria where recurso = 'agenda_agendamentos'`)) >= 5);

  // ---- Empresa sem a agenda ligada ----
  sql(`update empresas set modulos = array_remove(modulos, 'agenda.ver') where id = 'teste'`);
  await new Promise((r) => setTimeout(r, 1500));
  const off = await api(`agenda/horarios?tipo=${T}&de=${seg}&ate=${seg}`);
  ok('empresa sem a agenda ligada: 404', off.s === 404, String(off.s));
  const offRec = await api('agenda_profissionais');
  const cat = await fetch(B + '/api/v1').then((r) => r.json());
  ok('desligada: recursos agenda_* dão 404 e somem do catálogo', offRec.s === 404 && !cat.recursos.some((r) => r.nome.startsWith('agenda_'))
    && !JSON.stringify(cat.para_a_ia).includes('/agenda'), String(offRec.s));
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['agenda.ver'])) where id = 'teste'`);
  await new Promise((r) => setTimeout(r, 1500));
  const cat2 = await fetch(B + '/api/v1').then((r) => r.json());
  ok('ligada: o catálogo traz os recursos e as rotas da agenda para a IA', cat2.recursos.some((r) => r.nome === 'agenda_tipos') && JSON.stringify(cat2.para_a_ia).includes('/api/v1/agenda/horarios'));
  ok('a outra empresa não recebe nada', sql('select count(*) from ag_agendamentos', process.env.OUTRA_DATABASE_URL) === '0');

  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`${res.length - falhas}/${res.length} ok`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
