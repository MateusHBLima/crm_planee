# Receptor do WhatsApp — implantação e teste

O receptor (`servicos/receptor`, decisão 28) é o endereço de webhook da Meta. Ele é código puro em Node, sem n8n, e faz quatro coisas:

1. **Guarda** cada evento bruto no banco central (`wa_eventos`) antes de qualquer outra coisa. Se o banco não responder em 2,5 s, grava num arquivo local (spool) e manda para o banco quando ele voltar.
2. **Repassa** para a Sara (n8n) o mesmo corpo, byte a byte, com a assinatura original. Para o n8n nada muda. Se o n8n cair, tenta de novo por até 1 hora.
3. **Espelha** no banco da empresa:
   - contatos (`wa_contatos`), conversas (`wa_conversas`), mensagens (`wa_mensagens`) e reações (`wa_reacoes`);
   - status, edições, mensagens apagadas, histórico da conexão e agenda do celular.
4. **Baixa as mídias** para o Storage do Supabase. A Meta apaga as mídias depois de alguns dias.

Se o painel cair, o receptor continua. Se o receptor cair, a Meta reenvia por até 7 dias.

## O que chega e de onde

| Campo da Meta | O que é | Vai para a Sara? |
|---|---|---|
| `messages` | Mensagem do paciente (todos os tipos, reação incluída) e status das mensagens enviadas (enviada, entregue, lida, falhou) | sim |
| `smb_message_echoes` | O que a equipe manda pelo celular: texto e mídia, mais edição e apagar | sim (já ia hoje) |
| `history` | Até 180 dias de conversas, só uma vez, quando o número é conectado. Não traz grupos | **não**: fica só no painel |
| `smb_app_state_sync` | Agenda do celular: contato adicionado, editado ou removido | **não** |

O que vai para a Sara se ajusta em `REPASSAR_CAMPOS`. O padrão é `messages,smb_message_echoes`: o histórico nunca pode virar milhares de atendimentos.

A coexistência não manda grupos, mensagens temporárias, visualização única nem localização ao vivo. Visualização única e enquete chegam como `unsupported` e aparecem como "tipo não suportado".

## 1. Migrações (Supabase de teste, SQL Editor)

No teste, o banco central e o banco da empresa são o mesmo Supabase (`dyembftoneilewjnqxsk`). Rode, nesta ordem:

1. `supabase/migrations/007_whatsapp_central.sql`
2. `supabase/migrations/008_whatsapp_dados.sql`

Confira (tem que voltar 6 linhas):

```sql
select table_name from information_schema.tables
 where table_name in ('whatsapp_numeros','wa_eventos','wa_contatos','wa_conversas','wa_mensagens','wa_reacoes');
```

Em produção, a 007 vai no banco central e a 008 no banco de cada empresa que tiver WhatsApp.

## 2. Storage

Supabase → **Storage → New bucket**. Nome `whatsapp`, **privado** (Public desligado). Confira se aparece na lista com o cadeado.

## 3. Stack `receptor` no Portainer

**Stacks → Add stack → nome `receptor`** → Web editor: cole `deploy/stack-receptor.yml`. Em **Environment variables**:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a mesma da stack do painel |
| `PAINEL_CHAVE_CIFRA` | a mesma da stack do painel (decifra o banco de cada empresa) |
| `EMPRESA_BANCO_PADRAO` | `teste` (a mesma do painel) |
| `META_APP_SECRET` | App Dashboard → **App settings → Basic → App secret**. Se os números chegam por mais de um app da Meta, coloque os segredos separados por vírgula |
| `META_VERIFY_TOKEN` | um texto aleatório criado por você (ex.: `openssl rand -hex 16`). Ele é usado no passo 5 |
| `META_TOKEN` | o token do sistema da Meta que já envia pelo número (baixa as mídias) |
| `RECEPTOR_CHAVE_INTERNA` | outro texto aleatório. A Sara usa para registrar o que mandou (passo 8) |
| `ENCAMINHAR_PADRAO` | deixe vazio. O destino de cada número fica no cadastro (passo 4) |
| `SUPABASE_URL` | `https://dyembftoneilewjnqxsk.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Project settings → API → `service_role` |

**Deploy the stack.** Em 1 ou 2 minutos, confira:

- `https://adm.planeelabia.com/whatsapp/vivo` → `{"ok":true}`
- `https://adm.planeelabia.com/whatsapp/saude` → `"ok":true` e `"pendentes":0`
- `https://adm.planeelabia.com/api/saude` → o painel continua respondendo (a rota `/whatsapp` não pegou o resto)

## 4. Cadastrar o número de teste

Antes, anote para onde o número manda hoje. No Graph API Explorer (ou com curl), com o token da Meta:

```
GET https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>?fields=webhook_configuration
```

O valor em `phone_number` é o destino atual (o n8n). **Guarde esse endereço**: ele vira `encaminhar_url` e é o caminho de volta.

