-- 022 — Banco CENTRAL: de quais assuntos do quadro cada pessoa recebe aviso (11/10).
-- Vazio (null) = todos os assuntos, como antes. Lista = só esses (ex.: a Amanda não recebe os da Dra. Ariane).
-- Cartão passado para a pessoa ("Passar para…") avisa sempre, qualquer que seja o assunto. Idempotente.
alter table painel_vinculos add column if not exists assuntos_aviso text[];
