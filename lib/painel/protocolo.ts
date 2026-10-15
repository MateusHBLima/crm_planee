import 'server-only';
import { bancoDaEmpresa, ErroApi } from '@/lib/db';
import * as api from '@/lib/api/servico';
import { atorDe, pode, type Usuario } from '@/lib/sessao';
import { ehSituacao, type Situacao } from '@/lib/protocolo-nomes';
import { chaveTelefone, normalizarTelefone, SQL_MESMO_TELEFONE } from '@/lib/telefone';
import { garantirContato, mascararTexto } from './crm';

// Acompanhamento de protocolo (14/10, pedido da Letícia): quem está em análise, em protocolo, em acompanhamento ou
// já encerrou com o Doutor, num lugar só. A equipe marca à mão (quem edita o quadro, crm.editar); a IA pode marcar
// pela API (PATCH /api/v1/contatos/{id} com "protocolo"). Fica no próprio contato (migração 025): situação,
// observação, desde quando e quem marcou. O histórico de cada mudança fica na auditoria, como todo o CRM.

export type LinhaProtocolo = {
  id: string; nome: string | null; telefone: string | null;
  situacao: Situacao; obs: string | null; desde: string | null; por: string | null;
  abertos: number; // atendimentos em aberto no quadro
};
export type Protocolos = { lista: LinhaProtocolo[]; instalado: boolean };
export type ProtocoloDoContato = { situacao: string; obs: string | null; desde: string | null; por: string | null } | null;
// Protocolo de um contato só, achado pelo id (cartão do CRM) ou pelo telefone (conversa da Inbox; o dono do número).
// contatoId null = o número ainda não tem contato no CRM (marcar cria).
export type ProtocoloContato = { contatoId: string | null; nome: string | null; protocolo: ProtocoloDoContato };
export type Alvo = { id?: string | null; telefone?: string | null; nome?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function banco(u: Usuario) {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir o CRM.');
  if (!pode(u, 'crm.ver')) throw new ErroApi(403, 'Você não tem acesso ao CRM nesta empresa.');
  return bancoDaEmpresa(u.empresa);
}

export async function lerProtocolos(u: Usuario): Promise<Protocolos> {
  const b = banco(u);
  try {
    const r = await b.query(
      `select c.id, c.nome, c.telefone, c.protocolo, c.protocolo_obs, c.protocolo_em, c.protocolo_por,
              (select count(*) from atendimentos a where a.contato_id = c.id and not a.arquivado and a.etapa <> 'finalizado')::int as abertos
         from contatos c
        where not c.arquivado and c.protocolo is not null
        order by (c.protocolo = 'encerrado'), c.protocolo_em desc nulls last limit 2000`);
    return {
      instalado: true,
      lista: r.rows.filter((x) => ehSituacao(x.protocolo)).map((x) => ({
        id: String(x.id), nome: (x.nome as string | null) ?? null, telefone: (x.telefone as string | null) ?? null,
        situacao: x.protocolo as Situacao,
        obs: x.protocolo_obs ? (u.master ? mascararTexto(String(x.protocolo_obs)) : String(x.protocolo_obs)) : null,
        desde: x.protocolo_em ? new Date(x.protocolo_em).toISOString() : null, por: (x.protocolo_por as string | null) ?? null,
        abertos: Number(x.abertos) || 0,
      })),
    };
  } catch (e) {
    // Banco da empresa ainda sem a migração 025: a aba avisa em vez de dar erro.
    if ((e as { code?: string }).code === '42703') return { instalado: false, lista: [] };
    throw e;
  }
}

export async function protocoloDoContato(u: Usuario, alvo: Alvo): Promise<ProtocoloContato> {
  const b = banco(u);
  const id = alvo.id && UUID.test(String(alvo.id)) ? String(alvo.id) : null;
  let params: unknown[];
  let onde: string;
  if (id) { onde = 'id = $1'; params = [id]; }
  else {
    let tel: string;
    try { tel = normalizarTelefone(alvo.telefone); } catch { return { contatoId: null, nome: alvo.nome ?? null, protocolo: null }; }
    onde = SQL_MESMO_TELEFONE('telefone', 1, 2); params = chaveTelefone(tel);
  }
  // to_jsonb: banco sem a migração 025 devolve protocolo null em vez de erro.
  const r = await b.query(
    `select id, nome, to_jsonb(c) ->> 'protocolo' as protocolo, to_jsonb(c) ->> 'protocolo_obs' as obs,
            to_jsonb(c) ->> 'protocolo_em' as em, to_jsonb(c) ->> 'protocolo_por' as por
       from contatos c where not arquivado and ${onde} order by criado_em limit 1`, params);
  const x = r.rows[0];
  if (!x) return { contatoId: null, nome: alvo.nome ?? null, protocolo: null };
  return {
    contatoId: String(x.id), nome: (x.nome as string | null) ?? null,
    protocolo: x.protocolo && ehSituacao(x.protocolo) ? {
      situacao: String(x.protocolo), obs: x.obs ? (u.master ? mascararTexto(String(x.obs)) : String(x.obs)) : null,
      desde: x.em ? new Date(x.em).toISOString() : null, por: (x.por as string | null) ?? null,
    } : null,
  };
}

// Pelo cartão ou pela conversa: acha o contato (ou cria pelo telefone, com o nome da conversa) e marca.
export async function marcarProtocoloDe(u: Usuario, alvo: Alvo, situacao: unknown, obs?: unknown): Promise<{ lista: Protocolos; contato: ProtocoloContato }> {
  banco(u);
  if (!pode(u, 'crm.editar')) throw new ErroApi(403, 'Você não tem permissão para isso nesta empresa.');
  let id = alvo.id && UUID.test(String(alvo.id)) ? String(alvo.id) : (await protocoloDoContato(u, alvo)).contatoId;
  if (!id) {
    if (situacao === null || situacao === '') throw new ErroApi(404, 'Este número não tem contato no CRM.');
    id = await garantirContato(u, alvo.telefone, alvo.nome);
  }
  const lista = await marcarProtocolo(u, id, situacao, obs);
  return { lista, contato: await protocoloDoContato(u, { id }) };
}

// Muda a situação (null tira do protocolo) e, se veio, a observação. Passa pela API, com auditoria; a API grava
// protocolo_em e protocolo_por quando a situação muda.
export async function marcarProtocolo(u: Usuario, contatoId: string, situacao: unknown, obs?: unknown): Promise<Protocolos> {
  banco(u);
  if (!pode(u, 'crm.editar')) throw new ErroApi(403, 'Você não tem permissão para isso nesta empresa.');
  if (!UUID.test(String(contatoId))) throw new ErroApi(404, 'Contato não encontrado.');
  const s = situacao === null || situacao === '' ? null : situacao;
  if (s !== null && !ehSituacao(s)) throw new ErroApi(400, 'Situação inválida.');
  const dados: Record<string, unknown> = { protocolo: s };
  if (obs !== undefined) {
    const o = String(obs ?? '').trim();
    if (o.length > 500) throw new ErroApi(400, 'A observação pode ter até 500 caracteres.');
    dados.protocolo_obs = o || null;
  }
  // Tirar do protocolo apaga a observação junto (a auditoria guarda a anterior).
  if (s === null) dados.protocolo_obs = null;
  try {
    await api.atualizar(atorDe(u), 'contatos', contatoId, dados);
  } catch (e) {
    if ((e as { code?: string }).code === '42703') throw new ErroApi(503, 'Falta instalar o acompanhamento de protocolo no banco desta empresa (migração 025).');
    throw e;
  }
  return lerProtocolos(u);
}
