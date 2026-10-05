-- 014 — Banco de DADOS de cada empresa: o que está escrito no comprovante, em campos próprios.
-- Servem para conferir e para achar comprovante reaproveitado: o mesmo ID Pix (E2E) em outro pagamento
-- (de outro paciente ou de outro agendamento) marca o pagamento novo como suspeito e abre o alerta.
-- Depende da 013. Idempotente.

alter table pagamentos add column if not exists pagador             text;         -- nome de quem pagou
alter table pagamentos add column if not exists banco               text;         -- banco ou instituição de quem pagou
alter table pagamentos add column if not exists pix_e2e             text;         -- ID da transação Pix (E2E), em maiúsculas
alter table pagamentos add column if not exists recebedor           text;         -- nome de quem recebeu
alter table pagamentos add column if not exists recebedor_documento text;         -- CNPJ ou CPF de quem recebeu, só números
alter table pagamentos add column if not exists comprovante_em      timestamptz;  -- data e hora escritas no comprovante

create index if not exists pagamentos_pix_idx on pagamentos (pix_e2e) where pix_e2e is not null and not arquivado;
create index if not exists pagamentos_wamid_idx on pagamentos (wamid) where wamid is not null and not arquivado;
