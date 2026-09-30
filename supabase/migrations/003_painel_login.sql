-- 003 — Login do painel (tarefa 0.6, parte 1) e hora em que o atendimento foi assumido.
-- Rodar no Supabase do painel ANTES do merge deste PR. Idempotente.
-- O login é o Supabase Auth do próprio projeto; esta tabela diz quem pode entrar no painel e com qual papel.

create table if not exists painel_usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  nome          text not null,
  papel         text not null check (papel in ('secretaria','gestor','planee')),
  auth_id       uuid unique,            -- id do usuário no Supabase Auth, preenchido no primeiro login
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ultimo_acesso timestamptz
);
create unique index if not exists painel_usuarios_email_idx on painel_usuarios (lower(email));
alter table painel_usuarios enable row level security;

-- Auditoria: escrita feita por uma pessoa no painel (a chave da API continua em chave_id).
alter table painel_auditoria add column if not exists usuario_id uuid references painel_usuarios(id);
create index if not exists painel_auditoria_alvo_idx on painel_auditoria (recurso, alvo_id);

-- Quadro de atendimento: quando alguém assumiu (tempo até a equipe responder).
alter table atendimentos add column if not exists assumido_em timestamptz;
