-- 021 — Banco de DADOS de cada empresa: cor de fundo da coluna de cada assunto do quadro (11/10).
-- Muda a decisão 11 (assunto sem cor): a equipe pediu um fundo leve por coluna para separar os assuntos de longe
-- (ex.: Dra. Ariane, Dr. Amilton). A cor é uma chave da paleta do painel, não um código de cor: o painel escolhe o
-- tom certo no tema claro e no escuro. Vazio = sem fundo, como antes. Idempotente.
alter table crm_topicos add column if not exists cor text;
alter table crm_topicos drop constraint if exists crm_topicos_cor_check;
alter table crm_topicos add constraint crm_topicos_cor_check
  check (cor is null or cor in ('cinza', 'azul', 'ciano', 'verde', 'amarelo', 'laranja', 'vermelho', 'rosa', 'roxo'));
