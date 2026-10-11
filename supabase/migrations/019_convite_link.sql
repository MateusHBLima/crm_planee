-- 019 — Banco CENTRAL: link de convite de uso único (09/10).
-- O admin (ou a Planee) gera um link na tela Equipe e manda para a pessoa. Ela abre, põe nome, e-mail e senha,
-- e entra na empresa como membro com o acesso escolhido no link (por padrão nenhum: o admin libera depois).
-- Só o hash do link fica no banco. O link vale uma vez, por 7 dias, e pode ser cancelado. Idempotente.

create table if not exists convites_link (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  empresa_id  text not null references empresas(id),
  permissoes  text[] not null default '{}',
  criado_por  uuid references painel_usuarios(id),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  usado_por   uuid references painel_usuarios(id),
  cancelado   boolean not null default false
);
create index if not exists convites_link_empresa_idx on convites_link (empresa_id, criado_em desc);
alter table convites_link enable row level security;
