# PLANO — Painel Planee

Ordem de execução. Cada tarefa tem critério de pronto. Marque `[x]` ao concluir e registre como foi verificado.

As fases 0 e 1 não tocam o agente em produção. A fase 2 é a única que muda a produção, e só depois de validada no ambiente de teste.

**Como o código vai ao ar (decisão 27):** cada tarefa numa branch. A Vercel grátis publica a branch num link de teste, ligado ao Supabase de teste. O merge na `main` gera a imagem Docker no GitHub; o Portainer atualiza a stack do painel no Swarm da Hetzner, e voltar versão é trocar a versão da imagem no Portainer (`docs/producao.md`). Cliente novo não é commit: é empresa cadastrada na tela do master, registro de DNS e domínio acrescentado na stack (decisão 26).

---

## Fase 0 — Fundação

- [x] **0.1 Ler o banco real.** Gerar os `SELECT` em `information_schema.columns` para o schema `teste` (todas as tabelas) e para `public.mensagens_gemini_cliente`, `public.usuarios_cliente`, `public.log_agendamentos`, `public.log_requisicoes`, `public.notificacoes`. O Mateus roda e cola o resultado. Salvar em `supabase/esquema_atual.md`.
  *Pronto quando:* o arquivo lista cada tabela com suas colunas e tipos.
  *Feito em 26/09:* 28 tabelas (5 do `public`, 23 do `teste`) lidas do `information_schema` pela sessão da Sara (só leitura), com colunas, tipos, não nulo, padrão e chaves, mais observações para a 0.3.
- [x] **0.2 Esqueleto do app.** Next.js + TypeScript, `design/tokens.css` global, fontes Geist, tema claro/escuro com alternância salva no navegador, cliente Supabase lendo as variáveis do deploy. O modo (`cliente` ou `adm`) e o nome do cliente vêm das variáveis do projeto na Vercel (decisão 21). Publicado na Vercel, no endereço grátis `.vercel.app` (decisão 20).
  *Pronto quando:* `npm run dev` abre uma página com a barra lateral do protótipo nos dois temas.
  *Feito:* no ar em https://crm-planee-topaz.vercel.app (conferido em 26/09: telas do modo cliente, alternância de tema, aviso de Supabase não configurado). Revisto em 26/09 para o modo vir da variável `PAINEL_MODO`, sem escolha de banco pelo endereço.
- [ ] **0.2b Supabase de teste (decisão 23).** Projeto Supabase separado, só para o painel, com a estrutura do schema `teste` recriada a partir de `supabase/esquema_atual.md` e dados fictícios. O deploy `crm-planee-topaz` passa a apontar para ele (variáveis na Vercel).
  *Pronto quando:* o deploy mostra "Supabase conectado" e nenhum dado real existe nesse projeto.
  *Parcial em 27/09:* Supabase `dyembftoneilewjnqxsk` criado com as tabelas do CRM (migrações 001 e 002). Falta recriar a estrutura do schema `teste` e trocar as `NEXT_PUBLIC_SUPABASE_*` na Vercel (apagar e recriar como Config).
- [x] **0.2c API do CRM e conector MCP (decisão 25).** `/api/v1` (REST) e `/api/mcp` (conector do Claude) sobre as tabelas de `supabase/migrations/001_crm_api.sql`, com chaves por integração e auditoria. Semente fictícia em `002_semente_ficticia.sql`. Documentação em `docs/api.md`.
  *Pronto quando:* com a migração rodada e `DATABASE_URL` no deploy, um chat do Claude conectado cria uma etapa e move um atendimento, e as duas ações aparecem em `painel_auditoria`.
  *Feito em 26/09:* testado em Postgres local: criar, editar, arquivar, filtros, config, escopos, erros e auditoria pela REST e pelo MCP (initialize, tools/list, tools/call). No ar em 27/09: migrações 001 e 002 rodadas no Supabase de teste `dyembftoneilewjnqxsk`, conector testado em produção, 7 etapas lidas e as escritas registradas em `painel_auditoria`.
