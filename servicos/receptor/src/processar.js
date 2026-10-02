// Transforma os eventos da Meta em espelho do WhatsApp no banco da empresa:
// contatos, conversas, mensagens (entrada, saída pelo celular, saída pela API, histórico), reações,
// edições, mensagens apagadas e status (enviada, entregue, lida, falhou).
import { bancoDaEmpresa, transacao } from './banco.js';
import { rota } from './rotas.js';

export class NumeroSemDono extends Error {}

const digitos = (s) => String(s ?? '').replace(/\D/g, '');
const quando = (ts) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};
const ORDEM_STATUS = { enviada: 1, entregue: 2, lida: 3, reproduzida: 4 };
const STATUS = { sent: 'enviada', delivered: 'entregue', read: 'lida', played: 'reproduzida', failed: 'falhou', pending: 'pendente', error: 'falhou', deleted: 'apagada' };
const TIPOS_MIDIA = ['image', 'video', 'audio', 'document', 'sticker'];

// Texto legível de qualquer tipo de mensagem (o objeto completo fica em "bruto").
export function textoDe(m) {
  const t = m.type;
  if (t === 'text') return m.text?.body ?? '';
  if (TIPOS_MIDIA.includes(t)) return m[t]?.caption || m[t]?.filename || null;
  if (t === 'location') {
    const l = m.location || {};
    return [l.name, l.address, l.latitude != null ? `${l.latitude},${l.longitude}` : null].filter(Boolean).join(' · ');
  }
  if (t === 'contacts') return (m.contacts || []).map((c) => c.name?.formatted_name || c.name?.first_name).filter(Boolean).join(', ') || null;
  if (t === 'interactive') {
    const i = m.interactive || {};
    return i.button_reply?.title || i.list_reply?.title || i.nfm_reply?.body || i.body?.text || null;
  }
  if (t === 'button') return m.button?.text ?? null;
  if (t === 'template') return m.template?.name ? `Modelo: ${m.template.name}` : null;
  if (t === 'order') return 'Pedido do catálogo';
  if (t === 'system') return m.system?.body ?? null;
  if (t === 'unsupported' || t === 'unknown') return m.errors?.[0]?.title || m.errors?.[0]?.message || 'Tipo de mensagem não suportado pelo WhatsApp oficial';
  return null;
}

function midiaDe(m) {
  if (!TIPOS_MIDIA.includes(m.type)) return null;
  const x = m[m.type] || {};
  if (!x.id) return null;
  return { id: x.id, mime_type: x.mime_type ?? null, sha256: x.sha256 ?? null, filename: x.filename ?? null, voz: x.voice ?? undefined };
}

