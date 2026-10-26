# API do CRM (decisão 25)

Tudo que dá para criar e editar no CRM passa por esta API. As telas do painel e os chats do Claude usam as mesmas operações, e toda escrita fica em `painel_auditoria`.

## Onde

- REST: `https://<deploy>/api/v1` (sem chave, `GET /api/v1` devolve o catálogo completo: recursos, campos, filtros e regras).
- Conector MCP para o Claude: `https://<deploy>/api/mcp` com cabeçalho `Authorization: Bearer <chave>`, ou `https://<deploy>/api/mcp/<chave>` quando o conector não aceita cabeçalho.

**Qual empresa (decisão 26):** o endereço chamado escolhe o banco. No domínio de uma empresa (ex.: `https://painel.clinica.com.br/api/v1`), a chave é conferida e os dados são lidos e gravados no banco daquela empresa. No endereço geral (`adm.planeelabia.com`), vale o banco padrão do deploy. Cada chave existe só no banco da empresa dela.

## Nunca misturar empresas (23/10, migração 029)

Pedido do SSA AUGUSTO: "de forma alguma pode misturar as coisas de empresas". Camadas, da mais forte para a mais fraca:

1. **Banco separado.** Cada empresa tem o seu banco (decisão 26); o banco diz de quem é (`painel_empresa`, migração 027) e o SQL de módulo aborta no banco errado.
2. **Chave presa à empresa.** A chave só existe no banco da empresa dela: usada no endereço de outra empresa, dá `401`. A recusa vai para `central_auditoria` (`acao = 'api_chave_recusada'`, empresa e endereço chamados, rota e só os 8 primeiros caracteres do hash; nunca a chave). No máximo 1 registro por minuto para a mesma chave no mesmo endereço.
3. **Empresa em toda resposta.** Cabeçalho `X-Painel-Empresa: <slug>` em toda resposta da REST (inclusive erro). `GET /api/v1`, `descrever_crm`, a ficha (`/ficha` e `ficha_do_contato`) e a config (`/config` e `ler_config`) trazem no topo `"empresa": {"slug", "nome", "dominio"}`. O conector diz a empresa ao conectar (`instructions` e `serverInfo`). Quem grava confere o `slug` antes.
4. **`X-Empresa: <slug>` (recomendado em toda escrita de integração).** Se não for a empresa do endereço, a API responde `409` com `detalhe.codigo = "empresa_divergente"` antes de tocar no banco; o conector MCP responde `409` ao lote inteiro.
5. **Nada de clínica fora da clínica.** `crm_config` `modelo` diferente de `"clinica"` (ex.: `"empresa"`) tira do catálogo o recurso `servicos` (agendamentos Feegow), os campos e o filtro de protocolo em `contatos`, o `paciente` de `pessoas/lote` e o `servicos/registrar`; a ficha vem sem `servicos` e sem `protocolo`. Sem a chave `modelo`, vale `"clinica"` (como os bancos antigos nasceram).
6. **Uma chave por integração e por empresa**, criada pelo Mateus; nunca passa pelos chats.

**Idempotência por `chave`.** `POST /api/v1/atendimentos`, `/notas`, `/oportunidades` e `/funil` (e `criar`/`mover_no_funil` no conector) aceitam `"chave"` (texto de negócio, até 200 caracteres, ex.: `chamado:tel:maquina:cidade:dia`). A mesma chave na mesma rota devolve o que a primeira chamada criou, como está agora, com `"repetido": true` (status `200` em vez de `201`); reenvios ao mesmo tempo esperam o primeiro e também não duplicam. No `/funil`, a mesma chave não move de novo (o pedido já foi feito). Sem `chave`, tudo como antes. A chave vale só no banco da empresa (a mesma chave em outra empresa é outra). Banco sem a migração 029: mandar `chave` dá `503`; sem `chave`, funciona.

## O que dá para fazer

