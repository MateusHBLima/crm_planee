-- 027 — Banco de DADOS de cada empresa: de quem é este banco e o que já rodou nele (módulos, 16/10).
-- Base do mecanismo de módulos (docs/modulos.md). Não tem nada de nenhum módulo: só serve para
--   1) o SQL de um módulo abortar se rodar no banco de outra empresa (painel_exigir_empresa);
--   2) o painel saber se o SQL do módulo já rodou neste banco (painel_migracoes).
-- Depois desta migração, diga de quem é o banco (uma vez, trocando o id):
--   insert into painel_empresa (id) values ('<id da empresa>') on conflict (unico) do nothing;
-- Idempotente; só acrescenta.

create table if not exists painel_empresa (
  unico      boolean primary key default true check (unico),                -- uma linha só
  id         text not null check (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),        -- empresas.id no banco central
  criado_em  timestamptz not null default now()
);
alter table painel_empresa enable row level security;

create table if not exists painel_migracoes (
  id           text primary key check (id ~ '^[a-z0-9_]{2,40}/[0-9]{3}$'),  -- "<módulo>/<número>", ex.: "condicao_comercial/001"
  modulo       text not null check (modulo ~ '^[a-z0-9_]{2,40}$'),
  aplicada_em  timestamptz not null default now(),
  por          text not null default current_user
);
alter table painel_migracoes enable row level security;

-- Primeira linha de todo SQL de módulo. Aborta (e nada do arquivo é gravado) se o banco não for da empresa pedida.
create or replace function painel_exigir_empresa(esperada text) returns void
language plpgsql set search_path from current as $$
declare atual text;
begin
  if esperada is null or esperada = 'TROQUE_PELO_ID_DA_EMPRESA' then
    raise exception 'Troque TROQUE_PELO_ID_DA_EMPRESA, na primeira linha, pelo id da empresa (ex.: ssa). Nada foi alterado.';
  end if;
  select id into atual from painel_empresa;
  if atual is null then
    raise exception 'Este banco ainda não diz de qual empresa é. Rode antes: insert into painel_empresa (id) values (''%''). Nada foi alterado.', esperada;
  end if;
  if atual <> esperada then
    raise exception 'Este banco é da empresa "%", não de "%". Nada foi alterado.', atual, esperada;
  end if;
end $$;

-- Última linha de todo SQL de módulo: marca que ele rodou neste banco (rodar de novo não duplica).
create or replace function painel_registrar_migracao(migracao text) returns void
language plpgsql set search_path from current as $$
begin
  insert into painel_migracoes (id, modulo) values (migracao, split_part(migracao, '/', 1))
  on conflict (id) do nothing;
end $$;
