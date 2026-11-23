-- 034 — Banco de DADOS de cada empresa: redes sociais (23/11). Directs (Instagram e as próximas redes com conversa)
-- e comentários (Instagram, YouTube, TikTok). Quem grava é o n8n da empresa, pela API do painel
-- (POST /api/v1/redes/...); o painel não fala com a Meta, o Google nem o TikTok (regra 7). Idempotente.

-- Contas de rede social conectadas à empresa. id = "<rede>:<id da conta na rede>" (ex.: instagram:17841400000000000).
-- responder_url: webhook do n8n que envia a resposta escrita no painel (cabeçalho x-painel-segredo da empresa).
create table if not exists rs_contas (
  id             text primary key,
  rede           text not null check (rede in ('instagram', 'facebook', 'tiktok', 'youtube')),
  conta_externa  text not null,
  usuario        text,                          -- @ da conta, sem o @
  nome           text,
  responder_url  text,
  ativa          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (rede, conta_externa)
);

-- Uma linha por conversa (conta da empresa + pessoa), para a lista ser rápida. pessoa_id = id da pessoa na rede
-- (no Instagram, o IGSID).
create table if not exists rs_conversas (
  conta_id           text not null references rs_contas (id),
  pessoa_id          text not null,
  usuario            text,                      -- @ da pessoa, sem o @
  nome               text,
  contato_id         uuid,                      -- contato do CRM, quando ligado
  ultima_em          timestamptz,
  ultima_resumo      text,
  ultima_direcao     text,
  ultima_entrada_em  timestamptz,               -- última mensagem da pessoa: abre a janela de 24 h
  nao_lidas          int not null default 0,
  lida_ate           timestamptz,
  lida_por           text,
  lida_em            timestamptz,
  arquivada          boolean not null default false,
  primary key (conta_id, pessoa_id)
);
create index if not exists rs_conversas_ultima_idx on rs_conversas (conta_id, ultima_em desc);

create table if not exists rs_mensagens (
  id           bigserial primary key,
  conta_id     text not null references rs_contas (id),
  pessoa_id    text not null,
  mid          text not null,                   -- id da mensagem na rede
  direcao      text not null check (direcao in ('entrada', 'saida')),
  origem       text not null check (origem in ('contato', 'ia', 'painel', 'app')), -- app = equipe pelo app da rede
  por          text,                            -- quem da equipe respondeu pelo painel
  tipo         text not null default 'texto',   -- texto, imagem, video, audio, arquivo, story, outro
  texto        text,
  midia_url    text,
  resposta_a   text,                            -- mid citado
  enviada_em   timestamptz not null,
  recebida_em  timestamptz not null default now(),
  unique (conta_id, mid)
);
create index if not exists rs_mensagens_conversa_idx on rs_mensagens (conta_id, pessoa_id, enviada_em desc);

-- Comentários em posts e vídeos, e o que a IA fez com cada um (tela Comentários).
create table if not exists rs_comentarios (
  id               bigserial primary key,
  conta_id         text not null references rs_contas (id),
  comentario_id    text not null,               -- id do comentário na rede
  post_id          text,
  post_url         text,
  post_titulo      text,
  autor_id         text,
  autor_usuario    text,
  autor_nome       text,
  texto            text,
  comentado_em     timestamptz not null,
  resposta_publica text,                        -- o que foi respondido no próprio comentário
  respondido_em    timestamptz,
  respondido_por   text,                        -- 'ia' ou o nome de quem respondeu
  direct_enviado   boolean not null default false,
  situacao         text not null default 'novo' check (situacao in ('novo', 'respondido', 'ignorado', 'oculto', 'erro')),
  erro             text,
  recebido_em      timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (conta_id, comentario_id)
);
create index if not exists rs_comentarios_conta_idx on rs_comentarios (conta_id, comentado_em desc);
