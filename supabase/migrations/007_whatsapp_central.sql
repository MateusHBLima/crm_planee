-- 007 — Banco CENTRAL: números de WhatsApp e eventos brutos da Meta (receptor, decisão 28). Idempotente.
-- O receptor (servicos/receptor) é o endereço de webhook da Meta. Ele guarda cada evento aqui ANTES de qualquer
-- outra coisa, repassa para o n8n da Sara e depois distribui as mensagens para o banco de dados da empresa.

-- Cada número conectado (phone_number_id da Meta) pertence a uma empresa.
create table if not exists whatsapp_numeros (
  phone_number_id text primary key check (phone_number_id ~ '^\d{5,30}$'),
  waba_id         text,
  empresa_id      text not null references empresas(id),
  nome            text,                       -- ex.: "Clínica — principal"
  telefone        text,                       -- número de exibição, só dígitos (55...)
  encaminhar_url  text,                       -- para onde repassar o evento bruto (n8n da Sara); vazio = não repassa
  baixar_midias   boolean not null default true,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
alter table whatsapp_numeros enable row level security;

-- Fila de eventos brutos: nada se perde. Processado = já distribuído para o banco da empresa.
-- O corpo bruto é apagado depois de N dias (WA_RETER_DIAS no receptor); o que importa já está no banco da empresa.
create table if not exists wa_eventos (
  id              bigserial primary key,
  recebido_em     timestamptz not null default now(),
  hash            text not null unique,        -- sha256 do corpo: a Meta às vezes entrega o mesmo evento 2 vezes
  phone_number_id text,
  campo           text,                        -- messages, smb_message_echoes, history, smb_app_state_sync...
  corpo           text not null,               -- corpo exatamente como veio (o repasse reenvia byte a byte)
  assinatura      text,                        -- X-Hub-Signature-256 original (o repasse reenvia junto)
  repassar        boolean not null default false,
  repassado_em    timestamptz,
  repasse_tentativas int not null default 0,
  repasse_erro    text,
  processado_em   timestamptz,
  tentativas      int not null default 0,
  erro            text,
  proxima_tentativa timestamptz not null default now()
);
create index if not exists wa_eventos_pendentes_idx on wa_eventos (proxima_tentativa) where processado_em is null;
create index if not exists wa_eventos_repasse_idx on wa_eventos (recebido_em) where repassar and repassado_em is null;
alter table wa_eventos enable row level security;
