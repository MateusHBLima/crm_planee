-- 023 — Banco de DADOS de cada empresa: funil comercial andando sozinho com os envios automáticos da IA (12/10).
-- Quando a IA registra um follow-up ou uma retomada enviada (POST /api/v1/automaticas/envios), a oportunidade viva
-- do contato vai para a etapa de follow-up configurada em crm_config "funil_automatico". Aqui fica guardado:
--   etapa_antes_followup: de onde ela saiu (se o paciente responder, volta para lá);
--   followup_em: quando saiu o último follow-up ou retomada (sem resposta por N dias, vai para "perdido");
--   perdido_auto_em: quando o funil automático pôs em "perdido" (se a pessoa responder em até 30 dias, ou a IA
--   chamar de novo, a oportunidade volta em vez de nascer outra).
-- Idempotente; só acrescenta.

alter table oportunidades add column if not exists etapa_antes_followup text;
alter table oportunidades add column if not exists followup_em timestamptz;
alter table oportunidades add column if not exists perdido_auto_em timestamptz;
create index if not exists oportunidades_followup_idx on oportunidades (followup_em) where followup_em is not null and not arquivado;
