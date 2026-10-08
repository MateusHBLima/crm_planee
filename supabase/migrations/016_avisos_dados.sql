-- 016 — Banco de DADOS de cada empresa: o detalhe dos avisos que a equipe manda para a Planee (08/10).
-- O índice do aviso fica no banco central (migração 015); aqui fica o que pode ter dado de paciente:
-- o comentário, a conversa (número e telefone do contato), a mensagem e um trecho dela. Idempotente.

create table if not exists avisos_detalhe (
  aviso_id    uuid primary key,                       -- mesmo id do aviso no banco central
  comentario  text not null check (length(comentario) between 3 and 2000),
  numero_id   text,
  wa_id       text,
  wamid       text,
  trecho      text check (length(trecho) <= 600),     -- o texto da mensagem quando o aviso foi feito
  criado_por  text,
  criado_em   timestamptz not null default now()
);
alter table avisos_detalhe enable row level security;

-- Saúde e vigia (Interno Planee) contam mensagens por horário: índice por data de envio (só onde há WhatsApp neste banco).
do $$ begin
  if to_regclass('wa_mensagens') is not null then
    create index if not exists wa_mensagens_enviada_idx on wa_mensagens (enviada_em desc);
  end if;
end $$;
-- Eventos da Meta com erro no receptor (só onde o receptor grava neste banco).
do $$ begin
  if to_regclass('wa_eventos') is not null then
    create index if not exists wa_eventos_erro_idx on wa_eventos (recebido_em) where erro is not null and processado_em is null;
  end if;
exception when insufficient_privilege then
  raise notice 'wa_eventos é de outro dono: índice não criado (só deixa a saúde um pouco mais lenta).';
end $$;
