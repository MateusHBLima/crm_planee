-- 024 — Banco de DADOS de cada empresa: várias pessoas no mesmo número (12/10).
-- contatos.telefone continua único: é o dono do número (quem conversa no WhatsApp; funil e Inbox ficam nele).
-- Dependente, familiar e quem divide o número viram contato próprio (sem telefone) ligado ao número aqui, com o papel.
-- A carga vem do "Quem é quem" da IA (POST /api/v1/pessoas/lote) e também dá para editar pelo recurso
-- /api/v1/contato_telefones. A ficha por telefone devolve todas as pessoas do número.
-- Idempotente; só acrescenta.

create table if not exists contato_telefones (
  id             uuid primary key default gen_random_uuid(),
  contato_id     uuid not null references contatos(id),
  telefone       text not null check (telefone ~ '^55[0-9]{10,11}$'),          -- 55 + DDD + número, só dígitos
  papel          text not null check (papel in ('proprio','dependente','familiar','mesmo_numero','equipe_fornecedor')),
  origem         text check (length(origem) <= 60),
  arquivado      boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
-- Mesmo número com e sem o 9 é o mesmo vínculo (regra tel_chave: DDD + últimos 8 dígitos).
create unique index if not exists contato_telefones_unico on contato_telefones (contato_id, substr(telefone, 3, 2), right(telefone, 8));
create index if not exists contato_telefones_numero_idx on contato_telefones (substr(telefone, 3, 2), right(telefone, 8)) where not arquivado;
alter table contato_telefones enable row level security;

-- Os agendamentos da Feegow de um paciente são achados pelo código dele (para mudar de contato na separação).
create index if not exists servicos_feegow_paciente_idx on servicos ((detalhes->'feegow'->>'paciente_id')) where sistema = 'feegow';
