# Produção do painel (decisão 27)

O painel roda no Docker Swarm do projeto PLANEE na Hetzner:

| Servidor | Papel |
|---|---|
| `Manager-01` | líder do Swarm, Traefik (HTTPS), Portainer, n8n |
| `worker-01` | painel (rótulo `planee.papel=painel`) |

Os IPs ficam no console da Hetzner e no projeto do Claude, não neste repositório (ele é público).

Firewall `planee-cluster` nos dois: 22, 80, 443 e ICMP abertos; 2377/tcp, 7946/tcp e 4789–7946/udp só entre os dois servidores.

Não usamos Vercel (removida em 30/09). Antes do PR, cada branch passa pelos testes locais (`testes/painel/rodar.sh`).

## Como uma versão chega ao ar

1. Merge na `main`.
2. O GitHub gera a imagem `ghcr.io/mateushblima/crm_planee` com duas etiquetas: `latest` e a versão curta do commit (ex.: `a1b2c3d`). Workflow: `.github/workflows/imagem.yml`.
3. Em até 5 minutos, o serviço `atualizador` (Shepherd, `deploy/stack-atualizador.yml`) vê a imagem nova e troca as réplicas do painel uma por vez (a nova sobe antes de a velha sair). O webhook de serviço do Portainer seria o caminho natural, mas é recurso pago.
4. Conferir: `https://adm.planeelabia.com/api/saude` responde `{"ok":true,"versao":"<commit>"}`.

## DNS fixo nas stacks (09/10)

Em 08/10, o DNS recursivo da Hetzner (HEL1, FSN1 e NBG1) falhou por horas. O painel, o receptor e o n8n deixaram de achar o Supabase. As stacks `painel` e `receptor` passaram a usar resolvedores públicos (`dns: [1.1.1.1, 8.8.8.8]`), igual ao que já foi feito nos três stacks do n8n.

Mudança na stack não chega pela imagem: no Portainer, abra cada stack (`painel` e `receptor`) → **Editor** → acrescente o bloco `dns:` (igual ao do arquivo em `deploy/`) logo antes de `networks:` → **Update the stack**.

## Espelho da agenda da Feegow (09/10)

O painel lê a agenda da Feegow (só leitura) e grava os agendamentos no CRM da empresa (decisão 33). Para ligar numa empresa:

1. Banco da empresa: migração `018_agenda_espelho.sql` (na clínica, entre `set role painel_app; set search_path = painel;` e `reset role;`).
2. Portainer → stack `painel` → variável `FEEGOW_TOKENS` = `neuro-essentia=<token da API da Feegow>` (mais empresas: separar por vírgula). O token não vai para o banco nem para o repositório.
3. A stack precisa listar `FEEGOW_TOKENS` e `PAINEL_AGENDA` em `environment` (já está em `deploy/stack-painel.yml`; mudança na stack é pelo **Editor** do Portainer, igual ao DNS).
4. Interno → Integrações da empresa: integração `feegow` **ativa**.
5. Conferir: tela Agenda → "Ler a agenda agora" (só o master) mostra quantos agendamentos gravou.

Variáveis opcionais: `PAINEL_AGENDA=0` desliga o espelho; `AGENDA_MINUTOS` (padrão 10) é o intervalo; `AGENDA_CHAMADAS` (padrão 80) é o limite de chamadas à Feegow por rodada; `FEEGOW_API_URL` troca o endereço da API (só testes).

## Link de convite (09/10)

A tela Equipe gera links de convite de uso único (decisão 34). Antes de usar, rode no **banco do painel** (central) a migração `019_convite_link.sql` (idempotente). Sem ela, a tela Equipe abre normalmente, só o botão "Gerar link" dá erro.

## Conexões com o banco da clínica (11/10)

O pooler do Supabase em modo sessão aceita um número limitado de conexões por usuário (era 15; subimos para 30 em 11/10). Em 11/10, às 00:19, o deploy do painel (réplicas novas sobem antes de as velhas saírem) esgotou o limite. O receptor ficou 25 min sem banco: a Sara continuou recebendo, mas a Inbox parou. Desde então, cada réplica usa no máximo 3 conexões por banco (`PAINEL_POOL_MAX` e `RECEPTOR_POOL_MAX`, padrão 3). Se aparecer "max clients reached" nos logs, confira o Pool Size em Database → Settings → Connection pooling.

## Mídias da Inbox (11/10)

O link curto que abre áudio, foto e documento fica no **banco da empresa** (migração `020_midia_links_empresa.sql`), o mesmo em que o receptor grava as mensagens. O endereço é `/whatsapp/midia/<empresa>/<token>`. Antes ficava só no banco central, mas o receptor da clínica usa o banco da clínica como central: o painel gravava num banco e o receptor procurava em outro ("indisponível"). Banco de empresa sem a 020 continua no jeito antigo.

## Cores, avisos por assunto e Registro (11/10)

