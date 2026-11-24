-- 035 — Banco de DADOS de cada empresa: agenda própria do painel (23/11). Serve para qualquer negócio (não só
-- clínica): profissionais (ou pessoas/recursos que atendem), salas, tipos de atendimento, grade semanal, bloqueios e
-- agendamentos. A clínica do Dr. Amilton continua na Feegow; esta agenda é para quem não tem sistema próprio.
-- Cada agendamento também vira um serviço (tabela servicos, sistema = 'agenda'), para aparecer na ficha do contato,
-- no funil e nos comprovantes como os da Feegow. Nada é apagado: arquivado = true. Idempotente.

create table if not exists ag_profissionais (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  descricao      text,                          -- especialidade, cargo...
  cor            text,
  email          text,                          -- para convites e Google Agenda
  ordem          int not null default 0,
  arquivado      boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create table if not exists ag_salas (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  descricao      text,
  arquivado      boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Tipos de atendimento: Consulta presencial (60 min, R$ 400), Retorno, Corte de cabelo, Visita técnica...
create table if not exists ag_tipos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  duracao_min     int not null default 60 check (duracao_min between 5 and 720),
  valor           numeric(12,2),
  cor             text,
  modalidade      text not null default 'presencial' check (modalidade in ('presencial', 'online', 'domicilio')),
  descricao       text,
  profissionais   uuid[] not null default '{}',  -- quem atende este tipo; vazio = todos
  publico         boolean not null default true, -- aparece no link público de agendamento
  ordem           int not null default 0,
  arquivado       boolean not null default false,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- Grade semanal: em que dias e horários cada profissional atende. dia_semana: 0 = domingo ... 6 = sábado.
-- Horário local da empresa (crm_config "agenda".fuso, padrão America/Sao_Paulo).
create table if not exists ag_grade (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  uuid not null references ag_profissionais (id),
  dia_semana       int not null check (dia_semana between 0 and 6),
  inicio           time not null,
  fim              time not null,
  sala_id          uuid references ag_salas (id),
  arquivado        boolean not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  check (fim > inicio)
);
create index if not exists ag_grade_prof_idx on ag_grade (profissional_id, dia_semana) where not arquivado;

-- Bloqueios: férias, feriado, compromisso. Sem profissional = vale para todos.
create table if not exists ag_bloqueios (
  id               uuid primary key default gen_random_uuid(),
  profissional_id  uuid references ag_profissionais (id),
  inicio           timestamptz not null,
  fim              timestamptz not null,
  motivo           text,
  arquivado        boolean not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  check (fim > inicio)
);
create index if not exists ag_bloqueios_periodo_idx on ag_bloqueios (inicio, fim) where not arquivado;

create table if not exists ag_agendamentos (
  id                uuid primary key default gen_random_uuid(),
  profissional_id   uuid not null references ag_profissionais (id),
  tipo_id           uuid not null references ag_tipos (id),
  sala_id           uuid references ag_salas (id),
  contato_id        uuid references contatos (id),
  nome              text,                       -- como a pessoa se apresentou (o contato pode ter outro nome)
  telefone          text,
  inicio            timestamptz not null,
  fim               timestamptz not null,
  status            text not null default 'agendado'
                    check (status in ('agendado', 'confirmado', 'atendido', 'faltou', 'cancelado')),
  origem            text not null default 'painel' check (origem in ('IA', 'painel', 'link', 'google', 'api')),
  observacao        text,
  valor             numeric(12,2),
  criado_por        text,
  cancelado_em      timestamptz,
  cancelado_motivo  text,
  google_evento_id  text,
  chave             text unique,                -- idempotência: a mesma chave devolve o que já existe
  arquivado         boolean not null default false,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  check (fim > inicio)
);
create index if not exists ag_agendamentos_prof_idx on ag_agendamentos (profissional_id, inicio) where status <> 'cancelado' and not arquivado;
create index if not exists ag_agendamentos_contato_idx on ag_agendamentos (contato_id, inicio desc);
create index if not exists ag_agendamentos_periodo_idx on ag_agendamentos (inicio) where not arquivado;
