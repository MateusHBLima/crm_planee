# Esquema atual do banco (tarefa 0.1)

Lido em 26/09/2026 direto do `information_schema` do Supabase do Dr. Amilton (só leitura, via workflow de teste do n8n).
Escopo: todas as tabelas do schema `teste` e as cinco tabelas do `public` listadas no PLANO. Função auxiliar existente: `public.tel_chave(telefone)`. O schema `teste` não tem views nem funções próprias.

"Não nulo" = `NOT NULL`. Padrão "sequência" = `nextval(...)`.

## Schema `public` (somente leitura)

### `public.log_agendamentos`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `quando` | timestamptz | sim | `now()` |
| `telefone` | text |  |  |
| `agendamento_id` | integer |  |  |
| `acao` | text |  |  |
| `verificado` | boolean |  |  |
| `payload` | jsonb |  |  |
| `paciente_id` | integer |  |  |
| `paciente_nome` | text |  |  |
| `paciente_cpf` | text |  |  |
| `tipo_consulta` | text |  |  |
| `profissional_id` | integer |  |  |
| `data_agendada` | date |  |  |
| `horario` | time |  |  |
| `status_id` | integer |  |  |
| `enviado` | jsonb |  |  |
| `resposta` | jsonb |  |  |
| `divergencia` | jsonb |  |  |
| `tentativas` | smallint |  | `1` |
| `reaproveitado` | boolean |  | `false` |
| `execution_id` | text |  |  |
| `erro` | text |  |  |

### `public.log_requisicoes`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `quando` | timestamptz | sim | `now()` |
| `telefone` | text |  |  |
| `execution_id` | text |  |  |
| `modelo` | text |  |  |
| `tokens_entrada` | integer |  |  |
| `tokens_cache` | integer |  |  |
| `tokens_saida` | integer |  |  |
| `tokens_total` | integer |  |  |
| `usou_cache` | boolean |  |  |
| `fallback` | text |  |  |
| `ms_gemini` | integer |  |  |
| `qtd_tools` | smallint |  |  |
| `tools_chamadas` | text[] |  |  |
| `tamanho_historico` | smallint |  |  |
| `erro` | text |  |  |
| `tokens_pensamento` | integer |  |  |
| `service_tier` | text |  |  |
| `workflow` | text |  |  |
| `etapa` | text |  |  |
| `rota` | text |  |  |

### `public.mensagens_gemini_cliente`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim |  |
| `telefone` | text | sim | `''` |
| `timestamp` | text |  | `now()` |
| `base_usuarios_cliente` | text |  | `''` |
| `conversation_history` | jsonb |  |  |
| `chat_lid` | text |  |  |

### `public.notificacoes`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` |
| `destinatario` | text | sim |  |
| `tipo` | text | sim |  |
| `paciente_nome` | text | sim |  |
| `mensagem` | text | sim |  |
| `resolved` | boolean |  | `false` |
| `created_at` | timestamptz |  | `now()` |
| `telefone` | text |  |  |

### `public.usuarios_cliente`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim |  |
| `telefone` | text | sim | `''` |
| `timestamp` | text |  | `''` |
| `gasto_token` | numeric |  |  |
| `cpf` | text |  | `''` |
| `nome` | text |  | `''` |
| `feegow_id` | integer |  |  |
| `chat_lid` | text |  |  |
| `block_expira_em` | timestamp |  |  |

## Schema `teste`

### `teste.agentes_cliente`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim |  |
| `versao` | text |  | `''` |
| `nome_agente` | text |  | `''` |
| `prompt` | text |  | `''` |
| `em_uso` | boolean |  | `false` |
| `data` | timestamptz | sim | `now()` |
| `cliente` | text |  | `''` |
| `tools` | jsonb[] |  |  |
| `cache_key` | text |  | `''` |
| `cache_expire_at` | timestamptz |  |  |

### `teste.conversa_estado`

