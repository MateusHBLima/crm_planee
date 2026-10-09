-- 010 — Banco de DADOS de cada empresa: nome do contato corrigido pela equipe no painel (Inbox).
-- O nome do painel vale mais que o nome salvo na agenda do celular e que o nome do perfil do WhatsApp, e fica num
-- campo próprio porque a sincronização da agenda (coexistência) sobrescreve nome_salvo. Idempotente.

alter table wa_contatos add column if not exists nome_painel     text;
alter table wa_contatos add column if not exists nome_painel_em  timestamptz;
alter table wa_contatos add column if not exists nome_painel_por text;

-- Histórico das trocas de nome: quem, quando, de qual para qual. Fica no banco da empresa (dado dela).
create table if not exists wa_contatos_nomes (
  id         bigserial primary key,
  numero_id  text not null,
  wa_id      text not null,
  anterior   text,
  novo       text,
  por        text,
  em         timestamptz not null default now()
);
create index if not exists wa_contatos_nomes_idx on wa_contatos_nomes (numero_id, wa_id, em desc);

-- No banco da clínica o painel e o receptor entram com usuários do grupo painel_app.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'painel_app') then
    execute 'grant select, insert on wa_contatos_nomes to painel_app';
    execute 'grant usage, select on sequence wa_contatos_nomes_id_seq to painel_app';
  end if;
end $$;
