-- 012 — Banco de DADOS de cada empresa: prazo de quem assumiu a conversa na Inbox.
-- "Assumir por 24 h": dono_ate = agora + 24 h, e cada resposta da equipe (painel ou celular) empurra o prazo para
-- 24 h depois dela; vencido, a Sara volta sozinha. "Assumir sempre": dono_ate vazio, a conversa fica com a equipe até
-- alguém devolver (é também o que já valia para as conversas assumidas antes desta migração). Idempotente.
alter table wa_conversas add column if not exists dono_ate timestamptz;
