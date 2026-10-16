# Módulos por empresa (decisão 46, 16/10)

O painel é um só para todos os clientes. A **base** (CRM, Inbox, API, agenda, Registro...) vale para todos e as
migrações dela ficam em `supabase/migrations/`. O que só alguns clientes usam vira um **módulo**: tem tabela própria,
SQL próprio e só aparece para a empresa que o usa. Assim, cliente novo entra rápido e um cliente nunca recebe no banco
dele o que é de outro (a SSA não leva nada para o banco da clínica, e vice-versa).

## Quando um módulo está ligado

As duas coisas precisam valer:

1. **Marcado** para a empresa: a permissão-base do módulo (a primeira da lista dele) está em `empresas.modulos`.
   O master marca na tela **Empresas**, no bloco "Módulos extras".
2. **Instalado** no banco da empresa: todas as migrações do módulo constam em `painel_migracoes` (migração 027) no
   banco DAQUELA empresa, e o `painel_empresa` desse banco diz que ele é dela.

| Situação | Tela Empresas | API |
|---|---|---|
| Não marcado | sem selo | rota do módulo: `404`; fora do catálogo (`GET /api/v1`) e da ficha |
| Marcado, sem o SQL | "Marcado, mas falta rodar o SQL" + a pasta do SQL | rota do módulo: `409` com `detalhe.codigo = "modulo_sem_migracao"` |
| Marcado e instalado | "Instalado no banco da empresa" | rota, catálogo e bloco na ficha |
| Banco diz que é de outra empresa | aviso em vermelho | nenhum módulo liga (`409`) |

Na ficha (`GET /api/v1/ficha`), o bloco de um módulo desligado **não aparece** (nem `null`, nem `{}`): a mesma IA
serve empresa com e sem o módulo.

## Permissões

- Permissão de módulo sempre começa com `m.<id do módulo>.` (ex.: `m.condicao_comercial.editar`).
- O admin e o membro só recebem o que a empresa tem (como sempre). Além disso, permissão de módulo só vale com o módulo
  **ligado**: marcado sem o SQL, ninguém tem.
- O **master** tem toda a base, mas módulo **só quando a empresa tem**. Antes de 16/10 o master recebia tudo.

## Onde fica cada parte

| Parte | Arquivo |
|---|---|
| Lista dos módulos (nome, permissões, migrações, pasta do SQL) | `lib/modulos.ts` (também usada pelas telas) |
| Recursos da API e bloco da ficha de cada módulo | `lib/modulos-servidor.ts` |
| SQL de cada módulo | `supabase/modulos/<id>/NNN_*.sql` (modelo em `supabase/modulos/README.md`) |
| Trava e registro no banco | migração `027_painel_empresa.sql`: `painel_empresa`, `painel_migracoes`, `painel_exigir_empresa()`, `painel_registrar_migracao()` |

## Criar um módulo novo

1. Entrada em `MODULOS` (`lib/modulos.ts`): `id`, nome, permissões (a primeira é a base), migrações e pasta.
2. SQL em `supabase/modulos/<id>/001_*.sql`, no modelo: `begin;`, `painel_exigir_empresa(...)`, tabelas `mod_*`,
   `painel_registrar_migracao('<id>/001')`, `commit;`.
3. Recursos e bloco da ficha em `PARTES` (`lib/modulos-servidor.ts`). O recurso leva `modulo: '<id>'`; a API confere
   sozinha. Tela: usar `pode(u, 'm.<id>.ver')`, que só é verdade com o módulo ligado.
4. Teste com duas empresas: uma com o módulo e outra sem (ver `testes/painel/modulos.js`).

Nada no código diz **qual empresa** usa um módulo: isso é só `empresas.modulos` + o SQL rodado no banco dela.

## Ligar um módulo numa empresa (o Mateus)

1. O banco da empresa precisa da 027 e de dizer de quem é (uma vez):
   `insert into painel_empresa (id) values ('<id>') on conflict (unico) do nothing;` → conferir `select id from painel_empresa;`.
2. Rodar o SQL do módulo no banco da empresa, trocando `TROQUE_PELO_ID_DA_EMPRESA` pelo id. Banco errado: aborta sem
   gravar nada. Conferir: `select id, aplicada_em from painel_migracoes order by id;`.
3. Tela Empresas → marcar o módulo → "Salvar módulos" → conferir o selo "Instalado no banco da empresa".

A ordem 1-2-3 ou 3-1-2 dá no mesmo: enquanto faltar o SQL, a tela avisa e a API responde `409`.

## Testes

`testes/painel/modulos.js` usa o módulo fictício `teste_notas`, que só existe no build dos testes
(`NEXT_PUBLIC_PAINEL_MODULO_TESTE=1`, no `rodar.sh`). O build de produção não tem nenhum módulo neste PR.
