-- 030 — Banco CENTRAL: para onde avisar a IA quando a equipe responde pela Inbox do painel (27/10).
-- A empresa cuja IA recebe direto da Meta (a SSA: a Meta entrega no n8n dela e o n8n copia para o receptor) não
-- tem encaminhar_url. Sem este campo, a resposta pelo painel não chegava à IA, e a IA respondia junto.
-- eco_url: endereço do webhook da IA que recebe só o eco das respostas pelo painel (formato smb_message_echoes,
-- igual ao da Meta). Vazio = o eco vai para o encaminhar_url, como antes (a clínica).
-- Idempotente; só acrescenta.

alter table whatsapp_numeros add column if not exists eco_url text;
alter table whatsapp_numeros drop constraint if exists whatsapp_numeros_eco_url_https;
alter table whatsapp_numeros add constraint whatsapp_numeros_eco_url_https check (eco_url is null or eco_url ~ '^https?://[^[:space:]]+$');
