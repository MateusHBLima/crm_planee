// Agendamentos marcados pela IA (03/11). A Sara marca direto na Feegow pelo usuário da API dela, que o espelho grava
// em detalhes.feegow.agendado_por (na clínica, "Agendamento Online"); antes só contava o que ela registrava pela API
// do painel, e o painel mostrava 0. A configuração diz quem é a IA em cada empresa (nada fixo no código):
//   crm_config "agenda_ia" = { "feegow_agendado_por": ["Agendamento Online"],
//                              "descricao_contem": ["pela Sara (IA)"],        (marca que a IA põe na descrição)
//                              "pacientes_teste": ["2965"],                    (paciente_id da Feegow: fora das contas)
//                              "trocas_comecam_com": ["Troca de modalidade"] } (descrição da troca feita pela IA)
// O usuário da Feegow sozinho não basta: na clínica, o paciente também marca pela página de agendamento online da
// Feegow, que aparece com o mesmo nome. Por isso, com "descricao_contem", só conta o que tem a marca da IA.
// Sem a configuração, vale o de antes: só o que a IA registrou pela API.
// Só texto de SQL: usado em lib/painel/resultados.ts e lib/painel/agenda.ts, sobre a tabela servicos (alias).

const CFG = `(select valor from crm_config where chave = 'agenda_ia')`;
const lista = (campo: string) => `(select jsonb_array_elements_text(coalesce(${CFG}->'${campo}', '[]'::jsonb)))`;

export const sqlPelaIa = (s: string) =>
  `(${s}.criado_por = 'IA' or ${s}.criado_por in (select nome from api_chaves)
    or (coalesce(${s}.detalhes->'feegow'->>'agendado_por', '') in ${lista('feegow_agendado_por')}
        and (not exists ${lista('descricao_contem')} or coalesce(${s}.descricao, '') ilike any (select '%' || x || '%' from ${lista('descricao_contem')} t(x)))))`;

export const sqlTeste = (s: string) => `(coalesce(${s}.detalhes->'feegow'->>'paciente_id', '') in ${lista('pacientes_teste')})`;

export const sqlTroca = (s: string) =>
  `(coalesce(${s}.descricao, '') ilike any (select x || '%' from ${lista('trocas_comecam_com')} t(x)))`;