SQL Editor (troque os dois valores entre `<>`):

```sql
insert into whatsapp_numeros (phone_number_id, empresa_id, nome, telefone, encaminhar_url)
values ('<PHONE_NUMBER_ID>', 'teste', 'Número de teste', '<55DDDNUMERO>', '<DESTINO_ATUAL_ANOTADO>')
on conflict (phone_number_id) do update set encaminhar_url = excluded.encaminhar_url, ativo = true;
```

Confira:

```sql
select phone_number_id, empresa_id, encaminhar_url, ativo from whatsapp_numeros;
```

`empresa_id` precisa existir em `empresas` (`select id, nome from empresas;`).

## 5. Apontar o número para o receptor (override por número)

```
POST https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>
{ "webhook_configuration": { "override_callback_uri": "https://adm.planeelabia.com/whatsapp/webhook",
                             "verify_token": "<META_VERIFY_TOKEN>" } }
```

A Meta testa o endereço na hora (GET com o verify token). Se responder `{"success":true}`, está ligado. Confira com o GET do passo 4: `phone_number` agora mostra o receptor.

**Voltar atrás:** o mesmo POST com o endereço anotado no passo 4. **Nunca** mande `override_callback_uri` vazio. Isso faz o número cair no endereço geral do app (`webhook/meta`), que hoje ninguém escuta, e as mensagens se perdem.

Só o número que recebeu o override passa pelo receptor. O do Dr. Amilton continua como está até a troca dele.

## 6. Checklist de teste (número de teste, com um celular de fora)

Para conferir cada linha, use `select tipo, direcao, origem, texto, status, editada_em, apagada_em from wa_mensagens order by id desc limit 10;` (e `wa_reacoes` para reações).

| # | Faça | Tem que aparecer |
|---|---|---|
| 1 | Mande "oi" do celular de fora | linha `entrada / contato / text`. A Sara responde como antes |
| 2 | Foto, áudio, PDF, figurinha, vídeo | um tipo para cada. `midia->>'caminho'` preenchido em até 1 min |
| 3 | Reaja com 👍 a uma resposta | `wa_reacoes` com o emoji |
| 4 | Troque para ❤️ e depois tire a reação | o emoji troca, depois a linha some |
| 5 | Responda citando uma mensagem | `resposta_a` com o wamid citado |
| 6 | Pelo celular da clínica (app Business), responda | `saida / celular`, e `nao_lidas` da conversa zera |
| 7 | Edite essa resposta no celular da clínica | `editada_em` preenchido, texto novo, o antigo em `versoes` |
| 8 | Apague para todos | `apagada_em` preenchido |
| 9 | Resposta da Sara | `saida / api`, com o status passando de enviada a entregue a lida |
| 10 | Enquete e visualização única | `unsupported`, sem erro |
| 11 | Contato com localização e contato compartilhado | `location` / `contacts` com os dados |
| 12 | `/whatsapp/saude` | `pendentes` 0, `repasses_pendentes` 0, `desistidos` 0 |

Teste de queda: no Portainer, ponha o n8n de teste fora (ou mude `encaminhar_url` para um endereço errado) e mande uma mensagem. O receptor responde 200, `repasses_pendentes` sobe e, quando o n8n volta, cai a zero.

**Histórico e agenda** só chegam quando um número é conectado (ou reconectado) e com os campos `history` e `smb_app_state_sync` assinados no app (App Dashboard → WhatsApp → Configuration → Webhook fields). A assinatura vale para o app inteiro. Antes de ligar, confira se o buffer do Dr. Amilton ignora esses dois campos. O teste do histórico fica para a conexão de um número novo.

## 7. Monitor

Coloque `https://adm.planeelabia.com/whatsapp/saude` num monitor externo (UptimeRobot ou similar), com alerta se:

- a resposta não for 200;
- `atraso_s` passar de 300;
- `desistidos` passar de 0.

A página só mostra contagens, sem dado de paciente.

## 8. A Sara registra o que mandou

A Meta devolve só o status das mensagens que a Sara manda pela API, não o conteúdo. Depois de cada envio (nó HTTP da Graph API), o n8n faz:

```
POST https://adm.planeelabia.com/whatsapp/envio
x-receptor-chave: <RECEPTOR_CHAVE_INTERNA>   (credencial Header Auth no n8n, nunca no nó)
{ "phone_number_id": "...", "to": "55...", "wamid": "<messages[0].id da resposta da Meta>",
  "tipo": "text", "texto": "...", "timestamp": <segundos> }
```

Sem isso, a mensagem da Sara aparece com o status certo, mas com tipo `desconhecido` e sem texto.

## 9. Inbox do painel (somente leitura)

A tela Inbox lê o espelho (`wa_contatos`, `wa_conversas`, `wa_mensagens`, `wa_reacoes`) no banco da empresa, por `lib/painel/inbox.ts`, e atualiza a cada 10 s. Não fala com a Meta e não envia nada.

