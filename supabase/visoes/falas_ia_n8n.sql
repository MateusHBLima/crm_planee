-- Visão falas_ia: o texto das mensagens que a IA mandou pela API (a Meta só devolve o status), para a Inbox.
-- Para empresas cuja IA grava o histórico no formato do n8n: tabela com telefone ("5547...@s.whatsapp.net"),
-- "timestamp" em texto (DD-MM-YYYY HH24:MI:SS, horário de Brasília) e conversation_history ({role, parts:[{text}]}).
-- Rodar no banco da empresa, no schema do painel (search_path), como dono da tabela de histórico (postgres).
-- Só leitura: a tabela de histórico não é alterada. Idempotente.
create or replace view falas_ia as
select m.telefone::text as telefone,
       (to_timestamp(m."timestamp", 'DD-MM-YYYY HH24:MI:SS')::timestamp at time zone 'America/Sao_Paulo') as em,
       (select string_agg(p.value->>'text', E'\n\n' order by p.ordinality)
          from jsonb_array_elements(m.conversation_history::jsonb -> 'parts') with ordinality p
         where p.value ? 'text') as texto
  from public.mensagens_gemini_cliente m
 where m.conversation_history::jsonb ->> 'role' = 'model'
   and m."timestamp" ~ '^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$'
   and coalesce(m.conversation_history::jsonb -> 'parts' -> 0 ->> 'text', '') !~ '^\s*\[EQUIPE\]';
