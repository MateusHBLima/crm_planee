-- 025 — Banco de DADOS de cada empresa: acompanhamento de protocolo do contato (14/10, pedido da Letícia).
-- A equipe marca à mão em que ponto a pessoa está: em análise, em protocolo, em acompanhamento ou encerrado,
-- com uma observação. O painel grava quando mudou (protocolo_em) e quem mudou (protocolo_por).
-- Vazio (null) = a pessoa não está em protocolo. A IA também pode marcar pela API (PATCH /api/v1/contatos/{id}).
-- Idempotente; só acrescenta.

alter table contatos add column if not exists protocolo     text;
alter table contatos add column if not exists protocolo_obs text;
alter table contatos add column if not exists protocolo_em  timestamptz;
alter table contatos add column if not exists protocolo_por text;

do $$ begin
  alter table contatos add constraint contatos_protocolo_ck
    check (protocolo in ('em_analise', 'em_protocolo', 'em_acompanhamento', 'encerrado'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table contatos add constraint contatos_protocolo_obs_ck check (length(protocolo_obs) <= 500);
exception when duplicate_object then null; end $$;

create index if not exists contatos_protocolo_idx on contatos (protocolo, protocolo_em desc) where protocolo is not null and not arquivado;
