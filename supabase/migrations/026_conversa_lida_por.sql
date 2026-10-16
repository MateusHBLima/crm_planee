-- 026 — Banco de DADOS de cada empresa: quem leu a conversa por último (16/10, pedido do Mateus).
-- lida_ate já guardava quando a equipe abriu; lida_por guarda o nome de quem abriu. A Inbox mostra
-- "Lida por <nome> às hh:mm" no cabeçalho. O master (Planee) não marca como lida, então nunca aparece aqui.
-- Idempotente; só acrescenta.

alter table wa_conversas add column if not exists lida_por text;
