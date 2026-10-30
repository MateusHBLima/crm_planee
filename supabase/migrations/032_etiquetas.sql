-- 032 — Banco de DADOS de cada empresa: etiquetas coloridas nos cartões do quadro (30/10, pedido do Mateus para a
-- SSA, que está migrando do Trello para o CRM em partes). Recurso genérico: empresa sem etiqueta cadastrada continua
-- igual (Finalizar, Passar, etapas). Com etiquetas, o cartão ganha o botão "Etiqueta" no lugar de Finalizar/Passar:
-- clicar numa etiqueta põe ou tira a etiqueta e, se ela tiver lista de destino, leva o cartão para lá.
--   cor            cor do Trello (green, yellow, orange, red, purple, blue, sky, lime, pink, black, com _light/_dark)
--   topico_destino coluna (crm_topicos) para onde o cartão vai quando a etiqueta é posta; vazio = só marca
--   mover_de       colunas de onde a etiqueta move o cartão; vazio = de qualquer coluna
--   mostrar        aparece no botão "Etiqueta" (false = só aparece nos cartões que já têm)
-- As etiquetas do cartão ficam em atendimentos.etiquetas (ids, na ordem em que foram postas). Acumulam, como no
-- Trello; tirar nunca move. Idempotente; só acrescenta.

create table if not exists crm_etiquetas (
  id             text primary key,
  ordem          int  not null default 0,
  nome           text not null,
  cor            text,
  topico_destino text references crm_topicos(id),
  mover_de       text[] not null default '{}',
  mostrar        boolean not null default true,
  arquivado      boolean not null default false,
  atualizado_em  timestamptz not null default now()
);
alter table crm_etiquetas enable row level security;

alter table atendimentos add column if not exists etiquetas text[] not null default '{}';
