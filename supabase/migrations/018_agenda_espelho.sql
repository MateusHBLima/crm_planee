-- 018 — Banco de DADOS de cada empresa: espelho da agenda do sistema da clínica (Feegow), 09/10.
-- O robô do painel (lib/agenda/espelho.ts) lê a agenda pela API do sistema, só leitura, e grava cada agendamento
-- em "servicos" (modelo padrão, migração 013), o mesmo lugar onde a Sara registra os que ela marca. Assim o CRM e a
-- tela Agenda mostram todos os agendamentos, não só os da Sara. O histórico entra aos poucos (carga), do mais novo
-- para o mais antigo; depois, a cada rodada, o robô relê os próximos dias.
-- Idempotente; só acrescenta. Precisa da 013.

-- Estado do espelho por sistema: até onde a carga do histórico chegou, nomes de profissionais e locais, a última
-- rodada e o último erro. "rodando_ate" é a vez de quem roda (duas réplicas do painel não rodam juntas).
create table if not exists agenda_espelho (
  sistema          text primary key,
  carga_ate        date,                                   -- o histórico já está carregado de carga_ate até hoje
  carga_completa   boolean not null default false,
  vazios_seguidos  int not null default 0,                 -- janelas antigas seguidas sem nenhum agendamento
  cadastros        jsonb not null default '{}'::jsonb,     -- {profissionais, locais, status, procedimentos}: id → nome
  cadastros_em     timestamptz,
  rodando_ate      timestamptz,
  ultima_rodada    timestamptz,
  ultima_ok        timestamptz,
  ultimo_erro      text,
  totais           jsonb not null default '{}'::jsonb,     -- contagens da última rodada (lidos, gravados, chamadas)
  atualizado_em    timestamptz not null default now()
);
alter table agenda_espelho enable row level security;

-- Pacientes do sistema já ligados a um contato do CRM (o mesmo paciente não vira dois contatos). Só o necessário
-- para a ligação: nome e telefone, como vieram do sistema. Sem CPF.
create table if not exists agenda_pacientes (
  sistema        text not null,
  paciente_id    text not null,
  contato_id     uuid references contatos(id),
  nome           text,
  telefone       text,
  atualizado_em  timestamptz not null default now(),
  primary key (sistema, paciente_id)
);
alter table agenda_pacientes enable row level security;

-- A tela Agenda lê os agendamentos de um dia.
create index if not exists servicos_inicio_idx on servicos (inicio) where not arquivado;
