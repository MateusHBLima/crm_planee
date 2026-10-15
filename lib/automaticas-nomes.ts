// Nomes dos tipos de mensagem automática da IA (migração 017), para o servidor e para as telas.
export const TIPOS_AUTOMATICA: Record<string, string> = {
  aniversario: 'Aniversário',
  lembrete_2d: 'Lembrete 2 dias antes',
  lembrete_dia: 'Lembrete no dia',
  followup_1h: 'Follow-up 1h',
  followup_3h: 'Follow-up 3h',
  followup_d1: 'Follow-up dia seguinte',
  followup_tarde: 'Follow-up à tarde',
  followup_transferencia: 'Follow-up após transferência',
  followup_urgencia: 'Retorno depois da urgência',
  followup_3d: 'Follow-up 3 dias',
  followup_7d: 'Follow-up 7 dias',
  followup_14d: 'Follow-up 14 dias',
  followup_30d: 'Follow-up 30 dias',
  retomada: 'Retomada',
  outro: 'Mensagem automática',
};

// Tipo que conta como follow-up (selo, filtro "Em follow-up", cartão e funil automático): followup_* e retomada*.
export const ehFollowup = (tipo: string) => /^(followup|retomada)/.test(tipo);
// Mesma regra em SQL, para a coluna indicada.
export const SQL_EH_FOLLOWUP = (col = 'tipo') => `(${col} like 'followup%' or ${col} like 'retomada%')`;

// Tipo sem nome cadastrado: "followup_xyz" vira "Follow-up xyz", "retomada_m1" vira "Retomada m1".
export function nomeDoTipo(t: string): string {
  if (TIPOS_AUTOMATICA[t]) return TIPOS_AUTOMATICA[t];
  const m = /^(followup|retomada)_?(.*)$/.exec(t);
  if (m) return `${m[1] === 'followup' ? 'Follow-up' : 'Retomada'}${m[2] ? ' ' + m[2].replace(/_/g, ' ') : ''}`;
  return `Automática (${t})`;
}