- [x] **0.2d Sara → CRM (teste).** Ao transferir, os workflows da pasta `AMBIENTE DE TESTE — Sara` criam o contato (busca por telefone no formato `tel_chave`; cria se não existir; 409 refaz a busca) e o atendimento pela API (`aberto_por: IA`, assunto mapeado a partir do motivo). Atendimento aberto no mesmo assunto recebe nota em vez de cartão novo. Falha da API não afeta a transferência (regra 8). Workflow `[TESTE] CRM: abre atendimento`; credencial n8n `CRM Planee — n8n-sara-teste` (chave `n8n-sara-teste`, escopos leitura e crm).
  *Pronto quando:* uma transferência pelo número de teste aparece no quadro de atendimento, uma cobrança no mesmo assunto vira nota, e com a API fora do ar a transferência continua normal.
  *Feito em 29/09:* 5 testes pelo número de teste passaram (receita vira cartão; cobrança vira nota; outro assunto usa o mesmo contato; API fora não afeta a transferência; telefone com e sem o 9 não duplica contato), mais 409 e 2ª falha da Sara. Detalhes em `claude/sara_crm_teste_29-09.md` no projeto do Claude.
- [ ] **0.3 Modelo padrão (decisão 22).** Comparar `supabase/esquema_atual.md` com `docs/especificacao.md` (seções 6 e 10) e `docs/decisoes.md`. Escrever em `supabase/modelo.md` o conjunto de tabelas que **todo** cliente terá, com nomes e colunas fixos. Para cada tabela, dizer de onde vem no Dr. Amilton e na SSA: tabela existente, view sobre tabela existente ou tabela nova. Incluir documento CPF ou CNPJ e nome do contato configurável (decisão 13).
  *Pronto quando:* o Mateus aprovar `supabase/modelo.md`.
- [ ] **0.4 Migrações.** Uma migração por arquivo em `supabase/migrations/`, rodada primeiro no Supabase de teste, na ordem:
  1. `atendimentos` (com `topico`, `aberto_por`, marcas de tempo) e `atendimento_vistas`
  2. `crm_etapas`, `crm_topicos`, `crm_config`
  3. `painel_usuarios`, `painel_auditoria`
  4. `contatos_equipe`, `contato_etiquetas`, `contato_notas`
  5. colunas de `conversa_estado` que faltarem (dono, não lidas, marcada não lida, `ia_desligada`)
  6. views do modelo padrão onde o cliente já tem tabela equivalente (arquivo separado por cliente em `supabase/clientes/<apelido>/`)
  *Pronto quando:* cada migração rodou (pelo Mateus) no Supabase de teste e o `SELECT` de conferência bateu.
- [ ] **0.5 Gatilhos e funções.** Gatilho de mensagem nova atualiza última mensagem e não lidas; gatilho de `atendimentos` recalcula o dono da conversa; funções `assumir_conversa`, `mover_atendimento`, `marcar_nao_lida`, `registrar_vista`, cada uma gravando quem e quando.
  *Pronto quando:* um teste em SQL mostra o dono mudando de `aguardando` para `humano` e de volta para `ia`.
- [ ] **0.6 RLS e login.** Supabase Auth; RLS por papel lido de `painel_usuarios` (`secretaria`, `gestor`, `planee`); um usuário de cada papel para teste. Papel `planee` com segundo fator (MFA) obrigatório e registro de cada conversa aberta (decisão 24).
  *Pronto quando:* a secretária não consegue ler a tela interna nem por URL direta.
  *Parcial em 29/09:* login pelo Supabase Auth, papéis de `painel_usuarios` conferidos no servidor de cada tela, CPF mascarado para `planee`. O resto (MFA, níveis e permissões) passa para a 0.8.
- [ ] **0.7 Semente do CRM.** Preencher `crm_etapas` e `crm_topicos` com o modelo Clínica (valores no protótipo, função `modelos()`).
- [ ] **0.8 Banco central e permissões (decisão 26).** Tabelas centrais (empresas, domínios, usuários, permissões, auditoria), empresa escolhida pelo endereço e conferida no servidor a cada pedido, banco de cada empresa com endereço cifrado. Tela do master: empresas, domínios, módulos liberados, admins. Tela do admin: membros e permissões, com os modelos "secretária" e "gestor". MFA obrigatório para o master.
  *Pronto quando:* no link de teste, um membro de uma empresa fictícia não vê nada de outra empresa nem por URL direta nem pela API, e o admin só consegue dar permissões que o master liberou.
