-- Módulo "teste_notas", migração 001 — SÓ PARA OS TESTES do mecanismo de módulos (testes/painel/modulos.js).
-- Segue o modelo de supabase/modulos/README.md: trava da empresa na primeira linha, registro na última,
-- tudo numa transação (se a trava falhar, nada é gravado).
begin;
select painel_exigir_empresa('TROQUE_PELO_ID_DA_EMPRESA');

create table if not exists mod_teste_notas (
  id             uuid primary key default gen_random_uuid(),
  contato_id     uuid not null references contatos(id),
  texto          text not null check (length(texto) between 1 and 500),
  arquivado      boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
alter table mod_teste_notas enable row level security;

select painel_registrar_migracao('teste_notas/001');
commit;
