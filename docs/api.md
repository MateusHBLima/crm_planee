# API do CRM (decisão 25)

Tudo que dá para criar e editar no CRM passa por esta API. As telas do painel e os chats do Claude usam as mesmas operações, e toda escrita fica em `painel_auditoria`.

## Onde

- REST: `https://<deploy>/api/v1` (sem chave, `GET /api/v1` devolve o catálogo completo: recursos, campos, filtros e regras).
- Conector MCP para o Claude: `https://<deploy>/api/mcp` com cabeçalho `Authorization: Bearer <chave>`, ou `https://<deploy>/api/mcp/<chave>` quando o conector não aceita cabeçalho.

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

Ferramentas do conector MCP: `descrever_crm`, `listar`, `obter`, `criar`, `atualizar`, `arquivar`, `ler_config`, `definir_config`.

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

Variável `DATABASE_URL` no projeto da Vercel: a string do "connection pooler" do Supabase daquele cliente (Settings → Database → Connection string, modo Transaction). Sem ela, a API responde 503.
