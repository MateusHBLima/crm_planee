-- 004 — Banco central: empresas, domínios, níveis e permissões (decisão 26, tarefa 0.8).
-- Rodar no banco CENTRAL da Planee (hoje é o mesmo Supabase de teste do painel). Idempotente.
--
-- Níveis:
--   master  → painel_usuarios.master = true. Vê e faz tudo em todas as empresas.
--   admin   → painel_vinculos.nivel = 'admin'. Tudo o que o master liberou para a empresa (empresas.modulos)
--             e cadastra os membros.
--   membro  → painel_vinculos.nivel = 'membro'. Só as permissões dele que a empresa também tem.
-- A lista de permissões fica no código (lib/permissoes.ts); aqui só guardamos as chaves.

create table if not exists empresas (
  id                text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  nome              text not null check (length(trim(nome)) between 2 and 80),
  ativo             boolean not null default true,
  modulos           text[] not null default '{}',   -- permissões que o master liberou para a empresa
  banco_url_cifrado text,                            -- null = banco padrão do deploy (DATABASE_URL)
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
alter table empresas enable row level security;

create table if not exists empresa_dominios (
  dominio    text primary key check (dominio = lower(dominio) and dominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  empresa_id text not null references empresas(id) on delete cascade,
  criado_em  timestamptz not null default now()
);
create index if not exists empresa_dominios_empresa_idx on empresa_dominios (empresa_id);
alter table empresa_dominios enable row level security;

-- Pessoas: continua sendo painel_usuarios (login pelo e-mail). O papel antigo fica só para a transição.
alter table painel_usuarios add column if not exists master boolean not null default false;
alter table painel_usuarios alter column papel drop not null;

create table if not exists painel_vinculos (
  usuario_id    uuid not null references painel_usuarios(id) on delete cascade,
  empresa_id    text not null references empresas(id) on delete cascade,
  nivel         text not null check (nivel in ('admin','membro')),
  permissoes    text[] not null default '{}',
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);
create index if not exists painel_vinculos_empresa_idx on painel_vinculos (empresa_id);
alter table painel_vinculos enable row level security;

-- O que o master e os admins fizeram (cadastros, permissões, domínios). O CRM continua em painel_auditoria.
create table if not exists central_auditoria (
  id         bigserial primary key,
  quando     timestamptz not null default now(),
  usuario_id uuid references painel_usuarios(id),
  empresa_id text,
  acao       text not null,
  alvo       text,
  detalhe    jsonb
);
create index if not exists central_auditoria_empresa_idx on central_auditoria (empresa_id, quando desc);
alter table central_auditoria enable row level security;

-- Transição do modelo de papéis (003) para o de níveis:
-- a empresa "teste" recebe todos os módulos; planee vira master; gestor vira admin; secretaria vira membro.
insert into empresas (id, nome, modulos) values
  ('teste', 'Empresa de teste',
   array['inbox.ver','crm.ver','crm.editar','crm.arquivar','crm.config','resultados.ver','agente.config'])
on conflict (id) do nothing;

update painel_usuarios set master = true where papel = 'planee' and not master;

insert into painel_vinculos (usuario_id, empresa_id, nivel, permissoes)
select id, 'teste',
       case when papel = 'gestor' then 'admin' else 'membro' end,
       case when papel = 'secretaria' then array['inbox.ver','crm.ver','crm.editar'] else '{}'::text[] end
  from painel_usuarios
 where papel in ('secretaria','gestor')
on conflict (usuario_id, empresa_id) do nothing;
