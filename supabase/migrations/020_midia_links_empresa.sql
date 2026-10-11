-- 020 — Banco de DADOS de cada empresa: links curtos das mídias da Inbox (11/10).
-- Antes o link ficava só no banco central (011), mas o receptor da clínica usa o banco da clínica como central:
-- o painel gravava o link num banco e o receptor procurava em outro ("indisponível" ao ouvir um áudio).
-- Agora o painel grava o link no banco da empresa, o mesmo em que o receptor grava as mensagens e as mídias.
-- Mesmas colunas da 011. Idempotente.
create table if not exists wa_midia_links (
  token      text primary key,
  empresa_id text not null,
  caminho    text not null,
  mime       text,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default now()
);
create index if not exists wa_midia_links_expira_idx on wa_midia_links (expira_em);
alter table wa_midia_links enable row level security;