Chave: PK telefone; UNIQUE clickup_task_id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `telefone` | text | sim |  |
| `jid` | text | sim |  |
| `nome_contato` | text |  |  |
| `etapa` | text | sim | `'novo lead'` |
| `dono` | text | sim | `'ia'` |
| `motivo_escalada` | text |  |  |
| `aguardando_desde` | timestamptz |  |  |
| `paciente_ids` | bigint[] | sim | `'{}'` |
| `proximo_agendamento` | timestamptz |  |  |
| `agendamento_id` | bigint |  |  |
| `clickup_task_id` | text |  |  |
| `ultima_msg_paciente` | timestamptz |  |  |
| `ultima_msg_ia` | timestamptz |  |  |
| `ultima_msg_equipe` | timestamptz |  |  |
| `resumo` | text |  |  |
| `criado_em` | timestamptz | sim | `now()` |
| `atualizado_em` | timestamptz | sim | `now()` |

### `teste.crm_checkpoint`

Chave: PK robo.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `robo` | text | sim |  |
| `ultimo_id` | bigint | sim | `0` |
| `atualizado_em` | timestamptz | sim | `now()` |

### `teste.crm_eventos`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `telefone` | text | sim |  |
| `tipo` | text | sim |  |
| `origem` | text | sim |  |
| `etapa_antes` | text |  |  |
| `etapa_depois` | text |  |  |
| `msg_id` | bigint |  |  |
| `dados` | jsonb | sim | `'{}'` |
| `criado_em` | timestamptz | sim | `now()` |

### `teste.crm_fatos`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `telefone` | text | sim |  |
| `cpf` | text |  |  |
| `chave` | text | sim |  |
| `valor` | text | sim |  |
| `fonte` | text | sim |  |
| `confianca` | text | sim |  |
| `msg_id` | bigint |  |  |
| `ativo` | boolean | sim | `true` |
| `criado_em` | timestamptz | sim | `now()` |
| `atualizado_em` | timestamptz | sim | `now()` |

### `teste.followup_ensaio`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `criado_em` | timestamptz | sim | `now()` |
| `telefone` | text | sim |  |
| `silence_minutes` | integer |  |  |
| `followup_number` | integer |  |  |
| `fazer_followup` | boolean |  |  |
| `motivo` | text |  |  |
| `mensagem` | text |  |  |
| `execution_id` | text |  |  |

### `teste.lid_mapping`

Chave: PK chat_lid.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `chat_lid` | text | sim |  |
| `telefone` | text | sim |  |
| `created_at` | timestamptz |  | `now()` |
| `updated_at` | timestamptz |  | `now()` |

### `teste.log_agendamentos`

Chave: PK id.

Mesmas colunas de public.log_agendamentos.

### `teste.log_eventos`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `quando` | timestamptz | sim | `now()` |
| `telefone` | text |  |  |
| `execution_id` | text |  |  |
| `workflow` | text |  |  |
| `tipo` | text | sim |  |
| `payload` | jsonb |  |  |

### `teste.log_multiagente`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `criado_em` | timestamptz | sim | `now()` |
| `telefone` | text |  |  |
| `fonte` | text |  |  |
| `ate_id` | bigint |  |  |
| `especialista` | text |  |  |
| `roteador` | jsonb |  |  |
| `chamadas` | jsonb |  |  |
| `guardrail` | jsonb |  |  |
| `transferiu` | boolean |  |  |
| `resposta` | text |  |  |
| `tokens` | integer |  |  |
| `ms` | integer |  |  |
| `erro` | text |  |  |
| `ultima_do_paciente` | text |  |  |

### `teste.log_requisicoes`

Chave: PK id.

Mesmas colunas de public.log_requisicoes.

### `teste.mensagens_gemini_cliente`

Chave: PK id.

Mesmas colunas de public.mensagens_gemini_cliente.

### `teste.monitoramento_agente`

Chave: PK id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `timestamp` | timestamptz |  | `now()` |
| `telefone` | text |  |  |
| `origem` | text | sim |  |
| `tipo` | text | sim |  |
| `severidade` | text | sim | `'media'` |
| `detalhe` | text |  |  |
| `mensagem_id` | bigint |  |  |
| `resolvido` | boolean |  | `false` |

