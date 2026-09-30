# API do CRM (decisão 25)

Tudo que dá para criar e editar no CRM passa por esta API. As telas do painel e os chats do Claude usam as mesmas operações, e toda escrita fica em `painel_auditoria`.

## Onde

- REST: `https://<deploy>/api/v1` (sem chave, `GET /api/v1` devolve o catálogo completo: recursos, campos, filtros e regras).
- Conector MCP para o Claude: `https://<deploy>/api/mcp` com cabeçalho `Authorization: Bearer <chave>`, ou `https://<deploy>/api/mcp/<chave>` quando o conector não aceita cabeçalho.

**Qual empresa (decisão 26):** o endereço chamado escolhe o banco. No domínio de uma empresa (ex.: `https://painel.clinica.com.br/api/v1`), a chave é conferida e os dados são lidos e gravados no banco daquela empresa. No endereço geral (`adm.planeelabia.com`), vale o banco padrão do deploy. Cada chave existe só no banco da empresa dela.

## O que dá para fazer

| Recurso | O que é | Escrita |
|---|---|---|
| `etapas` | etapas do funil comercial | `config` |
| `topicos` | assuntos do quadro de atendimento | `config` |
| `config` | configuração livre (termo do contato, nomes das etapas de atendimento, campos do cartão...) | `config` |
| `contatos` | pacientes ou clientes (CPF ou CNPJ) | `crm` |
| `oportunidades` | cartões do funil comercial | `crm` |
| `atendimentos` | solicitações do quadro de atendimento | `crm` |
| `notas` | notas internas em contatos, oportunidades e atendimentos | `crm` |

Rotas de cada recurso: `GET /api/v1/<recurso>` (lista, com filtros na URL), `POST` (cria), `GET|PATCH|DELETE /api/v1/<recurso>/<id>` (lê, edita, arquiva). Configuração: `GET /api/v1/config[/<chave>]` e `PUT /api/v1/config/<chave>` com `{"valor": ...}`.

Ferramentas do conector MCP: `descrever_crm`, `listar`, `obter`, `criar`, `atualizar`, `arquivar`, `ler_config`, `definir_config`, `ficha_do_contato`, `mover_no_funil`.

## Para a IA (Sara)

Dois atalhos pelo telefone, para o agente não precisar saber ids:

| Rota | Ferramenta MCP | Escopo | O que faz |
|---|---|---|---|
| `GET /api/v1/ficha?telefone=5547...` | `ficha_do_contato` | `leitura` | Tudo o que o CRM sabe do telefone: contato (nome, final do CPF com 3 dígitos, desde quando), atendimentos abertos e recentes (assunto, etapa, resumo, responsável), notas, oportunidades do funil (etapa, interesse, valor) e a lista `etapas_funil`. Telefone com ou sem o 9 e com ou sem 55. `encontrado: false` quando o número não é de ninguém. |
| `POST /api/v1/funil` `{"telefone","etapa_id","interesse"?,"valor"?,"nome"?}` | `mover_no_funil` | `crm` | Põe o telefone na etapa: move a oportunidade em aberto dele ou cria uma (e o contato, se faltar). Chamar de novo move a mesma oportunidade; depois de ganho ou perdido, a próxima chamada abre outra. |

O CPF inteiro nunca sai pela ficha (LGPD). Toda mudança fica em `painel_auditoria` com a chave que fez.

## Painel → n8n

Quando alguém finaliza um atendimento no painel, o painel avisa o n8n (para a IA poder retomar a conversa, tarefa 2.4): `POST` em `N8N_WEBHOOK_PAINEL_RETOMAR` com cabeçalho `x-painel-segredo: N8N_WEBHOOK_SEGREDO` e corpo `{"evento":"atendimento_finalizado","atendimento_id","telefone","empresa","por"}`. Sem a variável, nada é enviado. O aviso nunca atrasa nem derruba a tela.

## Regras

- Nada é apagado de vez: `DELETE` e `arquivar` marcam `arquivado = true`.
- O funil não fica sem etapa de algum tipo (aberta, ganho, perdido).
- Mensagem de WhatsApp não sai por aqui (passa pelo n8n; regra 7 do CLAUDE.md).
- Mudança de estrutura do banco não é feita pela API: é migração em `supabase/migrations/`.

## Chaves

Cada integração tem a sua chave, com escopos `leitura`, `crm`, `config`. No banco só fica o hash. Para criar, rode no SQL Editor do Supabase daquele deploy:

```sql
select painel_criar_chave('claude', array['leitura','crm','config']);
```

O resultado aparece uma vez só. Cole direto no conector (ou no n8n); não mande em conversa. Para desligar: `update api_chaves set ativa = false where nome = 'claude';`.

## Configuração do deploy

Variável `DATABASE_URL` na stack `painel` do Portainer: a string do "connection pooler" do Supabase (Settings → Database → Connection string). Sem ela, a API responde 503. O conector do Claude usa `https://adm.planeelabia.com/api/mcp/<chave>`.