const resumo = (tipo, texto) => {
  const rot = { image: '📷 Foto', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Figurinha', location: '📍 Localização', contacts: '👤 Contato' };
  if (texto) return String(texto).replace(/\s+/g, ' ').slice(0, 160);
  return rot[tipo] || tipo;
};

async function contato(c, numero, waId, campos) {
  await c.query(
    `insert into wa_contatos (numero_id, wa_id, nome_perfil, nome_salvo, removido)
     values ($1, $2, $3, $4, coalesce($5, false))
     on conflict (numero_id, wa_id) do update set
       nome_perfil = coalesce(excluded.nome_perfil, wa_contatos.nome_perfil),
       nome_salvo  = case when $6 then excluded.nome_salvo else wa_contatos.nome_salvo end,
       removido    = coalesce($5, wa_contatos.removido),
       atualizado_em = now()`,
    [numero, waId, campos.nome_perfil ?? null, campos.nome_salvo ?? null, campos.removido ?? null, 'nome_salvo' in campos]);
}

async function conversa(c, numero, waId, { em, resumo: r, direcao, contarNaoLida, zerar }) {
  await c.query(
    `insert into wa_conversas (numero_id, wa_id, ultima_em, ultima_resumo, ultima_direcao, ultima_entrada_em, nao_lidas, lida_ate)
     values ($1, $2, $3, $4, $5, case when $5 = 'entrada' then $3::timestamptz end, case when $6 then 1 else 0 end, case when $7 then now() end)
     on conflict (numero_id, wa_id) do update set
       ultima_resumo     = case when excluded.ultima_em >= coalesce(wa_conversas.ultima_em, '-infinity') then coalesce(excluded.ultima_resumo, wa_conversas.ultima_resumo) else wa_conversas.ultima_resumo end,
       ultima_direcao    = case when excluded.ultima_em >= coalesce(wa_conversas.ultima_em, '-infinity') then excluded.ultima_direcao else wa_conversas.ultima_direcao end,
       ultima_em         = greatest(wa_conversas.ultima_em, excluded.ultima_em),
       ultima_entrada_em = greatest(wa_conversas.ultima_entrada_em, excluded.ultima_entrada_em),
       nao_lidas         = case when $7 then 0 else wa_conversas.nao_lidas + excluded.nao_lidas end,
       lida_ate          = case when $7 then now() else wa_conversas.lida_ate end,
       arquivada         = case when $6 then false else wa_conversas.arquivada end`,
    [numero, waId, em, r, direcao, Boolean(contarNaoLida), Boolean(zerar)]);
}

// Grava uma mensagem. "historico" nunca sobrescreve o que já chegou ao vivo.
async function mensagem(c, numero, waId, m, { direcao, origem, status }) {
  const tipo = m.type || 'desconhecido';
  const texto = textoDe(m);
  const em = quando(m.timestamp);
  const r = await c.query(
    `insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, midia, resposta_a, status, status_em, erro, enviada_em, bruto)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, case when $10::text is not null then $11::timestamptz end, $12, $11, $13)
     on conflict (numero_id, wamid) do update set
       tipo = case when wa_mensagens.tipo = 'desconhecido' then excluded.tipo else wa_mensagens.tipo end,
       texto = coalesce(wa_mensagens.texto, excluded.texto),
       midia = coalesce(wa_mensagens.midia, excluded.midia),
       resposta_a = coalesce(wa_mensagens.resposta_a, excluded.resposta_a),
       bruto = coalesce(wa_mensagens.bruto, excluded.bruto),
       origem = case when wa_mensagens.origem = 'api' and excluded.origem <> 'historico' then excluded.origem else wa_mensagens.origem end
     returning (xmax = 0) as nova`,
    [numero, waId, m.id, direcao, origem, tipo, texto, midiaDe(m), m.context?.id ?? null, status ?? null, em,
      m.errors ? JSON.stringify(m.errors) : null, m]);
  return { nova: r.rows[0]?.nova === true, em, texto, tipo };
}

async function reacao(c, numero, autor, m) {
  const alvo = m.reaction?.message_id;
  if (!alvo) return;
  const emoji = m.reaction?.emoji;
  if (!emoji) await c.query('delete from wa_reacoes where numero_id = $1 and wamid = $2 and autor = $3', [numero, alvo, autor]);
  else {
    await c.query(
      `insert into wa_reacoes (numero_id, wamid, autor, emoji, em) values ($1,$2,$3,$4,$5)
       on conflict (numero_id, wamid, autor) do update set emoji = excluded.emoji, em = excluded.em where wa_reacoes.em <= excluded.em`,
      [numero, alvo, autor, emoji, quando(m.timestamp)]);
  }
}

async function edicao(c, numero, m) {
  const alvo = m.edit?.original_message_id;
  if (!alvo) return;
  const nova = m.edit?.message || {};
  const texto = textoDe(nova);
  await c.query(
    `update wa_mensagens set
       versoes = coalesce(versoes, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('texto', texto, 'ate', $4::timestamptz)),
       texto = $3, editada_em = $4
     where numero_id = $1 and wamid = $2`,
    [numero, alvo, texto, quando(m.timestamp)]);
}

async function apagada(c, numero, m) {
  const alvo = m.revoke?.original_message_id;
  if (!alvo) return;
  await c.query('update wa_mensagens set apagada_em = $3 where numero_id = $1 and wamid = $2', [numero, alvo, quando(m.timestamp)]);
}

// Mensagem viva (entrada do contato ou eco do celular): trata reação, edição e apagada; o resto vira linha.
async function mensagemViva(c, numero, waId, m, direcao, origem) {
  if (m.type === 'reaction') return reacao(c, numero, direcao === 'entrada' ? waId : 'empresa', m);
  if (m.type === 'edit') return edicao(c, numero, m);
  if (m.type === 'revoke') return apagada(c, numero, m);
  const r = await mensagem(c, numero, waId, m, { direcao, origem, status: direcao === 'saida' ? 'enviada' : null });
  if (r.nova || direcao === 'saida') {
    await conversa(c, numero, waId, {
      em: r.em, resumo: resumo(r.tipo, r.texto), direcao,
      contarNaoLida: r.nova && direcao === 'entrada',
      zerar: direcao === 'saida' && origem === 'celular', // respondeu pelo celular: já leu
    });
  }
}

async function status(c, numero, s) {
  const novo = STATUS[String(s.status || '').toLowerCase()] || String(s.status || '');
  const em = quando(s.timestamp);
  const waId = digitos(s.recipient_id);
  // Mensagem enviada pela API (Sara) que ainda não conhecemos: cria a linha só com o status.
  await c.query(
    `insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, status, status_em, erro, enviada_em)
     values ($1,$2,$3,'saida','api','desconhecido',$4,$5,$6,$5)
     on conflict (numero_id, wamid) do update set
       status = case
         when excluded.status = 'falhou' then 'falhou'
         when wa_mensagens.status is null or wa_mensagens.status = 'pendente' then excluded.status
         when coalesce(($7::jsonb ->> excluded.status)::int, 0) > coalesce(($7::jsonb ->> wa_mensagens.status)::int, 0) then excluded.status
         else wa_mensagens.status end,
       status_em = case when excluded.status_em >= coalesce(wa_mensagens.status_em, '-infinity') then excluded.status_em else wa_mensagens.status_em end,
       erro = coalesce(excluded.erro, wa_mensagens.erro)`,
    [numero, waId || 'desconhecido', s.id, novo, em, s.errors ? JSON.stringify(s.errors) : null, JSON.stringify(ORDEM_STATUS)]);
  if (waId) await conversa(c, numero, waId, { em, resumo: null, direcao: 'saida', contarNaoLida: false, zerar: false }).catch(() => undefined);
}

// Histórico da coexistência: chega em blocos (fases 0-1, 1-90 e 90-180 dias), na conexão do número.
// Pode ter dezenas de milhares de mensagens: grava em lotes de 500 numa consulta só (o banco fica longe).
// Nunca sobrescreve o que já chegou ao vivo.
async function historico(c, numero, value) {
  const meu = digitos(value.metadata?.display_phone_number);
  const linhas = [];
  const ultimas = new Map();
  for (const bloco of value.history || []) {
    for (const t of bloco.threads || []) {
      const waId = digitos(t.id);
      if (!waId) continue;
      for (const m of t.messages || []) {
        if (m.type === 'reaction') { await reacao(c, numero, digitos(m.from) === meu ? 'empresa' : waId, m); continue; }
        if (m.type === 'edit' || m.type === 'revoke' || !m.id) continue;
        const direcao = meu && digitos(m.from) === meu ? 'saida' : 'entrada';
        const st = direcao === 'saida' && m.history_context?.status
          ? STATUS[String(m.history_context.status).toLowerCase()] || String(m.history_context.status).toLowerCase() : null;
        const em = quando(m.timestamp);
        const texto = textoDe(m);
        linhas.push({ wa_id: waId, wamid: m.id, direcao, tipo: m.type || 'desconhecido', texto, midia: midiaDe(m), resposta_a: m.context?.id ?? null, status: st, em: em.toISOString(), bruto: m });
        const u = ultimas.get(waId);
        if (!u || em >= u.em) ultimas.set(waId, { em, resumo: resumo(m.type, texto), direcao });
      }
    }
  }
  for (let i = 0; i < linhas.length; i += 500) {
    await c.query(
      `insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, midia, resposta_a, status, status_em, enviada_em, bruto)
       select $1, x.wa_id, x.wamid, x.direcao, 'historico', x.tipo, x.texto, x.midia, x.resposta_a, x.status,
              case when x.status is not null then x.em end, x.em, x.bruto
         from jsonb_to_recordset($2::jsonb) as x(wa_id text, wamid text, direcao text, tipo text, texto text, midia jsonb,
                                                 resposta_a text, status text, em timestamptz, bruto jsonb)
       on conflict (numero_id, wamid) do update set
         tipo = excluded.tipo, texto = excluded.texto, midia = excluded.midia, resposta_a = excluded.resposta_a, bruto = excluded.bruto
         where wa_mensagens.tipo = 'desconhecido'`, // só completa a linha criada por um status (mensagem da Sara)
      [numero, JSON.stringify(linhas.slice(i, i + 500))]);
  }
  for (const [waId, u] of ultimas) await conversa(c, numero, waId, { ...u, contarNaoLida: false, zerar: false });
  return linhas.length;
}

async function contatosDaAgenda(c, numero, value) {
  for (const s of value.state_sync || []) {
    if (s.type !== 'contact' || !s.contact) continue;
    const waId = digitos(s.contact.phone_number);
    if (!waId) continue;
    const remover = s.action === 'remove';
    await contato(c, numero, waId, { nome_salvo: remover ? null : (s.contact.full_name || s.contact.first_name || null), removido: remover });
  }
}

// Um evento inteiro da Meta (pode ter várias entradas e mudanças). Tudo de um número numa transação.
export async function processarEvento(texto) {
  const corpo = JSON.parse(texto);
  const resultado = { mensagens: 0, status: 0, contatos: 0, historico: 0, ignorados: 0 };
  for (const entrada of corpo.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const campo = mudanca.field;
      const v = mudanca.value || {};
      const numero = String(v.metadata?.phone_number_id || '');
      if (!['messages', 'smb_message_echoes', 'history', 'smb_app_state_sync'].includes(campo)) { resultado.ignorados++; continue; }
      const r = await rota(numero);
      if (!r) throw new NumeroSemDono(`Número ${numero || '(sem id)'} não cadastrado em whatsapp_numeros.`);
      await transacao(bancoDaEmpresa(r), async (c) => {
        if (campo === 'messages') {
          for (const k of v.contacts || []) {
            if (k.wa_id) { await contato(c, numero, digitos(k.wa_id), { nome_perfil: k.profile?.name ?? null }); resultado.contatos++; }
          }
          for (const m of v.messages || []) { await mensagemViva(c, numero, digitos(m.from), m, 'entrada', 'contato'); resultado.mensagens++; }
          for (const s of v.statuses || []) { await status(c, numero, s); resultado.status++; }
        } else if (campo === 'smb_message_echoes') {
          for (const m of v.message_echoes || []) { await mensagemViva(c, numero, digitos(m.to), m, 'saida', 'celular'); resultado.mensagens++; }
        } else if (campo === 'history') {
          resultado.historico += await historico(c, numero, v);
        } else if (campo === 'smb_app_state_sync') {
          await contatosDaAgenda(c, numero, v);
          resultado.contatos += (v.state_sync || []).length;
        }
      });
    }
  }
  return resultado;
}