| Recurso | O que é | Escrita |
|---|---|---|
| `etapas` | etapas do funil comercial | `config` |
| `topicos` | assuntos do quadro de atendimento | `config` |
| `config` | configuração livre (termo do contato, nomes das etapas de atendimento, campos do cartão...) | `config` |
| `contatos` | pacientes ou clientes (CPF ou CNPJ); fora da clínica, só clientes | `crm` |
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
| `POST /api/v1/funil` `{"telefone","etapa_id","interesse"?,"valor"?,"nome"?,"so_avancar"?}` | `mover_no_funil` | `crm` | Põe o telefone na etapa: move a oportunidade em aberto dele ou cria uma (e o contato, se faltar). Chamar de novo move a mesma oportunidade; depois de ganho ou perdido, a próxima chamada abre outra. Com `so_avancar: true` só move para uma etapa de ordem maior (ex.: horários enviados → `oferecido`); senão devolve `movida: false`. |

O CPF inteiro nunca sai pela API nem pelo MCP (LGPD): na ficha vem só o final (3 dígitos) e em `contatos` (listar, obter, criar, atualizar) o campo `documento` vem como `***` + os 2 últimos dígitos. O filtro `documento` continua aceitando o número inteiro. O MCP aceita no máximo 20 chamadas por lote. Toda mudança fica em `painel_auditoria` com a chave que fez.

## Agendamentos, comprovantes e alerta (migrações 013 e 014)

Módulo por empresa: permissões `pagamentos.ver` (ver agendamentos e comprovantes) e `pagamentos.conferir` (conferir e registrar pela tela), liberadas em Empresas.

- **Agendamento:** `POST /api/v1/servicos/registrar` com `{telefone, nome?, tipo, descricao?, inicio, profissional?, local?, valor?, situacao?, sistema, codigo_externo, detalhes?, atendimento_id?}`.
  - Cria o agendamento ou, se o mesmo `sistema` + `codigo_externo` já existir, atualiza. O contato é achado pelo telefone (com e sem o 9) ou criado.
  - Ao atualizar, `detalhes` se soma ao que já existe (não apaga as chaves anteriores). Se o registro veio do espelho da agenda da Feegow, passa a ser de quem registrou (a Sara).
  - `situacao`: `agendado | confirmado | realizado | cancelado | faltou`.
  - Resposta: `{id, criado, contato_id}`. Escopo `crm`.
- **Comprovante:** `POST /api/v1/pagamentos` com `{telefone | contato_id, servico: {sistema, codigo_externo} | servico_id, valor, pago_em, forma, descricao, wamid?, arquivo: {nome, mime, base64}, analise?, comprovante?}`.
  - Aceita PDF, JPG, PNG e WEBP, até 10 MB. O conteúdo precisa bater com o tipo.
  - O arquivo fica no banco da empresa (`pagamentos_arquivos`).
  - Resposta: `{id, contato_id, servico_id, alerta_atendimento_id}`. Escopo `crm`.
  - `comprovante` (migração 014): `{pagador, banco, id_pix, recebedor, recebedor_documento, emitido_em}`, o que está escrito no comprovante. Todos opcionais. `id_pix` é o ID E2E, só letras e números; `recebedor_documento` é CNPJ ou CPF.
  - **Repetido:** o mesmo `wamid`, ou o mesmo `id_pix` para o mesmo contato e agendamento, não cria outro pagamento. A resposta traz o que já existe, com `repetido: true`. Se o primeiro veio sem arquivo e este traz, o arquivo é anexado.
  - **Sem `arquivo` (09/10):** o painel procura a foto ou o PDF que o paciente mandou pelo WhatsApp e copia para o pagamento. Pelo `wamid`, se veio; senão, a última foto ou PDF recebido do mesmo telefone entre 2 h antes e 5 min depois do registro. Precisa do espelho do WhatsApp (receptor) e da migração 011 na central. A resposta traz `arquivo_do_whatsapp`: `anexado`, `baixando` (o painel tenta de novo sozinho em 20 s, 1 min e 3 min), `nao_achado`, `indisponivel` ou `sem_espelho`.
  - **Ver na conversa (26/10):** pagamento com `wamid` ganha o botão "Ver na conversa" na fila de comprovantes e no histórico do contato. Ele abre a Inbox (`/inbox?msg=<wamid>`) na mensagem do comprovante, destacada, e a mensagem mostra o selo com valor, paciente e situação. Só aparece para quem tem `inbox.ver`. Mande o `wamid` sempre que souber; sem ele, o painel só preenche quando copia o arquivo do WhatsApp.
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

