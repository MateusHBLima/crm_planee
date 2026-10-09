-- 011 — Banco CENTRAL: cadastro dos números de WhatsApp pelo painel (tela Empresas), sem Portainer.
-- Cada número guarda o próprio token da Meta e, se o app for outro, o segredo do app (os dois cifrados com
-- PAINEL_CHAVE_CIFRA, o mesmo formato de empresas.banco_url_cifrado). "Conectar" no painel só marca o pedido;
-- o receptor, que conhece o verify token, aponta o número para si na Meta e grava o resultado. Idempotente.

alter table whatsapp_numeros add column if not exists token_cifrado       text;
alter table whatsapp_numeros add column if not exists app_secret_cifrado  text;
alter table whatsapp_numeros add column if not exists conectar_pedido_em  timestamptz;
alter table whatsapp_numeros add column if not exists conectar_pedido_por text;
alter table whatsapp_numeros add column if not exists conectado_em        timestamptz;
alter table whatsapp_numeros add column if not exists conexao_erro        text;
alter table whatsapp_numeros add column if not exists verificado_nome     text;   -- nome verificado na Meta
-- Histórico da coexistência (180 dias): o painel pede, o receptor chama a Meta (agenda e depois conversas).
alter table whatsapp_numeros add column if not exists historico_pedido_em  timestamptz;
alter table whatsapp_numeros add column if not exists historico_pedido_por text;
alter table whatsapp_numeros add column if not exists historico_status     text;
alter table whatsapp_numeros add column if not exists historico_em         timestamptz;

-- Links curtos para a equipe ouvir e ver as mídias na Inbox. O painel cria (depois de conferir a permissão e a
-- empresa), o receptor entrega o arquivo do Storage enquanto o link vale. Só o token e o caminho, sem conteúdo.
create table if not exists wa_midia_links (
  token      text primary key,
  empresa_id text not null,
  caminho    text not null,
  mime       text,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default now()
);
create index if not exists wa_midia_links_expira_idx on wa_midia_links (expira_em);
alter table wa_midia_links enable row level security;