// Para a fila: número e campo do primeiro item do evento (só informativo).
export function resumoDoEvento(corpo) {
  const ch = corpo?.entry?.[0]?.changes?.[0];
  return { numero: ch?.value?.metadata?.phone_number_id ? String(ch.value.metadata.phone_number_id) : null, campo: ch?.field ?? null };
}

// A Sara (n8n) avisa o que mandou pela API: a Meta só devolve o status, sem o conteúdo.
export async function registrarEnvio(d) {
  const numero = String(d.phone_number_id || '');
  const r = await rota(numero);
  if (!r) throw new NumeroSemDono(`Número ${numero || '(sem id)'} não cadastrado em whatsapp_numeros.`);
  const waId = digitos(d.to);
  if (!d.wamid || !waId) throw new Error('Informe wamid e to.');
  const m = { id: String(d.wamid), type: String(d.tipo || 'text'), timestamp: d.timestamp, text: { body: d.texto ?? '' } };
  if (m.type !== 'text') m[m.type] = { caption: d.texto ?? null, id: d.midia_id ?? undefined, mime_type: d.mime_type ?? undefined, filename: d.filename ?? undefined };
  await transacao(bancoDaEmpresa(r), async (c) => {
    const x = await c.query(
      `insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, midia, enviada_em, bruto, status, status_em)
       values ($1,$2,$3,'saida','api',$4,$5,$6,$7,$8,'enviada',$7)
       on conflict (numero_id, wamid) do update set tipo = excluded.tipo, texto = excluded.texto,
         midia = coalesce(wa_mensagens.midia, excluded.midia), bruto = coalesce(wa_mensagens.bruto, excluded.bruto)
       returning (xmax = 0) as nova`,
      [numero, waId, m.id, m.type, textoDe(m), midiaDe(m), quando(m.timestamp), { ...d, origem: 'registro' }]);
    await conversa(c, numero, waId, { em: quando(m.timestamp), resumo: resumo(m.type, textoDe(m)), direcao: 'saida', contarNaoLida: false, zerar: false });
    return x.rows[0]?.nova;
  });
}
