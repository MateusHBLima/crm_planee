-- Módulo "duvidas", migração 001 (03/11): histórico da aba Dúvidas, uma linha por pergunta de cada pessoa.
-- Quem responde é o agente da empresa no n8n (crm_config "duvidas".url); o painel só guarda a pergunta e a resposta.
-- Modelo de supabase/modulos/README.md: trava da empresa na primeira linha, registro na última, tudo numa transação.
begin;
select painel_exigir_empresa('TROQUE_PELO_ID_DA_EMPRESA');

create table if not exists mod_duvidas (
  id                uuid primary key default gen_random_uuid(),  -- vai ao agente como id_pergunta
  usuario_id        uuid not null,                               -- pessoa do painel (banco central)
  usuario_nome      text,
  pergunta          text not null check (length(pergunta) between 1 and 2000),
  resposta          text,
  erro              text,                                        -- null, "indisponivel", "sem_permissao"...
  pode_ver_valores  boolean not null default false,
  criado_em         timestamptz not null default now(),
  respondido_em     timestamptz
);
create index if not exists mod_duvidas_usuario on mod_duvidas (usuario_id, criado_em desc);
alter table mod_duvidas enable row level security;

select painel_registrar_migracao('duvidas/001');
commit;
