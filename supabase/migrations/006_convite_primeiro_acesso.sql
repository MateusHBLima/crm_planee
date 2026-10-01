-- 006 — Banco CENTRAL: código de primeiro acesso (auditoria de 01/10, achado S2).
-- O primeiro acesso deixa de ser cadastro livre: a pessoa só cria a senha com o código que o admin (ou a Planee)
-- recebe ao cadastrá-la. Guardamos só o hash do código e a validade. Idempotente.
alter table painel_usuarios add column if not exists convite_hash text;
alter table painel_usuarios add column if not exists convite_expira timestamptz;
