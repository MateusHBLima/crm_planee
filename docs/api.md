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

O CPF inteiro nunca sai pela API nem pelo MCP (LGPD): na ficha vem só o final (3 dígitos) e em `contatos` (listar, obter, criar, atualizar) o campo `documento` vem como `***` + os 2 últimos dígitos. O filtro `documento` continua aceitando o número inteiro. O MCP aceita no máximo 20 chamadas por lote. Toda mudança fica em `painel_auditoria` com a chave que fez.

## Agendamentos, comprovantes e alerta (migrações 013 e 014)

Módulo por empresa: permissões `pagamentos.ver` (ver agendamentos e comprovantes) e `pagamentos.conferir` (conferir e registrar pela tela), liberadas em Empresas.

- **Agendamento:** `POST /api/v1/servicos/registrar` com `{telefone, nome?, tipo, descricao?, inicio, profissional?, local?, valor?, situacao?, sistema, codigo_externo, detalhes?, atendimento_id?}`.
  - Cria o agendamento ou, se o mesmo `sistema` + `codigo_externo` já existir, atualiza. O contato é achado pelo telefone (com e sem o 9) ou criado.
  - `situacao`: `agendado | confirmado | realizado | cancelado | faltou`.
  - Resposta: `{id, criado, contato_id}`. Escopo `crm`.
- **Comprovante:** `POST /api/v1/pagamentos` com `{telefone | contato_id, servico: {sistema, codigo_externo} | servico_id, valor, pago_em, forma, descricao, wamid?, arquivo: {nome, mime, base64}, analise?, comprovante?}`.
  - Aceita PDF, JPG, PNG e WEBP, até 10 MB. O conteúdo precisa bater com o tipo.
  - O arquivo fica no banco da empresa (`pagamentos_arquivos`).
  - Resposta: `{id, contato_id, servico_id, alerta_atendimento_id}`. Escopo `crm`.
  - `comprovante` (migração 014): `{pagador, banco, id_pix, recebedor, recebedor_documento, emitido_em}`, o que está escrito no comprovante. Todos opcionais. `id_pix` é o ID E2E, só letras e números; `recebedor_documento` é CNPJ ou CPF.
  - **Repetido:** o mesmo `wamid`, ou o mesmo `id_pix` para o mesmo contato e agendamento, não cria outro pagamento. A resposta traz o que já existe, com `repetido: true`. Se o primeiro veio sem arquivo e este traz, o arquivo é anexado.
  - **ID Pix reaproveitado:** o mesmo `id_pix` já usado por outro contato ou em outro agendamento marca o pagamento novo como `suspeito`, com o motivo, e abre o alerta. Esse motivo continua mesmo que a análise da IA venha depois dizendo `ok`.
- **Análise:** `PATCH /api/v1/pagamentos/{id}` com `{analise: {resultado: "ok" | "suspeito", motivos: [...]}}`.
  - `suspeito` abre um cartão no quadro, no assunto de valores, em "aguardando", com `alerta = true`. Ele fica vermelho desde que abre.
  - É um cartão só por pagamento.
  - Também dá para mudar valor, data, forma, descrição, serviço e `comprovante`. "Conferido" não muda pela API: só uma pessoa, pela tela.
- **Arquivo:** `GET /api/v1/pagamentos/{id}/arquivo`. Escopo `leitura`.
- **Ficha:** `GET /api/v1/ficha` traz também `servicos` e `pagamentos`, sem o arquivo.
- **No painel:**
  - A ficha do contato mostra o **Histórico do paciente**: atendimentos, notas, agendamentos, comprovantes, suspeitas e conferências.
  - Clicar no agendamento abre o detalhe, com o código da Feegow, os comprovantes, "Ver comprovante" e "Conferir".
  - O detalhe do cartão mostra os 8 eventos mais recentes.
  - Quando a Planee abre um comprovante, isso fica registrado na auditoria central.

## Painel → n8n

Quando alguém finaliza um atendimento no painel, o painel avisa o n8n (para a IA poder retomar a conversa, tarefa 2.4): `POST` em `N8N_WEBHOOK_PAINEL_RETOMAR` com cabeçalho `x-painel-segredo: N8N_WEBHOOK_SEGREDO` e corpo `{"evento":"atendimento_finalizado","atendimento_id","telefone","empresa","por"}`. Sem a variável, nada é enviado. O aviso nunca atrasa nem derruba a tela. O mesmo endereço recebe `{"evento":"conversa_devolvida","empresa","numero_id","wa_id","por"}` quando alguém devolve uma conversa para a Sara na Inbox e a última mensagem é do contato (`docs/whatsapp.md`, item 11).

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

## Leituras internas das telas (não é API pública)

As telas do painel leem por `GET /api/painel/ler/<recurso>`, com o login da pessoa (cookie), não com chave. Não serve para integração: use a API acima. Os recursos estão em `lib/painel/leituras.ts`:

- **CRM:** `quadro`, `detalhe`, `comercial`, `contatos`, `atendimentos_contato`, `notas_contato`, `historico`, `servico`.
- **Inbox:** `conversas`, `conversa`.
- **Avisos para a Planee e Interno:** `planee_empresa`, `faixa`, `avisos`, `aviso`, `saude`, `saude_empresa`, `novidades`, `integracoes`. Do `avisos` em diante, só o master.

Gravar continua por ações do servidor. As rotas GET rodam em paralelo, então a atualização automática não segura o clique da pessoa. O cabeçalho `Server-Timing` mostra o tempo da sessão e do banco em cada pedido.
