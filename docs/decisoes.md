# Decisões — Painel Planee

Decisões fechadas pelo Mateus. Não reabrir sem ele. Onde a especificação divergir, estas valem.

## 17/09/2026

1. **App próprio sobre Supabase.** Não Chatwoot, não Twenty, não ClickUp para atendimento.
2. **A secretária atende só pelo painel.** Lido, não lido e finalizado viram campos nossos. A coexistência com o app WhatsApp Business continua ligada como reserva.
3. **Multi-cliente desde o início.** Um app, um Supabase por cliente, o subdomínio decide o banco.
4. **Dois funis de CRM, ligados por telefone e CPF.**
   - Comercial: cartão = oportunidade. Só a IA move.
   - Atendimento: cartão = solicitação. Etapas do sistema: aguardando equipe → em atendimento → pendente interno → finalizado. A IA abre; a secretária muda a etapa.
   - Telefone liga o cartão à conversa (obrigatório). CPF liga à pessoa: `pacientes` + `pacientes_telefone` (N:N; mãe agenda para filho).
   - Solicitação comercial (desconto, Pix) aponta para a oportunidade.
5. **A conversa volta para a IA quando o cartão sai de "em atendimento"** (para pendente interno ou finalizado). No assunto pendente a IA segue calada (regra 14 do prompt).
6. **No quadro de atendimento as colunas são assuntos, não etapas.** A etapa vira etiqueta no cartão.
7. **O cartão mostra aberto por, visto por (cada pessoa), responsável e finalizado, com data e hora.** Tabela `atendimento_vistas`.

## 24/09/2026

8. **O painel é a tela da secretária; o ClickUp sai do plano de atendimento.** O painel usa as tabelas que já existem no schema `teste` (`conversa_estado`, `crm_eventos`, `crm_fatos`, `pacientes`, `pacientes_telefone`) e o robô do CRM. Esses nomes substituem os propostos na especificação onde coincidem.
9. **O CRM é configurável por projeto.** Tabelas por cliente: `crm_etapas` (ordem, nome, tipo aberta/ganho/perdido, gatilho), `crm_topicos` (ordem, nome, ícone, palavras), `crm_config` (nomes das 4 etapas de atendimento, campos do cartão, modelo). Modelos de partida: Clínica, Assistência técnica, Contabilidade. O robô do CRM e o `notificar_equipe` leem gatilhos e palavras dessas tabelas.
10. **Protótipo definitivo primeiro, código depois.** Next.js sobre Supabase, schema `teste`.
11. **Sistema visual:** cor só para estado, assuntos e etapas sem cor. Detalhe em `design/sistema-visual.md`.

## 24/09/2026 — cadastro da SSA

12. **O endereço decide o cliente.** Um app só na Vercel (plano Pro, uso comercial). O domínio acessado escolhe o Supabase do cliente; as chaves de cada cliente ficam em variáveis de ambiente. Padrão: subdomínio da Planee, `painel.<cliente>.planeelabia.com`, cadastrado um a um (sem curinga). Cliente que quiser domínio próprio aponta um CNAME para a Vercel. Cada endereço entra nas URLs de redirecionamento do Auth do Supabase daquele cliente. SSA: `painel.ssa.planeelabia.com`. O esqueleto do app (tarefa 0.2) já nasce lendo o domínio. *Substituída pela 21 em 26/09 (vale só a parte dos endereços e do CNAME).*
13. **Contato pode ser empresa.** A ligação entre os funis aceita CPF ou CNPJ, e o nome do contato é configurável ("paciente" ou "cliente"). Resolver no mapeamento (tarefa 0.3).
14. **Solicitação aberta recebe a mensagem.** Mensagem do mesmo contato (ou da mesma empresa já identificada) e do mesmo assunto entra na solicitação aberta, que volta como não lida; não abre cartão novo. Assunto diferente abre cartão novo. Não existe assunto "Acompanhamento".
15. **Cliente com contrato não vira oportunidade.** Pedido de quem já tem contrato (na SSA, locação) é atendimento e não entra no funil comercial.
16. **Gatilho automático só com sinal explícito.** Etapa cujo evento a automação não registra de forma estruturada fica "Manual (equipe)". Na SSA: orçamento enviado; aprovado, até existir o sinal de pedido confirmado (entra na tarefa 3.2, registrado pelo painel, não pelo card do Trello); follow up e recusado, até o follow-up ser ligado.
17. **O painel reaproveita o que o banco do cliente já tem.** Banco da SSA, conferido em 24/09: *Completada pela 22 em 26/09: o reaproveitamento é feito por views no banco do cliente.*
    - Logs que existem: `n8n_workflow_logs`, `notificacoes`, `followup_log`, `gemini_custos_config`. Faltam: `log_requisicoes`, `log_agendamentos`, `precos_modelo`, `cotacao_usd`. A tela Interno Planee da SSA depende disso; ver se `gemini_custos_config` cobre `precos_modelo` antes de criar tabela.
    - `crm_estado` (estado por conversa) equivale a `conversa_estado`. `clientes_conhecidos` (ficha por telefone, com empresa e CNPJ) e `clientes_legado` são reaproveitadas.
    - `profiles` + `user_roles` (papéis `admin` e `staff`, vazias) ficam como estão. O painel usa `painel_usuarios`.
    - `pacientes_telefone` existe vazia (sobra do modelo da clínica).
    - RLS ligado nas tabelas com dado de cliente. O n8n entra pelo pooler como `postgres`, que ignora o RLS; ligar RLS não afeta a automação.