## Mensagens automáticas da IA (migração 017)

O relógio dos envios (aniversário, lembretes, follow-up) fica no n8n da Sara. O CRM guarda a recusa e o resultado de cada envio.

- **Recusa:** `POST /api/v1/automaticas/recusa` com `{telefone | contato_id, parar: true|false, motivo?, por?}`. Escopo `crm`.
  - Vale para todos os cadastros do mesmo telefone.
  - Marcar de novo mantém a data e o motivo originais. Liberar limpa tudo.
  - Devolve `{ok, contato_id, contatos, parar, desde, motivo, por}`. Pelo MCP: `parar_automaticas`.
- **Envio:** `POST /api/v1/automaticas/envios` com `{telefone, tipo, situacao, chave, quando?, texto?, wamid?, motivo?, servico?: {sistema, codigo_externo}, nome?}`. Escopo `crm`.
  - `tipo`: `aniversario`, `lembrete_2d`, `lembrete_dia`, `followup_1h`, `followup_3h`, `followup_d1`, `followup_tarde`, `followup_transferencia`, `retomada` ou `outro` (aceita outros nomes em letras minúsculas e `_`; `followup_*` e `retomada*` contam como follow-up).
  - `situacao`: `enviado`, `falhou` ou `cancelado`.
  - `chave` é única por envio: a mesma chave atualiza (`repetido: true`) em vez de duplicar.
  - Devolve `{ok, id, contato_id, repetido, servico_id, funil}`. Pelo MCP: `registrar_envio_automatico`.
  - `funil`: `{oportunidade_id, de}` quando o envio moveu o funil (abaixo); `null` quando não.
- **Funil automático** (migração 023, decisão 37): liga com a configuração `funil_automatico` (escopo `config`), por exemplo `{"followup": "followup", "retomada": "retomada", "de": ["contato", "interesse", "oferecido"], "perdido": "perdido", "dias_sem_resposta": 7}`. Sem ela, nada se move sozinho. `retomada` é opcional (sem ela, retomada vai para `followup`).
  - follow-up (`followup_*`) enviado leva a oportunidade viva que está numa etapa de `de` para `followup`; retomada (`retomada*`) leva para `retomada`. O CRM guarda de onde ela saiu; outro toque troca a etapa conforme o tipo e só renova a data;
  - o paciente respondeu depois do último toque (mensagem recebida na Inbox) → volta para a etapa de onde saiu;
  - `dias_sem_resposta` dias sem resposta depois do último toque → `perdido` (marcado como perdido pelo funil);
  - perdido pelo funil e a pessoa respondeu em até 30 dias → volta para a etapa de onde saiu;
  - essas três regras rodam no vigia, a cada 15 minutos (e no "Verificar agora" do Interno). Tudo fica na auditoria como "Funil automático";
  - `POST /api/v1/funil` para quem foi perdido pelo funil reabre a mesma oportunidade (`reaberta: true`) em vez de criar outra. Perdido marcado à mão pela equipe não reabre: nasce outra oportunidade, como antes.
- **Ficha:** `GET /api/v1/ficha` traz `automaticas: {permitidas, desde, motivo, por, ultimos_envios}`. A IA confere `permitidas` antes de cada envio.
- **No painel:**
  - o histórico do contato mostra cada envio e a recusa, com os botões "Parar mensagens automáticas" e "Voltar a enviar" (`crm.editar`);
  - a conversa na Inbox mostra o selo do follow-up ("Follow-up 1h enviado", "… · sem resposta", "Respondeu ao follow-up", "Parou: pediu para não receber");
  - a lista da Inbox tem o filtro "Em follow-up";
  - a mensagem automática na conversa aparece como "Sara · Follow-up 1h" (casada pelo `wamid` ou, sem ele, pelo texto);
  - o cartão do quadro e o do funil comercial mostram o último follow-up ou retomada enviados nos últimos 31 dias.
