-- 028 — Fila "Comprovantes a conferir" e marca opcional "Baixado na Feegow" (22/10).
-- baixado_em/baixado_por: a equipe marca que já deu baixa do pagamento no sistema da clínica (Feegow).
-- É só uma marca: o painel não fala com a Feegow para isso. Sem esta migração, a fila funciona e a marca não aparece.
-- O índice deixa rápida a contagem da tela inicial (comprovantes ainda não conferidos).
-- Idempotente; só acrescenta.

alter table pagamentos add column if not exists baixado_em timestamptz;
alter table pagamentos add column if not exists baixado_por text;
create index if not exists pagamentos_a_conferir_idx on pagamentos (criado_em desc) where not arquivado and conferido_em is null;
