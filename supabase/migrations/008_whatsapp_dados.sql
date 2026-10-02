-- 008 — Banco de DADOS de cada empresa: espelho do WhatsApp (contatos, conversas, mensagens, reações).
-- Escrito só pelo receptor (servicos/receptor), a partir dos eventos oficiais da Meta (coexistência). Idempotente.

-- Contatos do WhatsApp: o nome do perfil (vem nas mensagens) e o nome salvo no celular da clínica (vem na
-- sincronização de contatos da coexistência). wa_id = número do contato só com dígitos.
create table if not exists wa_contatos (
  numero_id     text not null,                 -- phone_number_id do número da empresa
  wa_id         text not null,
  nome_perfil   text,
  nome_salvo    text,
  removido      boolean not null default false, -- apagado da agenda do celular (sincronização)
  contato_id    uuid,                          -- contato do CRM (ligado pelo telefone)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (numero_id, wa_id)
);

-- Uma linha por conversa (número da empresa + contato), para a lista da Inbox ser rápida.
create table if not exists wa_conversas (
  numero_id          text not null,
  wa_id              text not null,
  ultima_em          timestamptz,
  ultima_resumo      text,
  ultima_direcao     text,
  ultima_entrada_em  timestamptz,              -- última mensagem do contato: abre a janela de 24 h
  nao_lidas          int not null default 0,
  lida_ate           timestamptz,              -- até onde a equipe já leu no painel
  arquivada          boolean not null default false,
  primary key (numero_id, wa_id)
);
create index if not exists wa_conversas_ultima_idx on wa_conversas (numero_id, ultima_em desc);

create table if not exists wa_mensagens (
  id             bigserial primary key,
  numero_id      text not null,
  wa_id          text not null,                -- o contato da conversa
  wamid          text not null,                -- id da mensagem na Meta
  direcao        text not null check (direcao in ('entrada', 'saida')),
  origem         text not null check (origem in ('contato', 'celular', 'api', 'historico', 'painel')),
  tipo           text not null,                -- text, image, audio, video, document, sticker, location, contacts, interactive, button, unsupported...
  texto          text,                         -- texto, legenda ou resumo legível
  midia          jsonb,                        -- {id, mime_type, sha256, filename, caminho, baixada_em, erro}
  resposta_a     text,                         -- wamid citado (context.id)
  status         text,                         -- enviada, entregue, lida, falhou (só saída)
  status_em      timestamptz,
  erro           jsonb,
  editada_em     timestamptz,
  versoes        jsonb,                        -- textos anteriores, quando editada
  apagada_em     timestamptz,
  enviada_em     timestamptz not null,         -- horário da Meta (timestamp do evento)
  recebida_em    timestamptz not null default now(),
  bruto          jsonb,                        -- objeto da mensagem como veio da Meta
  unique (numero_id, wamid)
);
create index if not exists wa_mensagens_conversa_idx on wa_mensagens (numero_id, wa_id, enviada_em desc);
create index if not exists wa_mensagens_midia_pendente_idx on wa_mensagens (recebida_em)
  where midia is not null and (midia->>'caminho') is null and (midia->>'erro') is null;

-- Reações: uma por autor por mensagem (reagir de novo troca; tirar a reação apaga a linha).
create table if not exists wa_reacoes (
  numero_id  text not null,
  wamid      text not null,                    -- mensagem que recebeu a reação
  autor      text not null,                    -- wa_id do contato, ou 'empresa'
  emoji      text not null,
  em         timestamptz not null,
  primary key (numero_id, wamid, autor)
);