### `teste.negocio`

Chave: PK chave.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `chave` | text | sim |  |
| `valor` | text |  |  |
| `fonte` | text |  |  |
| `situacao` | text | sim |  |
| `pendencia` | text |  |  |
| `vigente_desde` | timestamptz | sim | `now()` |
| `atualizado_em` | timestamptz | sim | `now()` |

### `teste.notificacoes`

Chave: PK id.

Mesmas colunas de public.notificacoes.

### `teste.pacientes`

Chave: PK cpf; UNIQUE paciente_id.

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `cpf` | text | sim |  |
| `paciente_id` | bigint |  |  |
| `nome` | text |  |  |
| `data_nascimento` | date |  |  |
| `criado_em` | timestamptz | sim | `now()` |
| `atualizado_em` | timestamptz | sim | `now()` |

### `teste.pacientes_telefone`

Chave: PK id; UNIQUE (telefone, cpf).

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `telefone` | text | sim |  |
| `cpf` | text | sim |  |
| `relacao` | text |  |  |
| `origem` | text | sim |  |
| `confianca` | text | sim |  |
| `vezes_usado` | integer | sim | `0` |
| `ultimo_uso` | timestamptz |  |  |
| `ativo` | boolean | sim | `true` |
| `motivo_inativo` | text |  |  |
| `criado_em` | timestamptz | sim | `now()` |

### `teste.prompt_blocos`

Chave: PK id; UNIQUE (especialista, chave).

| Coluna | Tipo | Não nulo | Padrão |
|---|---|---|---|
| `id` | bigint | sim | `sequência` |
| `especialista` | text | sim |  |
| `ordem` | integer | sim |  |
| `chave` | text | sim |  |
| `titulo` | text | sim |  |
| `texto` | text | sim |  |
| `situacao` | text | sim | `'ok'` |
| `pendencia` | text |  |  |
| `ativo` | boolean | sim | `true` |
| `atualizado_em` | timestamptz | sim | `now()` |

### `teste.usuarios_cliente`

Chave: PK id.

Mesmas colunas de public.usuarios_cliente.

## Observações para a tarefa 0.3

- `conversa_estado` já tem `dono` (`ia`, `humano`, `aguardando`), `motivo_escalada`, `aguardando_desde`, `etapa`, `resumo` e as três `ultima_msg_*`. Faltam para o painel: não lidas, marcada como não lida e `ia_desligada` (item 5 da tarefa 0.4).
- `conversa_estado.jid` é não nulo e sem padrão: todo insert precisa preencher (`tel_chave(telefone) || '@s.whatsapp.net'`).
- `conversa_estado.clickup_task_id` (único) é sobra do plano do ClickUp, que saiu (decisão 8).
- `mensagens_gemini_cliente.timestamp` e `usuarios_cliente.timestamp` são `text`, como o CLAUDE.md já avisa. Ordenar por `id`.
- `mensagens_gemini_cliente` não tem autor da mensagem em coluna: o papel está em `conversation_history->>'role'`, e mensagem da equipe começa com `[EQUIPE] `. Para o painel gravar `enviado_por` (tarefa 2.3) vai precisar de coluna nova ou tabela à parte.
- `notificacoes.telefone` aparece com e sem `@s.whatsapp.net`. Comparar sempre por `tel_chave`.
- `pacientes` usa `cpf` como chave e `pacientes_telefone` liga telefone e CPF (N:N), como na decisão 4. Não há coluna de CNPJ (decisão 13).
- Tabelas de apoio da Sara de teste, fora do painel: `negocio`, `prompt_blocos`, `agentes_cliente`, `log_multiagente`, `crm_checkpoint`, `followup_ensaio`, `monitoramento_agente`. Cópias de segurança: `negocio_v1`, `negocio_bak2609`, `prompt_blocos_v1`, `prompt_blocos_bak2609` (não listadas acima).
