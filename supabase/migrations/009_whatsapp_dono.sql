-- 009 — Banco de DADOS de cada empresa: quem está atendendo cada conversa do WhatsApp (Sara ou equipe).
-- "Assumir" no painel (ou responder pelo painel) põe a conversa com a equipe; "Devolver pra Sara" devolve.
-- Resposta pelo celular da clínica pausa a Sara por alguns minutos, sem mudar o dono (vem do eco, em wa_mensagens).
-- A Sara (n8n) pergunta ao receptor antes de responder: GET /whatsapp/atendimento. Idempotente.

alter table wa_conversas add column if not exists dono     text not null default 'ia';
alter table wa_conversas add column if not exists dono_em  timestamptz;   -- quando mudou de dono
alter table wa_conversas add column if not exists dono_por text;          -- nome de quem assumiu ou devolveu

do $$ begin
  alter table wa_conversas add constraint wa_conversas_dono_ck check (dono in ('ia', 'humano'));
exception when duplicate_object then null; end $$;

-- Última resposta da equipe pelo celular, por conversa (pausa curta da Sara).
create index if not exists wa_mensagens_celular_idx on wa_mensagens (numero_id, wa_id, enviada_em desc) where origem = 'celular';