- [ ] **0.9 Produção no Swarm (decisão 27).** Imagem Docker gerada a cada merge na `main`, stack do painel no Portainer (`deploy/stack-painel.yml`) no `worker-01` com duas réplicas, Traefik com HTTPS em `adm.planeelabia.com`.
  *Pronto quando:* `https://adm.planeelabia.com` abre o login, `/api/saude` responde e uma troca de versão no Portainer sobe e volta sem derrubar o painel.

## Fase 1 — Leitura (nada escreve)

- [ ] **1.1 Inbox somente leitura, em tempo real.** Lista com as quatro abas, busca, conversa com bolhas por autor, ficha lateral. Realtime para mensagens novas, escutando só a conversa aberta e a lista.
- [x] **1.2 CRM somente leitura.** Quadro de atendimento por assunto, funil comercial, contatos, lidos das tabelas.
  *Feito em 29/09:* quadro, comercial e contatos lidos pela mesma camada da API (PR #5), com teste de ponta a ponta.
- [ ] **1.3 Resultados da clínica.** Consultas marcadas pela IA, conversas por dia, espera pela equipe. Consultas prontas em `docs/relatorio.md`, seção 9.
- [ ] ~~**1.4 Central Planee (decisão 24).**~~ *Substituída pela 0.8 (decisão 26); custo, falhas e alertas de todos entram na tela do master.*
  *Pronto quando (fase):* o Dr. Amilton abre os resultados sozinho e a Planee acompanha conversas sem abrir o Supabase.

## Fase 2 — Atendimento (toca o agente, primeiro no ambiente de teste)

- [ ] 2.0 Os workflows de teste da Sara passam a gravar no Supabase de teste (só a credencial dos workflows da pasta `AMBIENTE DE TESTE — Sara`).
- [ ] 2.1 Botões Assumir, Pendente interno, Retomar, Finalizar chamando as funções da 0.5.
- [ ] 2.2 Marcar como não lida; vistos registrados ao abrir.
- [ ] 2.3 Webhook `painel_enviar` no n8n de teste: valida janela de 24h, envia, grava a mensagem `[EQUIPE]` com `enviado_por`.
- [ ] 2.4 Webhook `painel_retomar`: devolve a conversa à IA quando o cartão sai de "em atendimento" e a última mensagem é do paciente.
- [ ] 2.5 Agente de teste lê o dono da conversa no Postgres, no lugar do bloqueio de 7 minutos no Redis.
- [ ] 2.6 `notificar_equipe` abre a solicitação com assunto e devolve erro de verdade quando descarta a chamada.
- [ ] 2.7 Teto de 60 minutos em modo restrito.
- [ ] 2.8 Notificações no painel (alerta sonoro e Web Push).
  *Pronto quando:* a Amanda atende um dia inteiro só pelo painel, no número de teste.
- [ ] 2.9 Entrada em produção do Dr. Amilton: migrações e views no banco dele, empresa cadastrada na tela do master com o banco dele, domínio `painel.amilton.planeelabia.com` (nome a confirmar) apontando para o `Manager-01` (decisões 26 e 27).

## Fase 3 — CRM completo e configurável

- [ ] 3.1 Tela de configuração do CRM gravando em `crm_etapas`, `crm_topicos`, `crm_config`, com os três modelos de partida.
- [ ] 3.2 Robô do CRM e `notificar_equipe` lendo gatilhos e palavras dessas tabelas.
- [ ] 3.3 Etiquetas, notas, vincular paciente ao telefone.

## Fase 4 — Configuração do agente

- [ ] 4.1 Versões de prompt, publicar com recriação do cache, reverter.
- [ ] 4.2 Parâmetros de negócio editáveis pelo gestor (`teste.negocio`).

## Fase 5 — Segundo cliente

- [ ] 5.1 SSA: empresa cadastrada na tela do master, views do modelo padrão sobre `crm_estado`, `clientes_conhecidos` e `clientes_legado` no banco dela, endereço `painel.ssa.planeelabia.com`. Nenhum commit.
