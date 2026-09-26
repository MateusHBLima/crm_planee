# CLAUDE.md — Painel Planee (crm_planee)

Leia este arquivo inteiro antes de escrever qualquer código ou SQL.

## O que é

O Painel Planee é a tela única onde a clínica atende pelo WhatsApp e a Planee Lab IA opera o agente de IA. Tem cinco módulos: inbox (espelho do WhatsApp), CRM com dois funis, configurações do agente e do CRM, resultados para a clínica e painel interno da Planee.

O primeiro cliente é o Instituto Neuro Essentia (Dr. Amilton). O agente de IA se chama **Sara**. **Amanda** é a secretária humana. Não confundir.

## Onde está cada coisa

| Arquivo | O que tem |
|---|---|
| `PLANO.md` | Fases e tarefas, em ordem. **Comece por aqui.** |
| `docs/decisoes.md` | Decisões fechadas, com data. Não reabrir sem o Mateus. |
| `docs/especificacao.md` | Especificação do produto: módulos, dados, fluxos, n8n |
| `docs/relatorio.md` | Relatório completo: contexto, estado real, riscos, glossário |
| `prototipo/Main.dc.html` | Protótipo navegável aprovado. Referência de tela, cor e comportamento |
| `design/tokens.css` | Cores e superfícies dos temas claro e escuro, prontas para usar |
| `design/sistema-visual.md` | Regras do sistema visual |

Quando a especificação e as decisões divergirem, **as decisões valem** (a especificação foi escrita em 17/09; as decisões de 24 a 26/09 mudam nomes de tabela, tiram o ClickUp e definem um deploy por cliente).

## Regras que não se quebram

1. **Produção não é tocada.** Escrita no banco só no Supabase de teste do painel (decisão 23); enquanto ele não existir, só no schema `teste`. O schema `public` é somente leitura. Nos workflows do n8n, só a pasta `AMBIENTE DE TESTE — Sara`.
2. **Nenhuma credencial no repositório nem na conversa.** Chaves vão no `.env.local`, que o Mateus preenche. Se precisar de um valor, peça para ele colocar no `.env.local`.
3. **SQL de escrita passa pelo Mateus.** Entregue um comando por vez, pronto para colar, com um `SELECT` de conferência logo depois. Ele roda, confere e só então segue.
4. **Confirme antes de mudar.** Mostre o que vai fazer e espere o OK antes de alterar banco, workflow ou decisão.
5. **Verifique relendo.** Depois de gravar, releia do banco. "Está configurado para gravar" não é prova.
6. **Dados de saúde (LGPD).** Nada de dado real de paciente em seed, teste, print ou commit. Use dados fictícios. CPF aparece mascarado para o papel `planee`.
7. **O painel não fala com a Meta.** Todo envio de mensagem passa por webhook do n8n. O painel nunca insere em `mensagens_gemini_cliente`.
8. **O agente não depende do painel.** Se o painel cair, a IA continua atendendo.
9. **Nada específico de cliente no código** (decisão 21). Cada cliente é um projeto na Vercel com as próprias variáveis; diferença entre clientes é configuração no banco dele. Nunca `if (cliente === ...)`.
10. **O código só conhece o modelo padrão** (decisão 22). Tabelas e colunas de `supabase/modelo.md`; adaptação de banco antigo é view no banco do cliente.

## Armadilhas conhecidas do banco

- `mensagens_gemini_cliente.timestamp` é **TEXT** (`DD-MM-YYYY HH24:MI:SS`). Ordene por `id`, agregue com `to_timestamp(...)`. Os logs (`log_requisicoes`, `log_agendamentos`) têm `timestamptz` de verdade.
- Telefone aparece com 11, 12 e 13 dígitos. Use `public.tel_chave(telefone)` (55 + DDD + 8 últimos). `@lid` e `lid_pending` viram NULL.
- `notificacoes.resolved` significa "entrou no relatório", não "foi resolvido". Não use em tela.
- `ms_gemini` é sempre nulo.
- Preço do modelo: filtre por faixa de data (`CURRENT_DATE BETWEEN vigente_desde AND COALESCE(vigente_ate,'2999-12-31')`), nunca `vigente_ate IS NULL`. Tire o prefixo `models/` do campo `modelo` no join.
- Os nomes de coluna das tabelas antigas **não foram conferidos**. A primeira tarefa da fase 0 é ler `information_schema` antes de escrever SQL.

## Armadilhas do n8n (quando chegar na fase 2)

- n8n não tem rascunho: `PATCH` pela API vai ao ar na hora.
- Em modo fila, mudar o valor de um parâmetro por API não vale; recriar o nó com id novo vale.
- Workflow ativo não recarrega com PATCH: desativar e reativar (`activate` exige `{versionId}`).
- Nó que devolve zero itens interrompe o ramo em silêncio, e a execução termina como sucesso.

## Stack

- Next.js (App Router) + TypeScript.
- Supabase: Auth, Postgres com RLS por papel, Realtime.
- Estilo: CSS Modules + `design/tokens.css` (variáveis CSS). Sem biblioteca de componentes; o protótipo é a referência.
- Fontes: Geist e Geist Mono (Google Fonts ou `next/font`).
- Hospedagem: Vercel, fora da VPS do agente. Um projeto por cliente mais o projeto `adm`, todos da mesma `main`; o modo vem da variável `PAINEL_MODO`.
- Idioma da interface: português do Brasil.

## Papéis

`secretaria` (inbox e CRM), `gestor` (+ resultados e configurações de negócio e CRM), `planee` (tudo, CPF mascarado, acesso a conversa auditado). A tabela de acessos completa está em `docs/especificacao.md`, seção 2.

## Como trabalhar com o Mateus

- Ele prefere recomendação decidida a lista de opções, e a solução mais simples que funciona.
- Escreva em português, direto.
- Ao terminar uma tarefa do `PLANO.md`, marque-a e diga em uma ou duas frases o que ficou pronto e como foi verificado.
