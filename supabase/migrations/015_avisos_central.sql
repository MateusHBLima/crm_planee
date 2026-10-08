-- 015 — Banco CENTRAL da Planee: avisos dos clientes, integrações com validade e novidades (08/10).
-- Nada de dado de paciente aqui (decisão 26): o comentário da equipe, o trecho da mensagem e o telefone inteiro
-- ficam no banco da empresa (avisos_detalhe, migração 016). Aqui só o índice: empresa, tipo, estado, título curto.
-- Idempotente.

create table if not exists avisos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     text not null references empresas(id),
  origem         text not null check (origem in ('equipe','sistema')),
  tipo           text not null,                       -- sara_errou, info_errada, problema_tecnico, sugestao, outro,
                                                      -- comprovante_suspeito, numero_silencioso, envios_falhando, token_vencendo
  titulo         text not null check (length(titulo) <= 200),   -- curto e sem dado de paciente
  estado         text not null default 'aberto' check (estado in ('aberto','em_analise','resolvido')),
  criado_por     text,
  criado_por_id  uuid,
  criado_em      timestamptz not null default now(),
  responsavel    text,                                -- quem da Planee está cuidando
  resposta       text check (length(resposta) <= 2000),
  respondido_por text,
  respondido_em  timestamptz,
  atualizado_em  timestamptz not null default now(),
  chave          text unique,                         -- avisos automáticos: um por chave (sem repetição)
  ref            jsonb not null default '{}'::jsonb,  -- {numero_id, wa_final (4 dígitos), alvo, alvo_id}
  tem_detalhe    boolean not null default false,
  lembrado_em    timestamptz                          -- avisos que se repetem (token): último lembrete
);
create index if not exists avisos_estado_idx on avisos (estado, criado_em desc);
create index if not exists avisos_empresa_idx on avisos (empresa_id, criado_em desc);
alter table avisos enable row level security;

-- Integrações de cada empresa com validade (ex.: token da API da Feegow). Configuração interna da Planee.
create table if not exists empresa_integracoes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       text not null references empresas(id),
  sistema          text not null check (sistema ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  rotulo           text check (length(rotulo) <= 80),
  token_valido_ate date,
  observacao       text check (length(observacao) <= 500),
  ativo            boolean not null default true,
  atualizado_em    timestamptz not null default now(),
  atualizado_por   text,
  unique (empresa_id, sistema)
);
alter table empresa_integracoes enable row level security;

-- Novidades e manutenções que a Planee publica: para todas as empresas (empresa_id vazio) ou só para uma.
create table if not exists novidades (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('novidade','manutencao')),
  titulo      text not null check (length(titulo) between 3 and 120),
  texto       text not null check (length(texto) between 1 and 2000),
  empresa_id  text references empresas(id),
  inicio      timestamptz not null default now(),
  fim         timestamptz,                            -- manutenção: até quando aparece a faixa
  criado_por  text,
  criado_em   timestamptz not null default now(),
  arquivado   boolean not null default false
);
create index if not exists novidades_inicio_idx on novidades (inicio desc) where not arquivado;
alter table novidades enable row level security;
