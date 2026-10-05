-- 013 — Banco de DADOS de cada empresa: serviços (agendamentos), pagamentos com comprovante e alerta de suspeita.
-- Serviço = o que está sendo pago (na clínica, cada agendamento da Feegow; em outra empresa, a ordem de serviço).
-- Pagamento = um comprovante de um serviço (ou só do contato), com o arquivo, a análise da IA e quem conferiu.
-- O arquivo fica numa tabela separada, no banco da própria empresa (LGPD), para a lista não carregar os bytes.
-- Nada é apagado: arquivado = true. Idempotente.

create table if not exists servicos (
  id              uuid primary key default gen_random_uuid(),
  contato_id      uuid not null references contatos(id),
  tipo            text not null,                    -- Consulta, Retorno, Exame, OS…
  descricao       text,
  inicio          timestamptz,                      -- data e hora do agendamento
  profissional    text,
  local           text,
  valor           numeric(12,2),
  situacao        text not null default 'agendado'
                  check (situacao in ('agendado','confirmado','realizado','cancelado','faltou')),
  sistema         text,                             -- de onde vem o código: feegow, os…
  codigo_externo  text,                             -- id do agendamento no sistema da empresa
  detalhes        jsonb not null default '{}'::jsonb,
  atendimento_id  uuid references atendimentos(id),
  criado_por      text,
  arquivado       boolean not null default false,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists servicos_contato_idx on servicos (contato_id, inicio desc);
-- O mesmo agendamento da Feegow nunca vira dois serviços: registrar de novo atualiza.
create unique index if not exists servicos_externo_idx on servicos (sistema, codigo_externo) where codigo_externo is not null;

create table if not exists pagamentos (
  id                    uuid primary key default gen_random_uuid(),
  contato_id            uuid not null references contatos(id),
  servico_id            uuid references servicos(id),
  atendimento_id        uuid references atendimentos(id),
  valor                 numeric(12,2),
  pago_em               timestamptz,
  forma                 text check (forma in ('pix','cartao','boleto','dinheiro','outro')),
  descricao             text,
  wamid                 text,                       -- mensagem do WhatsApp em que o comprovante veio
  arquivo_nome          text,
  arquivo_mime          text,
  arquivo_tamanho       int,
  arquivo_sha256        text,
  analise               text check (analise in ('ok','suspeito')),   -- vazio = ainda não analisado
  analise_motivos       jsonb not null default '[]'::jsonb,
  analisado_em          timestamptz,
  alerta_atendimento_id uuid references atendimentos(id),             -- cartão aberto pela suspeita (um só)
  conferido_em          timestamptz,
  conferido_por         text,
  criado_por            text,
  arquivado             boolean not null default false,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists pagamentos_contato_idx on pagamentos (contato_id, criado_em desc);
create index if not exists pagamentos_servico_idx on pagamentos (servico_id);

create table if not exists pagamentos_arquivos (
  pagamento_id uuid primary key references pagamentos(id),
  dados        bytea not null
);

-- Cartão de alerta (comprovante suspeito): vermelho no quadro desde que abre.
alter table atendimentos add column if not exists alerta boolean not null default false;

alter table servicos enable row level security;
alter table pagamentos enable row level security;
alter table pagamentos_arquivos enable row level security;