- Abrir a conversa zera `nao_lidas` e grava `lida_ate`. O master (Planee) só olha: não mexe nas não lidas, vê o CPF mascarado e cada conversa aberta vai para `central_auditoria` (`abrir_conversa`, alvo `numero_id:4 últimos dígitos`, uma linha a cada 30 min por pessoa e conversa).
- Para o navegador vão só o tipo, o `mime_type` e o nome do arquivo da mídia. `midia.caminho`, `bruto` e `erro` ficam no servidor.
- Falta: abrir a mídia (link assinado) e o texto das mensagens da Sara (item 8). A resposta pelo painel está no item 10.

## 10. Responder pelo painel

Quem tem a permissão **Responder pelo painel** (`inbox.responder`; a Planee libera para a empresa na tela Empresas, o admin dá às pessoas) vê a caixa de resposta na Inbox. O painel não fala com a Meta e não grava a mensagem: chama o webhook do n8n, e o n8n envia e avisa o receptor, que grava no espelho.

O painel só chama o webhook dentro da janela de 24 h (`wa_conversas.ultima_entrada_em` nas últimas 24 h). Fora dela, ou se o contato nunca escreveu, recusa: a Meta só aceita modelo aprovado. Cada tentativa vai para `central_auditoria` (`enviar_mensagem`, alvo `numero_id:4 últimos dígitos`, `detalhe.resultado` = `enviada`, `falhou` ou `sem_resposta`), sem o texto.

**Pedido do painel ao n8n** (variáveis do painel: `N8N_WEBHOOK_PAINEL_ENVIAR` com o endereço do webhook e `N8N_WEBHOOK_SEGREDO`; sem o endereço, a tela diz "Envio pelo painel ainda não configurado."):

```
POST <N8N_WEBHOOK_PAINEL_ENVIAR>
content-type: application/json
x-painel-segredo: <N8N_WEBHOOK_SEGREDO>
{ "evento": "painel_enviar", "empresa": "<id da empresa>", "numero_id": "<phone_number_id>",
  "para": "<wa_id do contato, só dígitos>", "texto": "<1 a 4.096 caracteres>",
  "por": "<nome de quem mandou>", "usuario_id": "<uuid da pessoa no painel>" }
```

O painel espera até 15 s. **O workflow do n8n deve:**

1. conferir `x-painel-segredo` (diferente → responder `{ "ok": false, "erro": "segredo" }` e parar);
2. enviar pela Graph API: `POST /{numero_id}/messages` com `{ "messaging_product": "whatsapp", "to": "<para>", "type": "text", "text": { "body": "<texto>" } }`;
3. registrar no receptor (credencial Header Auth, nunca no nó):
   ```
   POST https://adm.planeelabia.com/whatsapp/envio
   x-receptor-chave: <RECEPTOR_CHAVE_INTERNA>
   { "phone_number_id": "<numero_id>", "to": "<para>", "wamid": "<messages[0].id da resposta da Meta>",
     "tipo": "text", "texto": "<texto>", "timestamp": <segundos>, "origem": "painel", "por": "<por>" }
   ```
   O receptor grava com origem `painel` (a Inbox mostra "Painel · <por>"); se o status da Meta chegou antes, a linha é corrigida;
4. responder `{ "ok": true, "wamid": "<o mesmo wamid>" }`. Se a Meta recusar: `{ "ok": false, "erro": "<código Meta>" }`.

Qualquer outra resposta (erro HTTP, JSON diferente, mais de 15 s) aparece na tela como falha curta, sem repassar o corpo. Até o espelho trazer o `wamid`, a tela mostra a bolha "enviando…".

## Retenção (LGPD)

O corpo bruto em `wa_eventos` é apagado `WA_RETER_DIAS` (padrão 30) dias depois de processado e repassado. O que fica é o espelho no banco da empresa, sujeito às regras dela. As mídias ficam no bucket privado. O painel vai abri-las por link assinado e temporário (PR 2 da Inbox).

## Quando der errado

| Sintoma | Onde olhar |
|---|---|
| A Meta não aceita o override | `META_VERIFY_TOKEN` diferente do enviado, ou `/whatsapp/vivo` fora |
| "assinatura inválida" nos logs do receptor | falta em `META_APP_SECRET` o segredo do app que entrega o número. O app que entrega é o do token usado no override |
| `pendentes` subindo com erro "não cadastrado" | número sem linha em `whatsapp_numeros`. O evento espera o cadastro e entra sozinho |
| A Sara parou de responder | `encaminhar_url` do número. Volte o override (passo 5) e confira `repasse_erro` em `wa_eventos` |
| Mídia sem `caminho` | `META_TOKEN`, `SUPABASE_SERVICE_KEY` ou o bucket |