Decisão 35. Duas migrações, as duas idempotentes, **antes do merge**:
1. Banco da empresa (clínica): `021_assunto_cor.sql` (coluna `crm_topicos.cor`), entre `set role painel_app; set search_path = painel;` e `reset role;`.
2. Banco do painel (central): `022_avisos_por_assunto.sql` (coluna `painel_vinculos.assuntos_aviso`).

Sem elas, o painel continua abrindo: as colunas ficam sem cor, todos recebem aviso de todos os assuntos, e só salvar uma cor ou escolher os avisos dá erro. A tela Registro não precisa de migração (lê as auditorias que já existem).

## Voltar versão

No Portainer, stack `painel` → variável `VERSAO` com a versão curta anterior (lista em GitHub → Packages → crm_planee) → **Update the stack**. Para voltar ao normal, apague `VERSAO` (volta a `latest`).

Se a versão nova não passar na verificação de saúde, o Swarm volta sozinho para a anterior (`failure_action: rollback`).

## Primeira instalação (uma vez)

1. **DNS:** registro `A` de `adm.planeelabia.com` para o IP do `Manager-01` (GoDaddy).
2. **Imagem pública:** depois da primeira execução do workflow, GitHub → Packages → `crm_planee` → Package settings → Change visibility → Public. A imagem não tem nenhuma chave; tudo vem das variáveis da stack.
3. **Banco:** rodar as migrações **001, 003, 004, 005 e 006** (004 e 006 no banco central; 001, 003 e 005 em todo banco de dados de empresa). **Nunca a 002** num banco real: ela é a semente fictícia dos testes. A 004 cria a empresa `teste`; no central de produção, renomeie ou desative depois de cadastrar a empresa real. No teste, central e dados são o mesmo banco.
4. **Stack:** Portainer → Stacks → Add stack → nome `painel` → colar `deploy/stack-painel.yml` → em **Environment variables**, cadastrar `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `PAINEL_CHAVE_CIFRA` (32+ caracteres, gerada uma vez; sem ela, empresa não pode ter banco próprio). `CENTRAL_DATABASE_URL` só quando o banco central for separado → **Deploy the stack**.
   Opcionais: `EMPRESA_BANCO_PADRAO` (padrão `teste`: ids das empresas que podem usar o banco do `DATABASE_URL`; qualquer outra empresa sem banco próprio não abre o CRM) `PAINEL_MFA_MASTER=0` (desliga o segundo fator do master; só para emergência) e `PAINEL_VIGIA=0` (desliga o vigia dos avisos automáticos; com várias réplicas ele pode ficar ligado, cada aviso tem chave própria e não duplica).
5. **Atualização automática:** Portainer → Stacks → Add stack → nome `atualizador` → colar `deploy/stack-atualizador.yml` → **Deploy the stack**. O painel já tem o rótulo `shepherd.enable=true`.
6. **Domínios pelo painel:** no serviço do Traefik (stack do Traefik no Portainer), acrescentar aos argumentos:
   ```
   --providers.http.endpoint=http://painel_painel:3000/api/traefik
   --providers.http.pollInterval=30s
   ```
   O Traefik passa a ler os domínios das empresas no painel; o `adm.planeelabia.com` continua na etiqueta da stack.

## Empresa nova em três passos (28/10)

1. **Supabase:** criar o projeto do cliente e copiar a connection string em **Connect → Session pooler** (usuário `postgres.<ref>`, porta 5432), trocando `[YOUR-PASSWORD]` pela senha do banco. Não use a conexão direta (`db.<ref>.supabase.co`): é só IPv6, e o servidor não alcança.
2. **Painel → Empresas → Nova empresa:** nome, apelido (vira `<apelido>.planeelabia.com`), modelo do CRM (clínica, assistência técnica ou contabilidade), nome do agente, pausa da IA, nome e e-mail do admin e a connection string → **Criar empresa completa**. O painel:
   - no banco do cliente, cria o usuário `painel_app` (senha gerada na hora) e o schema `painel`, dono `painel_app`, e roda as migrações de `supabase/base-empresa.txt` como `painel_app`, numa transação. Nenhuma outra tabela é tocada. É a única exceção à regra "SQL de escrita passa pelo Mateus" (aprovada em 28/10);
   - guarda cifrada só a connection string do `painel_app` (mesmo endereço do pooler, usuário `painel_app.<ref>`). A do `postgres` é usada nesta chamada e não fica em lugar nenhum, nem na auditoria;
   - monta o CRM do modelo pela API (etapas, assuntos, `termo_contato`, `etapas_atendimento`) e o `crm_config` `agente` (`nome`, `pausa_min`, `assumir: false`);
   - cria a chave da API `n8n` (escopos `leitura` e `crm`), mostrada **uma vez**: colar direto na credencial do n8n (`Authorization: Bearer …`, endereço `https://<apelido>.planeelabia.com/api/v1`);
   - no central: a empresa com as permissões do modelo (Inbox e CRM; agendamentos e comprovantes só na clínica), o domínio e o admin, com o código de primeiro acesso (vale 7 dias).
   Se cair no meio, clicar em Criar de novo com o mesmo apelido e o mesmo banco continua de onde parou. Banco que já é de outra empresa, ou com tabelas de fora do painel no schema `painel`, é recusado sem gravar nada.