- **Texto na Inbox na hora:** depois de cada envio, chame também o `POST /whatsapp/envio` do receptor.

## Dias sem marcação pela IA (14/10)
- A equipe fecha dias pelo CRM (botão **Dias sem IA**, para quem edita o quadro). A lista fica na configuração `agenda_fechada`: `[{"prof": 1, "data": "AAAA-MM-DD", "motivo": "..."}]`, sem `prof` = todos os profissionais. Dias passados saem da lista no próximo salvamento.
- A IA lê com `GET /api/v1/config/agenda_fechada` (escopo `leitura`). Resposta: `{"chave": "agenda_fechada", "valor": [...], "atualizado_em": "..."}`. Sem a chave: 404 com `{"erro": "Configuração \"agenda_fechada\" não existe."}`.
- Os profissionais que aparecem para escolher vêm de `agenda_profissionais`: `[{"id": 1, "nome": "Dr. Fulano"}]` (o `id` é o do sistema da agenda). Sem ela, só dá para fechar o dia para todos.
- Fechar o dia não desmarca ninguém.

## Acompanhamento de protocolo (migração 025, 14/10)
- Fica no próprio contato: `protocolo` (`em_analise`, `em_protocolo`, `em_acompanhamento`, `encerrado`; vazio ou `null` = fora de protocolo), `protocolo_obs` (até 500 caracteres), `protocolo_em` e `protocolo_por`.
- A equipe marca pela tela **Protocolos** do menu ou pela ficha do contato (quem edita o quadro). A IA marca com `PATCH /api/v1/contatos/{id}` e `{"protocolo": "em_analise", "protocolo_obs": "..."}` (escopo `crm`). Valor fora da lista: 400.
- Quando a situação muda, a API grava `protocolo_em = agora` e, se `protocolo_por` não veio, o nome da chave (ou da pessoa no painel). Mandar a mesma situação de novo não muda a data.
- `GET /api/v1/contatos?protocolo=em_protocolo` lista por situação. A ficha (`GET /api/v1/ficha`) traz em cada pessoa `protocolo: {situacao, obs, desde, por}` ou `null`.
- O histórico de cada mudança fica na auditoria (`painel_auditoria`), como todo o CRM.

## Várias pessoas no mesmo número (migração 024)

Mãe e filho no mesmo WhatsApp (decisão 38). O dono do número é o contato com `contatos.telefone` igual (quem conversa; funil e Inbox ficam nele). As outras pessoas são contatos próprios, sem telefone, ligados ao número em `contato_telefones` com o papel.

