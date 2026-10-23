-- 029 — Banco de DADOS de cada empresa: idempotência por "chave" na API (23/10, pedido do SSA AUGUSTO).
-- POST /atendimentos, /notas, /oportunidades e /funil aceitam "chave" (texto de negócio, ex.: chamado:tel:maquina:dia).
-- A mesma chave na mesma rota devolve o que já existe, com repetido = true, em vez de criar outro cartão.
-- Assim um reenvio do n8n não duplica nada. Sem "chave", tudo funciona como antes.
-- Idempotente; só acrescenta.

create table if not exists api_idempotencia (
  rota       text not null check (rota ~ '^[a-z_]{2,40}$'),           -- atendimentos, notas, oportunidades, funil
  chave      text not null check (length(chave) between 1 and 200),
  recurso    text not null,                                             -- tabela do registro criado
  alvo_id    text not null,                                             -- id do registro criado
  resposta   jsonb not null,                                            -- o que a primeira chamada devolveu
  criado_em  timestamptz not null default now(),
  primary key (rota, chave)
);
alter table api_idempotencia enable row level security;
