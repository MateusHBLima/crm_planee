-- 001 — Tabelas do CRM usadas pela API do painel (decisão 25).
-- Rodar primeiro no Supabase de teste (decisão 23). Idempotente: pode rodar de novo sem estragar.
-- Nada de dado real aqui.

create extension if not exists pgcrypto;

-- Funil comercial
create table if not exists crm_etapas (
  id            text primary key,
  ordem         int  not null default 0,
  nome          text not null,
  tipo          text not null default 'aberta' check (tipo in ('aberta','ganho','perdido')),
  gatilho       text not null default 'Manual (equipe)',
  arquivado     boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- Assuntos do quadro de atendimento
create table if not exists crm_topicos (
  id            text primary key,
  ordem         int  not null default 0,
  nome          text not null,
  icone         text not null default 'outros',
  palavras      text not null default '',
  arquivado     boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- Configuração livre do CRM (nomes das etapas de atendimento, campos do cartão, termo do contato...)
create table if not exists crm_config (
  chave         text primary key,
  valor         jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- Contatos (paciente ou cliente). Documento aceita CPF ou CNPJ (decisão 13).
create table if not exists contatos (
  id             uuid primary key default gen_random_uuid(),
  nome           text,
  telefone       text unique,
  documento      text,
  tipo_documento text check (tipo_documento in ('cpf','cnpj')),
  empresa        text,
  arquivado      boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Funil comercial: oportunidades
create table if not exists oportunidades (
  id            uuid primary key default gen_random_uuid(),
  contato_id    uuid references contatos(id),
  interesse     text,
  etapa_id      text not null references crm_etapas(id),
  valor         numeric(12,2),
  arquivado     boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Quadro de atendimento: solicitações
create table if not exists atendimentos (
  id              uuid primary key default gen_random_uuid(),
  contato_id      uuid references contatos(id),
  topico_id       text references crm_topicos(id),
  etapa           text not null default 'aguardando'
                  check (etapa in ('aguardando','em_atendimento','pendente','finalizado')),
  resumo          text,
  aberto_por      text,
  responsavel     text,
  oportunidade_id uuid references oportunidades(id),
  arquivado       boolean not null default false,
  aberto_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  finalizado_em   timestamptz
);

-- Notas em qualquer registro
create table if not exists notas (
  id            uuid primary key default gen_random_uuid(),
  alvo_tipo     text not null check (alvo_tipo in ('contatos','oportunidades','atendimentos')),
  alvo_id       uuid not null,
  texto         text not null,
  autor         text,
  arquivado     boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Chaves da API: só o hash fica guardado
create table if not exists api_chaves (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  hash       text not null unique,
  escopos    text[] not null default array['leitura'],
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now(),
  ultimo_uso timestamptz
);

-- Registro de toda escrita feita pela API
create table if not exists painel_auditoria (
  id       bigserial primary key,
  quando   timestamptz not null default now(),
  chave_id uuid references api_chaves(id),
  acao     text not null,
  recurso  text not null,
  alvo_id  text,
  detalhe  jsonb
);

create index if not exists atendimentos_etapa_idx on atendimentos (etapa) where not arquivado;
create index if not exists oportunidades_etapa_idx on oportunidades (etapa_id) where not arquivado;
create index if not exists notas_alvo_idx on notas (alvo_tipo, alvo_id);

-- Estas tabelas só são acessadas pelo servidor do painel (conexão Postgres). RLS ligado e sem regra:
-- a chave anon do Supabase não lê nada delas.
alter table crm_etapas enable row level security;
alter table crm_topicos enable row level security;
alter table crm_config enable row level security;
alter table contatos enable row level security;
alter table oportunidades enable row level security;
alter table atendimentos enable row level security;
alter table notas enable row level security;
alter table api_chaves enable row level security;
alter table painel_auditoria enable row level security;

-- Cria uma chave da API e devolve o texto dela UMA vez. Guarde num lugar seguro; aqui só fica o hash.
-- Uso: select painel_criar_chave('claude', array['leitura','crm','config']);
create or replace function painel_criar_chave(p_nome text, p_escopos text[])
returns text language plpgsql as $$
declare
  v_chave text := 'pk_' || encode(gen_random_bytes(24), 'hex');
begin
  insert into api_chaves (nome, hash, escopos)
  values (p_nome, encode(digest(v_chave, 'sha256'), 'hex'), p_escopos);
  return v_chave;
end $$;