18. **Com a SSA no painel, o Trello sai.** O quadro de atendimento do painel substitui o Trello. Até lá, o Trello segue sozinho; nada roda nos dois ao mesmo tempo.

## 25/09/2026

19. **A Planee entra por um endereço só: `adm.planeelabia.com`.** Mesmo app, modo Planee: lista de clientes, painel interno com todos os clientes e acesso à inbox, ao CRM e às configurações de qualquer um. Um Supabase pequeno da Planee guarda a lista de clientes e o login da equipe Planee; as chaves de cada cliente ficam só no servidor. O papel `planee` sai dos painéis dos clientes, que ficam com `secretaria` e `gestor`. No `adm`, segundo fator (MFA) obrigatório; cada conversa aberta fica registrada e o CPF aparece mascarado por padrão, com registro quando alguém vê inteiro (LGPD). *Substituída pela 24 em 26/09.*
20. **Hospedagem: Vercel por enquanto, no endereço grátis `.vercel.app`.** Sem domínio próprio e sem cliente real até a entrada em produção. Antes disso, rever a hospedagem: Vercel Pro (US$ 20/mês, cobre todos os clientes), Netlify ou Cloudflare (exige passar o DNS do `planeelabia.com` para o Cloudflare). Os endereços `adm` e `painel.<cliente>` viram registros CNAME na GoDaddy só nessa hora.

## 26/09/2026 — revisão da arquitetura

21. **Um deploy por cliente.** Cada cliente tem o seu projeto na Vercel, todos saindo do mesmo repositório e da mesma `main`, cada um com as próprias variáveis (Supabase dele, `PAINEL_MODO`, nome) e o próprio endereço (`painel.<cliente>.planeelabia.com`). O app não escolhe banco pelo endereço: um erro de roteamento não pode mostrar pacientes de outra clínica. Volta de versão é por cliente, na Vercel. Cliente novo é projeto novo na Vercel, variáveis, CNAME e semente, sem commit. **Nada específico de cliente no código:** diferença entre clientes é configuração no banco dele. Com o plano Pro, os vários projetos não mudam o custo.
22. **Mesmo formato de tabelas em todo cliente.** O painel lê e grava um conjunto padrão de tabelas, definido em `supabase/modelo.md`. Onde o banco do cliente já tem uma tabela equivalente (ex.: `crm_estado` na SSA, `conversa_estado` no Dr. Amilton), a adaptação é uma view no banco dele com o nome padrão. O código enxerga sempre os mesmos nomes.
23. **Supabase só para teste.** O painel é desenvolvido num projeto Supabase separado, com dados fictícios. Migrações rodam ali primeiro, e o teste de carga também. O schema `teste` do banco de produção do Dr. Amilton continua sendo o ambiente de teste da Sara, não do painel. Na fase 2, os workflows de teste da Sara passam a gravar no Supabase de teste.
24. **Central Planee em `adm.planeelabia.com`.** Projeto próprio na Vercel (`PAINEL_MODO=adm`) com um Supabase da Planee: lista de clientes, custo, falhas e alertas de todos, e o link para o painel de cada cliente. A equipe Planee entra no painel de cada cliente com o papel `planee` (usuário criado no cadastro), segundo fator (MFA) obrigatório e cada conversa aberta registrada; CPF mascarado por padrão, com registro quando alguém vê inteiro (LGPD).

## Em aberto

- RLS e PostgREST no Supabase do cliente (só o console responde).
- Visto azul: enviar quando a IA responde, ou só quando um humano abre?
- A Meta exige abrir o app WhatsApp Business de tempos em tempos na coexistência? (a confirmar)
- Lista final de assuntos do quadro de atendimento com a clínica.
