-- 017 — Banco de DADOS de cada empresa: mensagens automáticas da IA no CRM (08/10).
-- 1) Recusa no contato: quem pediu para não receber mais mensagens automáticas (aniversário, lembretes, follow-up).
-- 2) envios_automaticos: cada envio automático (enviado, falhou ou cancelado) com tipo, texto e wamid, para a linha
--    do tempo do contato e o selo do follow-up. O relógio dos envios fica do lado da IA (n8n); aqui só o resultado.
-- Idempotente; só acrescenta.

alter table contatos add column if not exists automaticas_paradas_em timestamptz;   -- vazio = pode receber
alter table contatos add column if not exists automaticas_motivo     text;
alter table contatos add column if not exists automaticas_por        text;

create table if not exists envios_automaticos (
  id           uuid primary key default gen_random_uuid(),
  contato_id   uuid not null,
  telefone     text not null,                          -- 55 + DDD + número, como veio (para casar com a conversa)
  tipo         text not null check (tipo ~ '^[a-z0-9_]{2,40}$'),   -- aniversario, lembrete_2d, lembrete_dia, followup_1h ...
  situacao     text not null check (situacao in ('enviado','falhou','cancelado')),
  motivo       text check (length(motivo) <= 300),
  texto        text check (length(texto) <= 4096),
  wamid        text,
  quando       timestamptz not null default now(),
  servico_id   uuid,
  chave        text not null unique check (length(chave) between 3 and 200),   -- da IA: mesmo envio, mesma chave
  criado_por   text,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists envios_automaticos_contato_idx on envios_automaticos (contato_id, quando desc);
create index if not exists envios_automaticos_followup_idx on envios_automaticos (quando desc) where tipo like 'followup%';
alter table envios_automaticos enable row level security;
