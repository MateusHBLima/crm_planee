# supabase/modulos/

SQL dos **módulos por empresa** (docs/modulos.md, decisão 46). Diferente de `supabase/migrations/`, que roda em
**todo** banco de empresa, cada pasta aqui só roda no banco das empresas que usam aquele módulo.

```
supabase/modulos/<id do módulo>/001_<o que faz>.sql
supabase/modulos/<id do módulo>/002_<o que faz>.sql
```

## Antes

O banco da empresa precisa da migração **027** (`painel_empresa` e `painel_migracoes`) e de dizer de quem é:

```sql
insert into painel_empresa (id) values ('<id da empresa>') on conflict (unico) do nothing;
select id from painel_empresa;   -- conferência: o id da empresa
```

## Modelo de arquivo

Tudo numa transação. A primeira linha trava a empresa e a última registra a migração:

```sql
begin;
select painel_exigir_empresa('TROQUE_PELO_ID_DA_EMPRESA');

-- tabelas do módulo: sempre com o prefixo mod_, idempotente (if not exists), só acrescenta
create table if not exists mod_<algo> ( ... );
alter table mod_<algo> enable row level security;

select painel_registrar_migracao('<id do módulo>/001');
commit;
```

- **Quem roda:** o Mateus, no SQL Editor do banco da empresa, trocando `TROQUE_PELO_ID_DA_EMPRESA` pelo id dela
  (ex.: `ssa`). Na clínica, como todo SQL de lá, entre `set role painel_app; set search_path = painel;` e `reset role;`.
- **Banco errado:** se o banco for de outra empresa, a primeira linha aborta e nada é gravado.
- **De novo:** rodar outra vez não muda nada (`if not exists` e o registro não duplica).
- **Conferência:** `select id, aplicada_em from painel_migracoes order by id;` e, na tela Empresas, o módulo aparece como
  "Instalado no banco da empresa".
