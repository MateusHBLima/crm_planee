import 'server-only';
import type { PoolClient } from 'pg';
import { ErroApi, transacao } from '@/lib/db';
import { chaveTelefone, normalizarTelefone, SQL_MESMO_TELEFONE } from '@/lib/telefone';
import { bancoDe, type Chave } from './auth';
import { auditar, contatoDoTelefone, exigirEscopo, quando, texto } from './servico';

// Mensagens automáticas da IA no CRM (migração 017). O relógio (quando enviar) fica do lado da IA; aqui ficam:
//   POST /api/v1/automaticas/recusa  {telefone | contato_id, parar, motivo?, por?}
//   POST /api/v1/automaticas/envios  {telefone, tipo, situacao, quando?, texto?, wamid?, motivo?, servico?, chave}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPO = /^[a-z0-9_]{2,40}$/;
const SITUACOES = ['enviado', 'falhou', 'cancelado'];
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const falta017 = () => new ErroApi(503, 'As mensagens automáticas ainda não foram instaladas no banco desta empresa (migração 017).');
const objeto = (corpo: unknown) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroApi(400, 'Envie um objeto JSON.');
  return corpo as Record<string, unknown>;
};

// Todos os cadastros do mesmo telefone (com e sem o 9): a recusa vale para a pessoa, não para um cadastro só.
async function contatosDoTelefone(c: PoolClient, tel: string): Promise<string[]> {
  const r = await c.query(`select id from contatos where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em`, chaveTelefone(tel));
  return r.rows.map((x) => String(x.id));
}

export async function recusaAutomaticas(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = objeto(corpo);
  if (typeof d.parar !== 'boolean') throw new ErroApi(400, 'Informe "parar": true (não enviar mais) ou false (voltar a enviar).');
  const parar = d.parar;
  const motivo = texto(d.motivo, 300);
  // Quem marcou: a pessoa do painel, ou o que a IA informar (padrão: o nome da chave).
  const por = chave.usuario_id ? chave.nome : (texto(d.por, 80) ?? chave.nome);
  try {
    return await transacao(async (c) => {
      let ids: string[];
      if (d.contato_id) {
        const id = String(d.contato_id);
        if (!UUID.test(id)) throw new ErroApi(400, 'contato_id inválido.');
        const r = await c.query('select telefone from contatos where id = $1', [id]);
        if (!r.rowCount) throw new ErroApi(404, 'Contato não encontrado.');
        let tel: string | null = null;
        try { tel = normalizarTelefone(r.rows[0].telefone); } catch { tel = null; }
        ids = tel ? await contatosDoTelefone(c, tel) : [id];
        if (!ids.includes(id)) ids.push(id);
      } else {
        if (d.telefone === undefined) throw new ErroApi(400, 'Informe "telefone" (ou "contato_id").');
        const tel = normalizarTelefone(d.telefone);
        ids = await contatosDoTelefone(c, tel);
        if (!ids.length) {
          if (!parar) return { ok: true, contato_id: null, parar: false, desde: null, motivo: null, por: null };
          ids = [await contatoDoTelefone(c, chave, tel, null)];
        }
      }
      // Marcar de novo não muda a data nem o motivo originais; desmarcar limpa tudo.
      const r = parar
        ? await c.query(
          `update contatos set automaticas_paradas_em = coalesce(automaticas_paradas_em, now()),
                  automaticas_motivo = case when automaticas_paradas_em is null then $2 else automaticas_motivo end,
                  automaticas_por = case when automaticas_paradas_em is null then $3 else automaticas_por end,
                  atualizado_em = now()
            where id = any($1::uuid[]) returning id, automaticas_paradas_em, automaticas_motivo, automaticas_por`, [ids, motivo, por])
        : await c.query(
          `update contatos set automaticas_paradas_em = null, automaticas_motivo = null, automaticas_por = null, atualizado_em = now()
            where id = any($1::uuid[]) returning id, automaticas_paradas_em, automaticas_motivo, automaticas_por`, [ids]);
      for (const id of ids) await auditar(c, chave, 'atualizar', 'contatos', id, { automaticas: parar ? 'paradas' : 'liberadas', motivo });
      const primeiro = r.rows.sort((a, b) => String(a.automaticas_paradas_em ?? '').localeCompare(String(b.automaticas_paradas_em ?? '')))[0];
      return {
        ok: true, contato_id: ids[0], contatos: ids, parar,
        desde: parar && primeiro?.automaticas_paradas_em ? new Date(primeiro.automaticas_paradas_em).toISOString() : null,
        motivo: parar ? primeiro?.automaticas_motivo ?? null : null, por: parar ? primeiro?.automaticas_por ?? null : null,
      };
    }, bancoDe(chave));
  } catch (e) { if (e instanceof ErroApi) throw e; if (semTabela(e)) throw falta017(); throw e; }
}

