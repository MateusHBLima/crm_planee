# PLANO — Painel Planee

Ordem de execução. Cada tarefa tem critério de pronto. Marque `[x]` ao concluir e registre como foi verificado.

As fases 0 e 1 não tocam o agente em produção. A fase 2 é a única que muda a produção, e só depois de validada no ambiente de teste.

---

## Fase 0 — Fundação

- [x] **0.1 Ler o banco real.** Gerar os `SELECT` em `information_schema.columns` para o schema `teste` (todas as tabelas) e para `public.mensagens_gemini_cliente`, `public.usuarios_cliente`, `public.log_agendamentos`, `public.log_requisicoes`, `public.notificacoes`. O Mateus roda e cola o resultado. Salvar em `supabase/esquema_atual.md`.
  *Pronto quando:* o arquivo lista cada tabela com suas colunas e tipos.
  *Feito em 26/09:* 28 tabelas (5 do `public`, 23 do `teste`) lidas do `information_schema` pela sessão da Sara (só leitura), com colunas, tipos, não nulo, padrão e chaves, mais observações para a 0.3.
- [x] **0.2 Esqueleto do app.** Next.js + TypeScript, `design/tokens.css` global, fontes Geist, tema claro/escuro com alternância salva no navegador, cliente Supabase lendo `.env.local`. O app lê o endereço acessado e abre o modo Planee (`adm`) ou o modo cliente (decisões 12 e 19). Publicado na Vercel, no endereço grátis `.vercel.app` (decisão 20).
  *Feito:* no ar em https://crm-planee-topaz.vercel.app; `?modo=adm` abre o modo Planee (conferido em 26/09: barra lateral com Clientes e Interno Planee, alternância de tema, aviso de Supabase não configurado).
- [ ] **0.2b Registro de clientes.** Supabase da Planee com a lista de clientes (nome, apelido, endereço, qual Supabase) e o login da equipe Planee. Chaves de cada cliente só no servidor (variáveis de ambiente).
  *Pronto quando:* `npm run dev` abre uma página com a barra lateral do protótipo nos dois temas.
- [ ] **0.3 Mapear nomes.** Comparar `supabase/esquema_atual.md` com `docs/especificacao.md` (seções 6 e 10) e `docs/decisoes.md` (itens 8 e 9). Onde o schema `teste` já tem a tabela (`conversa_estado`, `crm_eventos`, `crm_fatos`, `pacientes`, `pacientes_telefone`), usar a existente. Escrever a lista final em `supabase/modelo.md`.
  *Pronto quando:* o Mateus aprovar `supabase/modelo.md`.
- [ ] **0.4 SQL das tabelas novas, em `teste`.** Uma migração por arquivo em `supabase/migrations/`, na ordem:
  1. `atendimentos` (com `topico`, `aberto_por`, marcas de tempo) e `atendimento_vistas`
  2. `crm_etapas`, `crm_topicos`, `crm_config`
  3. `painel_usuarios`, `painel_auditoria`
  4. `contatos_equipe`, `contato_etiquetas`, `contato_notas`
  5. colunas de `conversa_estado` que faltarem (dono, não lidas, marcada não lida, `ia_desligada`)
  *Pronto quando:* cada migração rodou (pelo Mateus) e o `SELECT` de conferência bateu.
- [ ] **0.5 Gatilhos e funções.** Gatilho de mensagem nova atualiza última mensagem e não lidas; gatilho de `atendimentos` recalcula o dono da conversa; funções `assumir_conversa`, `mover_atendimento`, `marcar_nao_lida`, `registrar_vista`, cada uma gravando quem e quando.
  *Pronto quando:* um teste em SQL mostra o dono mudando de `aguardando` para `humano` e de volta para `ia`.
- [ ] **0.6 RLS e login.** Supabase Auth; RLS por papel lido de `painel_usuarios` (`secretaria`, `gestor`); um usuário de cada papel para teste. Login do `adm` com segundo fator (MFA) obrigatório e registro de cada conversa aberta pela Planee.
  *Pronto quando:* a secretária não consegue ler a tela interna nem por URL direta.
- [ ] **0.7 Semente do CRM.** Preencher `crm_etapas` e `crm_topicos` com o modelo Clínica (valores no protótipo, função `modelos()`).

## Fase 1 — Leitura (nada escreve)

- [ ] **1.1 Inbox somente leitura, em tempo real.** Lista com as quatro abas, busca, conversa com bolhas por autor, ficha lateral. Realtime para mensagens novas.
- [ ] **1.2 CRM somente leitura.** Quadro de atendimento por assunto, funil comercial, contatos, lidos das tabelas.
- [ ] **1.3 Resultados da clínica.** Consultas marcadas pela IA, conversas por dia, espera pela equipe. Consultas prontas em `docs/relatorio.md`, seção 9.
- [ ] **1.4 Interno Planee.** No `adm`, com todos os clientes lado a lado: custo por dia, cache e fallback, falhas, alertas.
  *Pronto quando (fase):* o Dr. Amilton abre os resultados sozinho e a Planee acompanha conversas sem abrir o Supabase.

## Fase 2 — Atendimento (toca o agente, primeiro no ambiente de teste)

- [ ] 2.1 Botões Assumir, Pendente interno, Retomar, Finalizar chamando as funções da 0.5.
- [ ] 2.2 Marcar como não lida; vistos registrados ao abrir.
- [ ] 2.3 Webhook `painel_enviar` no n8n de teste: valida janela de 24h, envia, grava a mensagem `[EQUIPE]` com `enviado_por`.
- [ ] 2.4 Webhook `painel_retomar`: devolve a conversa à IA quando o cartão sai de "em atendimento" e a última mensagem é do paciente.
- [ ] 2.5 Agente de teste lê o dono da conversa no Postgres, no lugar do bloqueio de 7 minutos no Redis.
- [ ] 2.6 `notificar_equipe` abre a solicitação com assunto e devolve erro de verdade quando descarta a chamada.
- [ ] 2.7 Teto de 60 minutos em modo restrito.
- [ ] 2.8 Notificações no painel (alerta sonoro e Web Push).
  *Pronto quando:* a Amanda atende um dia inteiro só pelo painel, no número de teste.

## Fase 3 — CRM completo e configurável

- [ ] 3.1 Tela de configuração do CRM gravando em `crm_etapas`, `crm_topicos`, `crm_config`, com os três modelos de partida.
- [ ] 3.2 Robô do CRM e `notificar_equipe` lendo gatilhos e palavras dessas tabelas.
- [ ] 3.3 Etiquetas, notas, vincular paciente ao telefone.

## Fase 4 — Configuração do agente

- [ ] 4.1 Versões de prompt, publicar com recriação do cache, reverter.
- [ ] 4.2 Parâmetros de negócio editáveis pelo gestor (`teste.negocio`).

## Fase 5 — Segundo cliente

- [ ] 5.1 SSA no mesmo app: cadastro pela skill `cadastrar-cliente-painel`, endereço `painel.ssa.planeelabia.com`.
