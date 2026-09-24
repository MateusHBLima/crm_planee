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

## Em aberto

- RLS e PostgREST no Supabase do cliente (só o console responde).
- Colunas reais de `mensagens_gemini_cliente` e `usuarios_cliente` (tarefa 0.1 do PLANO).
- O banco da SSA tem as tabelas de log?
- Visto azul: enviar quando a IA responde, ou só quando um humano abre?
- A Meta exige abrir o app WhatsApp Business de tempos em tempos na coexistência? (a confirmar)
- Lista final de assuntos do quadro de atendimento com a clínica.