3. **Conectar número** (na mesma tela, logo depois): `phone_number_id`, WABA, token da Meta e como a IA recebe:
   - **pelo painel** (recomendado): o receptor aponta o número para ele na Meta (override do número) e repassa cada mensagem à IA (webhook informado ou, vazio, o endereço que recebe hoje);
   - **direto da Meta** (como a SSA): nada muda na Meta; o webhook informado vira o `eco_url` (aviso das respostas pela Inbox), e o n8n da IA repassa uma cópia de cada evento ao receptor.

Banco que já existe com as tabelas do agente (como a clínica e a SSA) continua pelo caminho manual: "Criar só o cadastro" e o SQL pelo Mateus, um comando por vez (skill `cadastrar-cliente-painel`). `PAINEL_DOMINIO_EMPRESAS` (padrão `planeelabia.com`) muda o sufixo do endereço.

## Domínio de empresa (decisão 26)

1. **Subdomínio nosso** (`clinica.planeelabia.com`): nada no DNS, o registro curinga `*` já aponta para o `Manager-01`.
   **Domínio do cliente** (`painel.clinica.com.br`): o cliente cria um registro `CNAME` para `adm.planeelabia.com` (ou `A` para o IP do `Manager-01`).
2. Painel → **Empresas** → a empresa → **Adicionar domínio**.
3. Em até 30 segundos o Traefik lê `/api/traefik`, cria a rota e emite o HTTPS.

Nenhum desses passos é commit nem mexe na stack. Empresa desativada sai do Traefik sozinha.

## Empresas, pessoas e permissões (decisão 26)

- **Master** (Planee): `painel_usuarios.master = true`. No `adm` ele entra na **visão geral da Planee** (telas Empresas e Interno), fora de qualquer empresa. Para ver o CRM, a inbox e o resto de um cliente, escolhe a empresa no seletor **Ver empresa**; uma faixa no topo mostra em qual empresa ele está, com o botão **Sair da empresa**. Tela **Empresas**: criar empresa, módulos liberados, domínios, admins, banco próprio.
- **Admin**: tela **Equipe** da empresa. Adiciona membros com os modelos Secretária/Gestor ou permissão a permissão, sempre dentro dos módulos da empresa.
- **Primeiro acesso**: o e-mail cadastrado cria a senha em `/entrar/primeiro-acesso`. Deixar ligado "Confirm email" no Supabase Auth, para ninguém criar a senha de um e-mail que não é dele.

## Rede e Traefik

O Traefik do manager é a versão 3, com o provedor `swarm`: rede `network_public`, entrypoint `websecure` (o `web` redireciona para ele) e resolvedor de certificado `letsencryptresolver` (desafio HTTP). A stack usa esses nomes, conferidos em 30/09. As rotas de domínio de empresa usam o serviço `painel@swarm`; se algum nome mudar, as variáveis `TRAEFIK_SERVICO`, `TRAEFIK_ENTRYPOINT` e `TRAEFIK_CERTRESOLVER` da stack ajustam `/api/traefik`.


## Segundo fator do master (auditoria 01/10)

A conta da Planee (master) entra com senha **e** o código de um aplicativo autenticador (Google Authenticator,
Microsoft Authenticator, 1Password). Na primeira entrada depois da atualização, o painel mostra um QR para cadastrar.
Usa o MFA do próprio Supabase Auth (TOTP, ligado por padrão nos projetos do Supabase).

**Perdeu o celular:** no Supabase do painel → SQL Editor, apague o fator e entre de novo (o QR aparece outra vez):

```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'SEU_EMAIL');
```

Em último caso, `PAINEL_MFA_MASTER=0` na stack desliga a exigência até o fator ser cadastrado de novo.

## Primeiro acesso por código (auditoria 01/10)

Quem cadastra uma pessoa (a Planee em Empresas, o admin em Equipe) recebe na hora um **código de primeiro acesso**
(8 letras e números, vale 7 dias) para enviar a ela. Sem o código, ninguém cria a senha de um e-mail cadastrado.
Perdeu ou venceu: botão **Novo código** na Equipe.

## Protocolos é recurso da empresa (29/10)

O acompanhamento de protocolo (tela Protocolos, bloco no cartão do CRM e na ficha do contato, item "Protocolo" no menu da conversa) só aparece na empresa que tem **Acompanhamento de protocolo** marcado na tela Empresas. Quem tem "Ver o CRM" nessa empresa ganha junto; não é marcado pessoa por pessoa na Equipe. O master também só vê onde a empresa tem.

Antes do merge, no **banco do painel** (central), para a clínica não ficar sem a tela nem por um minuto:

```sql
update empresas set modulos = array(select distinct unnest(modulos || array['protocolos.ver'])) where id = 'neuro-essentia';
select id, modulos from empresas where id in ('neuro-essentia', 'ssa');
```

A versão de antes ignora a chave nova, então rodar antes do merge não muda nada até a versão nova entrar.
