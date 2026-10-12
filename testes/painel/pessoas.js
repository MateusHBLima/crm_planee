// Várias pessoas no mesmo número (migração 024, 12/10): POST /api/v1/pessoas/lote (carga do "Quem é quem"), recurso
// contato_telefones, ficha com todas as pessoas do número, separação do dependente que o espelho juntou no dono do
// número (com os agendamentos e comprovantes dele), regras do CPF, Registro e o bloco "Também neste número" na tela.
// Dados fictícios (números 55 47 90000-5xxx e CPFs gerados aqui).
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
// CPF fictício com dígitos verificadores certos.
function cpf(base) {
  const d = String(base).padStart(9, '0').split('').map(Number);
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); d.push(((s * 10) % 11) % 10); }
  return d.join('');
}
const A = '5547900005001', BB = '5547900005002', C = '5547900005003';
const CPF_MAE = cpf(100200300), CPF_FILHO = cpf(100200301), CPF_OUTRO = cpf(100200302), CPF_X = cpf(100200303), CPF_Y = cpf(100200304);

(async () => {
  const chave = 'teste-pessoas-' + crypto.randomBytes(8).toString('hex');
  const chaveLeitura = 'teste-pessoas-l-' + crypto.randomBytes(8).toString('hex');
  const h = (k) => crypto.createHash('sha256').update(k).digest('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Quem é quem', '${h(chave)}', array['leitura','crm']), ('Só leitura', '${h(chaveLeitura)}', array['leitura'])`);
  const api = (caminho, corpo, k = chave, metodo) => fetch(B + caminho, {
    method: metodo ?? (corpo === undefined ? 'GET' : 'POST'), body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { authorization: 'Bearer ' + k, 'content-type': 'application/json' },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), texto: '' }));
  const lote = (itens, origem = 'quem_e_quem') => api('/api/v1/pessoas/lote', { origem, itens });

  // ---- Como o espelho deixou: filho (P2) e mãe (P1) no mesmo contato, o dono do número A ----
  const MAE = sql(`insert into contatos (nome, telefone) values ('Mae WhatsApp Ficticia', '${A}') returning id`);
  sql(`insert into agenda_pacientes (sistema, paciente_id, contato_id, nome, telefone) values
         ('feegow', 'PF1', '${MAE}', 'Maria Ficticia', '${A}'), ('feegow', 'PF2', '${MAE}', 'Pedro Ficticio', '${A}')`);
  const serv = (cod, pac) => sql(`insert into servicos (contato_id, tipo, inicio, situacao, sistema, codigo_externo, detalhes, criado_por)
      values ('${MAE}', 'Consulta', now() + interval '3 days', 'agendado', 'feegow', '${cod}', '{"feegow":{"paciente_id":"${pac}"}}', 'Feegow (espelho)') returning id`);
  const S1 = serv('AGP1', 'PF2'); serv('AGP2', 'PF2'); serv('AGP3', 'PF1');
  sql(`insert into pagamentos (contato_id, servico_id, valor, criado_por) values ('${MAE}', '${S1}', 150, 'IA')`);
  sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${MAE}', 'receita', 'PESSOAS-MAE receita do filho', 'IA')`);

  // ---- Carga: dependente vem antes no lote, mas o "proprio" é processado primeiro ----
  let r = await lote([
    { telefone: A, papel: 'dependente', paciente: { sistema: 'feegow', codigo: 'PF2' }, nome: 'Pedro Ficticio', cpf: CPF_FILHO },
    { telefone: '(47) 90000-5001', papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF1' }, nome: 'Maria Ficticia', cpf: CPF_MAE },
  ]);
  const [dep, tit] = r.json?.itens ?? [];
  ok('lote responde por item, na ordem enviada', r.status === 200 && r.json.total === 2 && r.json.ok === 2 && dep?.indice === 0 && tit?.indice === 1, JSON.stringify(r.json).slice(0, 300));
  ok('proprio: é o dono do número, com nome e CPF da Feegow', tit?.contato_id === MAE && tit.criado === false
    && sql(`select nome || '|' || documento || '|' || tipo_documento from contatos where id = '${MAE}'`) === `Maria Ficticia|${CPF_MAE}|cpf`);
  const FILHO = dep?.contato_id;
  ok('dependente junto no dono do número: ganha contato próprio, sem telefone', dep?.criado === true && dep.separado === true && FILHO && FILHO !== MAE
    && sql(`select coalesce(telefone, '-') || '|' || nome || '|' || documento from contatos where id = '${FILHO}'`) === `-|Pedro Ficticio|${CPF_FILHO}`);
  ok('agendamentos do filho vão com ele; os da mãe ficam', dep?.servicos_movidos === 2
    && sql(`select count(*) from servicos where contato_id = '${FILHO}'`) === '2' && sql(`select count(*) from servicos where contato_id = '${MAE}'`) === '1');
  ok('comprovante do agendamento do filho vai junto', sql(`select contato_id from pagamentos where servico_id = '${S1}'`) === FILHO);
  ok('paciente da Feegow aponta para o contato certo (espelho segue)', sql(`select contato_id from agenda_pacientes where paciente_id = 'PF2'`) === FILHO
    && sql(`select contato_id from agenda_pacientes where paciente_id = 'PF1'`) === MAE);
  ok('vínculos gravados com papel e origem', sql(`select string_agg(papel || ':' || origem, ',' order by papel) from contato_telefones where right(telefone, 8) = right('${A}', 8)`) === 'dependente:quem_e_quem,proprio:quem_e_quem');
  ok('resposta nunca traz o CPF', !JSON.stringify(r.json).includes(CPF_MAE) && !JSON.stringify(r.json).includes(CPF_FILHO));

  // ---- Idempotente ----
  r = await lote([
    { telefone: A, papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF1' }, nome: 'Maria Ficticia', cpf: CPF_MAE },
    { telefone: A, papel: 'dependente', paciente: { sistema: 'feegow', codigo: 'PF2' }, nome: 'Pedro Ficticio', cpf: CPF_FILHO },
  ]);
  ok('mandar de novo não duplica nada', r.json?.ok === 2 && r.json.itens[1].contato_id === FILHO && r.json.itens[1].criado === false && !r.json.itens[1].servicos_movidos
    && sql(`select count(*) from contato_telefones where right(telefone, 8) = right('${A}', 8)`) === '2'
    && sql(`select count(*) from contatos where nome = 'Pedro Ficticio'`) === '1', JSON.stringify(r.json.itens));

  // ---- Ficha por telefone: todas as pessoas do número ----
  r = await api('/api/v1/ficha?telefone=' + A);
  const cs = r.json?.contatos ?? [];
  ok('ficha: dono primeiro, depois o dependente, com papel e cpf_final', cs.length === 2 && cs[0].id === MAE && cs[0].dono_do_numero === true && cs[0].papel === 'proprio'
    && cs[1].id === FILHO && cs[1].dono_do_numero === false && cs[1].papel === 'dependente' && cs[1].cpf_final === CPF_FILHO.slice(-3), JSON.stringify(cs));
  ok('ficha: agendamentos das duas pessoas, cada um com o contato_id', (r.json?.servicos ?? []).length === 3 && r.json.servicos.filter((s) => s.contato_id === FILHO).length === 2);
  ok('ficha: CPF inteiro não sai', !JSON.stringify(r.json).includes(CPF_MAE) && !JSON.stringify(r.json).includes(CPF_FILHO));
  r = await api('/api/v1/funil', { telefone: A, etapa_id: 'interesse' });
  ok('funil continua no dono do número', r.status === 200 && sql(`select count(*) from oportunidades where contato_id = '${MAE}' and not arquivado`) === '1'
    && sql(`select count(*) from oportunidades where contato_id = '${FILHO}'`) === '0', JSON.stringify(r.json).slice(0, 200));

  // ---- CPF ----
  r = await lote([
    { telefone: A, papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF1' }, nome: 'Maria Ficticia', cpf: CPF_OUTRO },
    { telefone: A, papel: 'familiar', paciente: { sistema: 'feegow', codigo: 'PF3' }, nome: 'Tia Ficticia', cpf: CPF_MAE },
    { telefone: BB, papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF9' }, nome: 'Nove Ficticio', cpf: '12345678900' },
  ]);
  const [diff, outroC, inval] = r.json?.itens ?? [];
  ok('CPF diferente no titular: não troca', diff?.ok && diff.aviso === 'cpf_diferente'
    && sql(`select nome || '|' || documento from contatos where id = '${MAE}'`) === `Maria Ficticia|${CPF_MAE}`, JSON.stringify(diff));
  ok('CPF que já é de outro contato não é gravado', outroC?.ok && outroC.aviso === 'cpf_em_outro_contato' && outroC.contato_cpf === MAE
    && sql(`select coalesce(documento, '-') from contatos where id = '${outroC.contato_id}'`) === '-', JSON.stringify(outroC));
  ok('CPF inválido não é gravado, o vínculo sim', inval?.ok && inval.aviso === 'cpf_invalido'
    && sql(`select coalesce(documento, '-') || '|' || telefone from contatos where id = '${inval.contato_id}'`) === `-|${BB}`);
  const TIA = outroC?.contato_id;

  // ---- Erros por item não derrubam o lote ----
  r = await lote([
    { telefone: C, papel: 'conferir', paciente: { sistema: 'feegow', codigo: 'PF20' } },
    { telefone: 'abc', papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF21' } },
    { telefone: C, papel: 'familiar', nome: 'Sem Paciente' },
    { telefone: C, papel: 'dependente', paciente: { sistema: 'feegow', codigo: 'PF22' }, nome: 'Gemeo Um', cpf: CPF_X },
    { telefone: C, papel: 'dependente', paciente: { sistema: 'feegow', codigo: 'PF23' }, nome: 'Gemeo Dois', cpf: CPF_X },
    { telefone: C, papel: 'dependente', paciente: { sistema: 'feegow', codigo: 'PF24' }, nome: 'Gemea Tres', cpf: CPF_Y },
  ]);
  ok('erros por item: papel, telefone, paciente e CPF repetido no lote', r.status === 200 && r.json.erros === 5 && r.json.ok === 1
    && r.json.itens.map((x) => x.erro ?? 'ok').join(',') === 'papel_invalido,telefone_invalido,sem_paciente,cpf_conflito_no_lote,cpf_conflito_no_lote,ok', JSON.stringify(r.json.itens));
  ok('dependente sem dono do número: contato próprio, só o vínculo', sql(`select count(*) from contatos where nome = 'Gemea Tres' and telefone is null`) === '1'
    && sql(`select count(*) from contatos where right(telefone, 8) = right('${C}', 8)`) === '0');

  // ---- proprio sem dono: o contato do paciente sem telefone recebe o número ----
  const SEMTEL = sql(`insert into contatos (nome) values ('Joao Sem Telefone') returning id`);
  sql(`insert into agenda_pacientes (sistema, paciente_id, contato_id, nome) values ('feegow', 'PF30', '${SEMTEL}', 'Joao Sem Telefone')`);
  r = await lote([{ telefone: '5547900005004', papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF30' }, nome: 'Joao Ficticio' }]);
  ok('proprio sem dono do número: o contato do paciente fica com o número', r.json?.itens?.[0]?.contato_id === SEMTEL && r.json.itens[0].criado === false
    && sql(`select telefone || '|' || nome from contatos where id = '${SEMTEL}'`) === '5547900005004|Joao Ficticio');

  // ---- mesmo_numero com o mesmo nome do dono continua sendo o dono ----
  const ANA = sql(`insert into contatos (nome, telefone) values ('Ana Fictícia', '5547900005005') returning id`);
  sql(`insert into agenda_pacientes (sistema, paciente_id, contato_id, nome) values ('feegow', 'PF40', '${ANA}', 'Ana Ficticia')`);
  r = await lote([
    { telefone: '5547900005005', papel: 'mesmo_numero', paciente: { sistema: 'feegow', codigo: 'PF40' }, nome: 'ANA FICTICIA' },
    { telefone: '5547900005005', papel: 'mesmo_numero', paciente: { sistema: 'feegow', codigo: 'PF41' }, nome: 'Bia Ficticia' },
  ]);
  ok('mesmo_numero: o dono com o mesmo nome continua; o outro ganha contato', r.json?.itens?.[0]?.contato_id === ANA && !r.json.itens[0].separado
    && r.json.itens[1].contato_id !== ANA && r.json.itens[1].criado === true, JSON.stringify(r.json?.itens));

  // ---- Um dono por número: segundo "proprio" vira mesmo_numero, sem trocar o dono ----
  sql(`insert into agenda_pacientes (sistema, paciente_id, contato_id, nome) values ('feegow', 'PF50', '${MAE}', 'Intrusa Ficticia')`);
  r = await lote([{ telefone: '554700005001', papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF50' }, nome: 'Intrusa Ficticia' }]);
  const intr = r.json?.itens?.[0];
  ok('segundo proprio no número (sem o 9): entra como mesmo_numero e não troca o dono', intr?.ok && intr.aviso === 'ja_tem_proprio' && intr.papel_gravado === 'mesmo_numero'
    && intr.contato_id !== MAE && intr.separado === true && sql(`select nome from contatos where id = '${MAE}'`) === 'Maria Ficticia'
    && sql(`select count(*) from contatos where right(telefone, 8) = right('${A}', 8)`) === '1', JSON.stringify(intr));
  r = await lote([{ telefone: '554700005001', papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF1' }, nome: 'Maria Ficticia' }]);
  ok('telefone sem o 9 acha o mesmo dono', r.json?.itens?.[0]?.contato_id === MAE && !r.json.itens[0].aviso, JSON.stringify(r.json?.itens));

  // ---- Remover ----
  r = await lote([{ telefone: A, papel: 'familiar', paciente: { sistema: 'feegow', codigo: 'PF3' }, remover: true }]);
  const f2 = await api('/api/v1/ficha?telefone=' + A);
  ok('remover arquiva o vínculo e a pessoa sai da ficha', r.json?.itens?.[0]?.removido === true && !(f2.json?.contatos ?? []).some((x) => x.id === TIA)
    && sql(`select count(*) from contatos where id = '${TIA}' and not arquivado`) === '1');

  // ---- Limites e escopo ----
  r = await api('/api/v1/pessoas/lote', { itens: Array.from({ length: 501 }, () => ({})) });
  ok('mais de 500 itens: recusa', r.status === 400);
  r = await api('/api/v1/pessoas/lote', { itens: [{ telefone: A, papel: 'proprio', paciente: { sistema: 'feegow', codigo: 'PF1' } }] }, chaveLeitura);
  ok('chave só de leitura: 403', r.status === 403);

  // ---- Recurso contato_telefones ----
  r = await api('/api/v1/contato_telefones?contato_id=' + FILHO);
  ok('GET contato_telefones', r.status === 200 && r.json.itens.length === 1 && r.json.itens[0].papel === 'dependente');
  r = await api('/api/v1/contato_telefones', { contato_id: FILHO, telefone: '(47) 90000-5999', papel: 'familiar', origem: 'teste' });
  ok('POST contato_telefones normaliza o telefone', r.status === 201 && r.json.telefone === '5547900005999', JSON.stringify(r.json));
  r = await api('/api/v1/contato_telefones', { contato_id: FILHO, telefone: '5547900005998', papel: 'conferir' });
  ok('POST contato_telefones com papel desconhecido: 400', r.status === 400);
  r = await api('/api/v1');
  ok('catálogo descreve o recurso e a rota de carga', JSON.stringify(r.json).includes('contato_telefones') && JSON.stringify(r.json).includes('/api/v1/pessoas/lote'));

  // ---- Auditoria (Registro) sem CPF ----
  const aud = sql(`select count(*) || '|' || bool_or(detalhe::text like '%${CPF_MAE}%' or detalhe::text like '%${CPF_FILHO}%') from painel_auditoria where acao = 'carregar' and recurso = 'contatos'`);
  ok('cada item fica na auditoria, sem o CPF', /^\d+\|false$/.test(aud) && Number(aud.split('|')[0]) >= 10, aud);

  // ---- Tela: "Também neste número" no cartão do dono e no do dependente ----
  const br = await lancar(); const p = await br.newPage();
  await entrar(p, 'gestor@teste.local', '/crm'); await p.waitForTimeout(800);
  await p.locator('article', { hasText: 'PESSOAS-MAE' }).first().click(); await p.waitForTimeout(1500);
  const bloco = await p.locator('[data-pessoas-numero]').textContent().catch(() => '');
  ok('cartão do dono mostra quem mais está no número', bloco.includes('Pedro Ficticio') && bloco.includes('dependente') && !bloco.includes('Tia Ficticia'), bloco);
  sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${FILHO}', 'exames', 'PESSOAS-FILHO exame', 'IA')`);
  await p.goto(B + '/crm'); await p.waitForTimeout(1000);
  await p.locator('article', { hasText: 'PESSOAS-FILHO' }).first().click(); await p.waitForTimeout(1500);
  const bloco2 = await p.locator('[data-pessoas-numero]').textContent().catch(() => '');
  ok('cartão do dependente mostra o número e o dono', bloco2.includes('47 90000-5001') && bloco2.includes('como dependente') && bloco2.includes('Maria Ficticia') && bloco2.includes('dono do número'), bloco2);
  await br.close();
  // Pacientes fictícios deste teste saem da tabela do espelho (o agenda.js conta as linhas dela).
  sql(`delete from agenda_pacientes where paciente_id like 'PF%'`);

  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas}/${res.length} ok`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); console.log(res.join('\n')); process.exit(1); });