- **Recurso `contato_telefones`** (escopo `crm`): `contato_id`, `telefone` (normalizado), `papel` (`proprio`, `dependente`, `familiar`, `mesmo_numero`, `equipe_fornecedor`), `origem`. Um vínculo por contato e número (com ou sem o 9).
- **Carga em lote:** `POST /api/v1/pessoas/lote` com `{"origem"?, "itens": [{telefone, papel, paciente: {sistema, codigo}, nome?, cpf?, remover?}]}`. Escopo `crm`.
  - Até 500 itens, mas o recomendado é **50 por chamada** (cada item leva perto de meio segundo). Cada item é uma transação curta: o que já foi gravado fica, erro num item não derruba os outros, e depois de 100 s o resto volta com `erro: nao_processado` (é só reenviar; é idempotente). Os `proprio` vão primeiro.
  - Erros por item: `papel_invalido`, `telefone_invalido`, `sem_paciente`, `cpf_conflito_no_lote`, `conflito_cadastro` (o telefone está num contato arquivado), `ocupado_tente_de_novo` (linha presa por outra gravação), `nao_processado` e `erro_interno` (com `codigo` do banco; fica no log do painel).
  - `proprio`: o dono do número. Se ninguém é dono, usa o contato do paciente (se ele não tem número) ou cria um. O nome passa a ser o do sistema, a não ser que o contato tenha outro CPF. Um dono por número: se o número já tem titular carregado e chega outro `proprio` com outro nome (e não o mesmo CPF), ele entra como `mesmo_numero` (`aviso: ja_tem_proprio`, `papel_gravado`) e o dono não muda. O telefone vale com ou sem o 9.
  - `dependente` e `familiar` ligados ao dono **deste** número (o espelho juntou o filho na mãe): ganham contato próprio e levam os agendamentos do sistema que são deles (`servicos.detalhes.<sistema>.paciente_id`) e os comprovantes desses.
  - `mesmo_numero` e `equipe_fornecedor`: como dependente, mas o dono do número com o mesmo nome continua sendo ele.
  - O paciente passa a apontar para o contato certo em `agenda_pacientes`, e o espelho da agenda segue.
  - Dono do número que não é paciente (a esposa fala pelo marido) e ficou com o nome do paciente que saiu dele: passa a ter o nome do WhatsApp (dado no painel, salvo no celular ou do perfil) ou "Contato WhatsApp ••1234" (`dono_renomeado: true`). Vale também ao reenviar um item já carregado.
  - `remover: true` arquiva o vínculo.
  - **CPF:** só 11 dígitos válidos, e só em contato sem CPF. Não troca CPF diferente (`aviso: cpf_diferente`) nem grava CPF de outro contato (`cpf_em_outro_contato`, com `contato_cpf`). O mesmo CPF para dois pacientes no mesmo lote volta `erro: cpf_conflito_no_lote`.
  - Devolve `{total, ok, erros, itens: [{indice, ok, contato_id, criado, separado?, servicos_movidos?, removido?, aviso?, erro?}]}`. O CPF nunca volta.
- **Ficha:** `contatos` traz todas as pessoas do número, com `papel` (o dono sem titular carregado vem como `responsavel`), `dono_do_numero` e `cpf_final`; serviços e pagamentos de todas elas.
- **No painel:** o histórico do contato (cartão e ficha) mostra "Também neste número" e, para quem não é dono, "Usa o número … como dependente".

## Painel → n8n

Quando alguém finaliza um atendimento no painel, o painel avisa o n8n (para a IA poder retomar a conversa, tarefa 2.4): `POST` em `N8N_WEBHOOK_PAINEL_RETOMAR` com cabeçalho `x-painel-segredo: N8N_WEBHOOK_SEGREDO` e corpo `{"evento":"atendimento_finalizado","atendimento_id","telefone","empresa","por"}`. Sem a variável, nada é enviado. O aviso nunca atrasa nem derruba a tela. O mesmo endereço recebe `{"evento":"conversa_devolvida","empresa","numero_id","wa_id","por"}` quando alguém devolve uma conversa para a Sara na Inbox e a última mensagem é do contato (`docs/whatsapp.md`, item 11).

## Módulos por empresa (decisão 46)

Alguns recursos são de **módulo** e só existem na empresa que tem o módulo ligado (`docs/modulos.md`):

- o catálogo `GET /api/v1` lista em `modulos` e em `recursos` só o que está ligado na empresa do endereço chamado;
- rota de módulo desligado: `404`; marcado sem o SQL no banco da empresa: `409` com `detalhe.codigo = "modulo_sem_migracao"`;
- na ficha, o bloco do módulo vem dentro de cada contato só com o módulo ligado. Desligado, a chave não aparece.

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

- **CRM:** `quadro`, `detalhe`, `comercial`, `contatos`, `atendimentos_contato`, `notas_contato`, `historico`, `servico`, `protocolos`.
- **Inbox:** `conversas`, `conversa`, `abertos_conversa` (atendimentos em aberto do número, para o Finalizar).
- **Avisos para a Planee e Interno:** `planee_empresa`, `faixa`, `avisos`, `aviso`, `saude`, `saude_empresa`, `novidades`, `integracoes`. Do `avisos` em diante, só o master.

Gravar continua por ações do servidor. As rotas GET rodam em paralelo, então a atualização automática não segura o clique da pessoa. O cabeçalho `Server-Timing` mostra o tempo da sessão e do banco em cada pedido.
