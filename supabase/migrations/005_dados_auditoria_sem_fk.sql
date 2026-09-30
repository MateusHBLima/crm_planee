-- 005 — Banco de DADOS de cada empresa: a auditoria do CRM deixa de exigir que a pessoa exista neste banco.
-- Com o banco central (decisão 26), as pessoas ficam no central; painel_auditoria.usuario_id guarda o id de lá.
-- Rodar em todo banco de dados de empresa, depois da 003. Idempotente. No banco de teste (central e dados juntos)
-- também pode rodar: não muda nada do que já funciona.
alter table painel_auditoria drop constraint if exists painel_auditoria_usuario_id_fkey;
