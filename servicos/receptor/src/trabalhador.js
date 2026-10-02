// Laços em segundo plano: distribuir eventos, refazer repasses que falharam, baixar mídias, esvaziar o spool
// e limpar eventos antigos. Vários receptores podem rodar juntos: cada evento é pego por um só (skip locked).
import { config, midiaConfigurada } from './config.js';
import { bancoDaEmpresa, central } from './banco.js';
import { NumeroSemDono, processarEvento } from './processar.js';
import { marcarRepasse, repassar } from './repasse.js';
import { baixarMidia } from './meta.js';
import { extensao, guardarArquivo } from './armazenamento.js';
import { esvaziarSpool } from './spool.js';
import { recarregarRotas, todasAsRotas } from './rotas.js';
import { erroCurto, log } from './log.js';

export async function gravarEvento(reg) {
  const r = await central().query(
    `insert into wa_eventos (hash, phone_number_id, campo, corpo, assinatura, repassar, repassado_em, recebido_em)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::timestamptz, now()))
     on conflict (hash) do nothing returning id`,
    [reg.hash, reg.numero, reg.campo, reg.corpo, reg.assinatura, reg.repassar, reg.repassado_em ?? null, reg.recebido_em ?? null]);
  return r.rows[0]?.id ?? null;
}

// Distribui até 20 eventos pendentes. Erro: tenta de novo mais tarde (30 s, 1 min, 2 min... até 10 vezes).
export async function processarPendentes(limite = 20) {
  const r = await central().query(
    `update wa_eventos e set tentativas = e.tentativas + 1,
            proxima_tentativa = now() + interval '30 seconds' * power(2, least(e.tentativas, 8))
      where e.id in (select id from wa_eventos where processado_em is null and proxima_tentativa <= now() and tentativas < 10
                      order by id limit $1 for update skip locked)
      returning e.id, e.corpo`, [limite]);
  let feitos = 0;
  for (const ev of r.rows.sort((a, b) => Number(a.id) - Number(b.id))) {
    try {
      const res = await processarEvento(ev.corpo);
      await central().query('update wa_eventos set processado_em = now(), erro = null where id = $1', [ev.id]);
      feitos++;
      if (res.historico) log('info', 'histórico recebido', { id: ev.id, mensagens: res.historico });
    } catch (e) {
      const semDono = e instanceof NumeroSemDono;
      // Número ainda não cadastrado: espera sem gastar tentativas (vale quando o cadastro vier depois).
      await central().query(
        `update wa_eventos set erro = $2${semDono ? ", tentativas = 0, proxima_tentativa = now() + interval '10 minutes'" : ''} where id = $1`,
        [ev.id, erroCurto(e)]).catch(() => undefined);
      if (!semDono) log('erro', 'evento não processado', { id: ev.id, erro: erroCurto(e) });
    }
  }
  return feitos;
}

// Repasses para o n8n que falharam: novas tentativas por até 1 hora (5 s, 10 s, 20 s... no máximo 8).
export async function refazerRepasses() {
  const r = await central().query(
    `select id, corpo, assinatura, phone_number_id from wa_eventos
      where repassar and repassado_em is null and repasse_tentativas between 1 and 7
        and recebido_em > now() - interval '1 hour'
        and recebido_em + interval '5 seconds' * power(2, repasse_tentativas) <= now()
      order by id limit 20`);
  const { destinoDoRepasse } = await import('./rotas.js');
  for (const ev of r.rows) {
    const url = destinoDoRepasse(ev.phone_number_id);
    if (!url) { await central().query('update wa_eventos set repassar = false where id = $1', [ev.id]); continue; }
    try { await repassar(url, ev.corpo, ev.assinatura); await marcarRepasse(ev.id, null); }
    catch (e) { await marcarRepasse(ev.id, erroCurto(e)); }
  }
  return r.rowCount;
}

// Baixa as mídias que ainda não estão no Storage (até 5 por empresa por volta). Até 5 tentativas por arquivo.
export async function baixarMidiasPendentes() {
  if (!midiaConfigurada()) return 0;
  let n = 0;
  const vistos = new Set();
  for (const rt of todasAsRotas()) {
    if (!rt.baixar_midias) continue;
    let db;
    try { db = bancoDaEmpresa(rt); } catch { continue; }
    const chave = rt.empresa_id + rt.phone_number_id;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const r = await db.query(
      `select id, wamid, midia from wa_mensagens
        where numero_id = $1 and midia is not null and (midia->>'caminho') is null and (midia->>'erro') is null
        order by recebida_em desc limit 5`, [rt.phone_number_id]);
    for (const m of r.rows) {
      try {
        const { bytes, mime } = await baixarMidia(m.midia.id);
        const caminho = `${rt.empresa_id}/${rt.phone_number_id}/${m.wamid.replace(/[^\w.-]/g, '_')}.${extensao(mime, m.midia.filename)}`;
        await guardarArquivo(caminho, bytes, mime);
        await db.query(`update wa_mensagens set midia = midia || jsonb_build_object('caminho', $2::text, 'tamanho', $3::int, 'baixada_em', now()) where id = $1`,
          [m.id, caminho, bytes.length]);
        n++;
      } catch (e) {
        const t = Number(m.midia.tentativas || 0) + 1;
        await db.query(`update wa_mensagens set midia = midia || jsonb_build_object('tentativas', $2::int) || case when $2 >= 5 then jsonb_build_object('erro', $3::text) else '{}'::jsonb end where id = $1`,
          [m.id, t, erroCurto(e)]).catch(() => undefined);
      }
    }
  }
  return n;
}

// Corpo bruto só fica guardado por WA_RETER_DIAS: o espelho já está no banco da empresa.
export async function limparAntigos() {
  const r = await central().query(
    `delete from wa_eventos where processado_em is not null and (not repassar or repassado_em is not null)
        and recebido_em < now() - make_interval(days => $1)`, [config.reterDias]);
  return r.rowCount;
}

export const esvaziarSpoolNoBanco = () => esvaziarSpool(gravarEvento);

let parar = false;
export function pararLacos() { parar = true; }

export function iniciarLacos() {
  const laco = async (nome, fn, ms) => {
    while (!parar) {
      try { await fn(); } catch (e) { log('erro', `laço ${nome}`, { erro: erroCurto(e) }); }
      await new Promise((r) => setTimeout(r, ms));
    }
  };
  laco('rotas', recarregarRotas, 60_000);
  laco('spool', esvaziarSpoolNoBanco, 10_000);
  laco('eventos', async () => { while (!parar && (await processarPendentes()) === 20); }, config.intervaloMs);
  laco('repasses', refazerRepasses, 5_000);
  laco('midias', baixarMidiasPendentes, 5_000);
  laco('limpeza', limparAntigos, 3_600_000);
}