export async function registrarEnvioAutomatico(chave: Chave, corpo: unknown) {
  exigirEscopo(chave, 'crm');
  const d = objeto(corpo);
  const tipo = String(d.tipo ?? '');
  if (!TIPO.test(tipo)) throw new ErroApi(400, 'tipo: letras minúsculas, números e _ (ex.: lembrete_2d, followup_1h).');
  const situacao = String(d.situacao ?? '');
  if (!SITUACOES.includes(situacao)) throw new ErroApi(400, `situacao: ${SITUACOES.join(' | ')}.`);
  const chaveEnvio = texto(d.chave, 200);
  if (!chaveEnvio || chaveEnvio.length < 3) throw new ErroApi(400, 'Informe "chave" (única por envio, ex.: lembrete_2d:FG-9001). Mesma chave atualiza em vez de duplicar.');
  const tel = normalizarTelefone(d.telefone);
  const em = quando(d.quando, 'quando') ?? new Date().toISOString();
  const txt = d.texto === undefined || d.texto === null ? null : String(d.texto).slice(0, 4096) || null;
  const wamid = texto(d.wamid, 200);
  const motivo = texto(d.motivo, 300);
  let servicoRef: { sistema: string; codigo: string } | null = null;
  if (d.servico !== undefined && d.servico !== null) {
    const sv = d.servico as Record<string, unknown>;
    const sistema = texto(sv?.sistema, 40)?.toLowerCase(); const codigo = texto(sv?.codigo_externo, 120);
    if (!sistema || !codigo) throw new ErroApi(400, 'servico: envie {sistema, codigo_externo}.');
    servicoRef = { sistema, codigo };
  }
  const por = chave.usuario_id ? chave.nome : (texto(d.por, 80) ?? chave.nome);
  try {
    return await transacao(async (c) => {
      const contatoId = await contatoDoTelefone(c, chave, tel, texto(d.nome, 120));
      let servicoId: string | null = null;
      if (servicoRef) {
        // Banco sem a 013: o envio entra sem o agendamento ligado (sem derrubar a transação).
        const tem = await c.query(`select to_regclass('servicos') is not null as tem`);
        if (tem.rows[0]?.tem) {
          const s = await c.query('select id from servicos where sistema = $1 and codigo_externo = $2', [servicoRef.sistema, servicoRef.codigo]);
          servicoId = s.rows[0]?.id ?? null;
        }
      }
      const r = await c.query(
        `insert into envios_automaticos (contato_id, telefone, tipo, situacao, motivo, texto, wamid, quando, servico_id, chave, criado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (chave) do update set situacao = excluded.situacao, motivo = excluded.motivo,
                texto = coalesce(excluded.texto, envios_automaticos.texto), wamid = coalesce(excluded.wamid, envios_automaticos.wamid),
                quando = excluded.quando, servico_id = coalesce(excluded.servico_id, envios_automaticos.servico_id), atualizado_em = now()
         returning id, contato_id, (xmax = 0) as novo`,
        [contatoId, tel, tipo, situacao, motivo, txt, wamid, em, servicoId, chaveEnvio, por]);
      const x = r.rows[0];
      await auditar(c, chave, x.novo ? 'criar' : 'atualizar', 'envios_automaticos', x.id, { tipo, situacao, chave: chaveEnvio });
      return { ok: true, id: String(x.id), contato_id: String(x.contato_id), repetido: !x.novo, servico_id: servicoId };
    }, bancoDe(chave));
  } catch (e) { if (e instanceof ErroApi) throw e; if (semTabela(e)) throw falta017(); throw e; }
}
