import 'server-only';
import { bancoDaEmpresa, central, ErroApi } from '@/lib/db';
import { pode, type Usuario } from '@/lib/sessao';
import { fuso, mascararTexto } from './crm';
import { auditar } from './gestao';

// Inbox: espelho do WhatsApp, só leitura (fase 1.1). Lê as tabelas wa_* que o receptor (servicos/receptor)
// grava no banco de cada empresa (migração 008). O painel não fala com a Meta e não envia mensagem.
// Nunca vai para o navegador: o caminho do arquivo de mídia, o objeto bruto da Meta e o erro de envio.

function db(u: Usuario) {
  if (!u.empresa) throw new ErroApi(403, 'Escolha uma empresa para abrir a inbox.');
  if (!pode(u, 'inbox.ver')) throw new ErroApi(403, 'Você não tem acesso à inbox nesta empresa.');
  return bancoDaEmpresa(u.empresa);
}

// Banco da empresa sem a migração 008: mensagem clara em vez de erro genérico.
async function consultar<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if ((e as { code?: string }).code === '42P01') {
      throw new ErroApi(503, 'O espelho do WhatsApp ainda não foi instalado no banco desta empresa (migração 008).');
    }
    throw e;
  }
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const JANELA_MS = 24 * 60 * 60 * 1000;
const POR_PAGINA = 100;
const ID_NUMERO = /^[A-Za-z0-9_.:-]{1,64}$/;
const SO_DIGITOS = /^\d{5,20}$/;

// O receptor grava o nome do tipo quando a mensagem não tem texto (resumo da lista); a tela mostra em português.
const RESUMO_TIPO: Record<string, string> = {
  image: 'Foto', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha', location: 'Localização',
  contacts: 'Contato', unsupported: 'Tipo de mensagem não suportado', desconhecido: 'Mensagem da Sara',
};

export type Conversa = {
  numero_id: string; wa_id: string; nome: string | null;
  ultima_em: string | null; ultima_resumo: string | null; ultima_direcao: string | null;
  nao_lidas: number; janela_aberta: boolean;
};
export type ListaConversas = { conversas: Conversa[]; fuso: string; lidoEm: string };

export type Mensagem = {
  id: string; direcao: 'entrada' | 'saida'; origem: 'contato' | 'celular' | 'api' | 'historico' | 'painel';
  tipo: string; texto: string | null; midia: { mime_type: string | null; filename: string | null } | null;
  status: string | null; editada: boolean; apagada: boolean; em: string;
  reacoes: { emoji: string; daEmpresa: boolean }[];
  citada: { encontrada: boolean; tipo: string | null; texto: string | null; direcao: string | null } | null;
};
export type ConversaAberta = { conversa: Conversa; mensagens: Mensagem[]; temMais: boolean; fuso: string };

function limparConversa(u: Usuario, r: Record<string, unknown>): Conversa {
  let resumo = r.ultima_resumo == null ? null : String(r.ultima_resumo);
  if (resumo && RESUMO_TIPO[resumo]) resumo = RESUMO_TIPO[resumo];
  if (resumo && u.master) resumo = mascararTexto(resumo);
  const entrada = r.ultima_entrada_em ? new Date(r.ultima_entrada_em as string).getTime() : 0;
  return {
    numero_id: String(r.numero_id), wa_id: String(r.wa_id), nome: (r.nome as string | null) ?? null,
    ultima_em: iso(r.ultima_em), ultima_resumo: resumo, ultima_direcao: (r.ultima_direcao as string | null) ?? null,
    nao_lidas: Number(r.nao_lidas) || 0, janela_aberta: entrada > 0 && Date.now() - entrada < JANELA_MS,
  };
}

const SELECT_CONVERSA = `
  select c.numero_id, c.wa_id, coalesce(nullif(k.nome_salvo, ''), nullif(k.nome_perfil, '')) as nome,
         c.ultima_em, c.ultima_resumo, c.ultima_direcao, c.ultima_entrada_em, c.nao_lidas
    from wa_conversas c left join wa_contatos k on k.numero_id = c.numero_id and k.wa_id = c.wa_id`;

export async function listarConversas(u: Usuario, busca?: string): Promise<ListaConversas> {
  const q = String(busca ?? '').trim().slice(0, 80);
  // Busca pelo nome (sem curinga vindo da tela) ou pelos dígitos do número (3 ou mais).
  const nome = q.replace(/[\\%_]/g, (x) => '\\' + x);
  const dig = q.replace(/\D/g, '');
  const r = await consultar(() => db(u).query(
    `${SELECT_CONVERSA}
      where not c.arquivada
        and ($1 = '' or coalesce(k.nome_salvo, '') ilike '%' || $1 || '%' or coalesce(k.nome_perfil, '') ilike '%' || $1 || '%'
             or (length($2) >= 3 and c.wa_id like '%' || $2 || '%'))
      order by c.ultima_em desc nulls last limit 300`, [nome, dig]));
  return { conversas: r.rows.map((x) => limparConversa(u, x)), fuso: fuso(), lidoEm: new Date().toISOString() };
}

function validar(numeroId: string, waId: string) {
  if (!ID_NUMERO.test(String(numeroId ?? '')) || !SO_DIGITOS.test(String(waId ?? ''))) throw new ErroApi(400, 'Conversa inválida.');
}

async function lerConversaResumo(u: Usuario, numeroId: string, waId: string): Promise<Conversa> {
  const r = await consultar(() => db(u).query(`${SELECT_CONVERSA} where c.numero_id = $1 and c.wa_id = $2`, [numeroId, waId]));
  if (!r.rowCount) throw new ErroApi(404, 'Conversa não encontrada.');
  return limparConversa(u, r.rows[0]);
}

// Acesso do master (Planee) a uma conversa fica na auditoria central: só o número da empresa e os 4 últimos
// dígitos do contato, nunca o telefone inteiro nem o conteúdo. Uma linha por pessoa e conversa a cada 30 min,
// para a atualização automática da tela não encher a auditoria.
async function registrarAcessoDoMaster(u: Usuario, numeroId: string, waId: string) {
  if (!u.master || !u.empresa) return;
  const alvo = `${numeroId}:${waId.slice(-4)}`;
  const c = central();
  const ja = await c.query(
    `select 1 from central_auditoria where usuario_id = $1 and empresa_id = $2 and acao = 'abrir_conversa' and alvo = $3
        and quando > now() - interval '30 minutes' limit 1`, [u.id, u.empresa.id, alvo]);
  if (!ja.rowCount) await auditar(c, u, u.empresa.id, 'abrir_conversa', alvo, undefined);
}

export async function lerConversa(u: Usuario, numeroId: string, waId: string, antesDeId?: string | null): Promise<ConversaAberta> {
  validar(numeroId, waId);
  if (antesDeId != null && !/^\d{1,18}$/.test(String(antesDeId))) throw new ErroApi(400, 'Página inválida.');
  const conversa = await lerConversaResumo(u, numeroId, waId);
  const banco = db(u);
  // Página mais recente, ou a anterior a uma mensagem (mesma ordem da tela: horário da Meta e id).
  const r = await consultar(() => banco.query(
    `select m.id::text as id, m.wamid, m.direcao, m.origem, m.tipo, m.texto, m.resposta_a, m.status,
            m.midia->>'mime_type' as mime_type, m.midia->>'filename' as filename, (m.midia is not null) as tem_midia,
            m.editada_em, m.apagada_em, m.enviada_em
       from wa_mensagens m
      where m.numero_id = $1 and m.wa_id = $2 and m.tipo <> 'reaction'
        and ($3::bigint is null or (m.enviada_em, m.id) < (select a.enviada_em, a.id from wa_mensagens a
                                                            where a.id = $3::bigint and a.numero_id = $1 and a.wa_id = $2))
      order by m.enviada_em desc, m.id desc limit $4`, [numeroId, waId, antesDeId ?? null, POR_PAGINA + 1]));
  const temMais = r.rows.length > POR_PAGINA;
  const linhas = r.rows.slice(0, POR_PAGINA).reverse();

  const wamids = linhas.map((m) => m.wamid as string);
  const citados = [...new Set(linhas.map((m) => m.resposta_a as string | null).filter((x): x is string => Boolean(x)))];
  const [reacoes, citadas] = await Promise.all([
    wamids.length
      ? banco.query(`select wamid, autor, emoji from wa_reacoes where numero_id = $1 and wamid = any($2::text[]) order by em`, [numeroId, wamids])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    citados.length
      ? banco.query(`select wamid, tipo, left(texto, 160) as texto, direcao from wa_mensagens where numero_id = $1 and wamid = any($2::text[])`, [numeroId, citados])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  const porWamid = new Map<string, Mensagem['reacoes']>();
  for (const x of reacoes.rows) {
    const l = porWamid.get(String(x.wamid)) ?? [];
    l.push({ emoji: String(x.emoji), daEmpresa: x.autor === 'empresa' });
    porWamid.set(String(x.wamid), l);
  }
  const mascarar = (t: string | null) => (t && u.master ? mascararTexto(t) : t);
  const citadaPor = new Map(citadas.rows.map((x) => [String(x.wamid), x]));

  const mensagens: Mensagem[] = linhas.map((m) => {
    const cit = m.resposta_a ? citadaPor.get(String(m.resposta_a)) : undefined;
    return {
      id: String(m.id), direcao: m.direcao, origem: m.origem, tipo: String(m.tipo),
      texto: mascarar(m.texto == null ? null : String(m.texto)),
      midia: m.tem_midia ? { mime_type: m.mime_type ?? null, filename: m.filename ?? null } : null,
      status: m.direcao === 'saida' ? (m.status ?? null) : null,
      editada: Boolean(m.editada_em), apagada: Boolean(m.apagada_em), em: iso(m.enviada_em) as string,
      reacoes: porWamid.get(String(m.wamid)) ?? [],
      citada: m.resposta_a
        ? cit
          ? { encontrada: true, tipo: String(cit.tipo), texto: mascarar(cit.texto == null ? null : String(cit.texto)), direcao: String(cit.direcao) }
          : { encontrada: false, tipo: null, texto: null, direcao: null }
        : null,
    };
  });

  await registrarAcessoDoMaster(u, numeroId, waId);
  return { conversa, mensagens, temMais, fuso: fuso() };
}

// A equipe da empresa abriu a conversa: zera as não lidas. O master (Planee) só olha: não muda o estado da clínica.
export async function marcarLida(u: Usuario, numeroId: string, waId: string) {
  validar(numeroId, waId);
  const banco = db(u);
  if (u.master) return;
  await consultar(() => banco.query(
    `update wa_conversas set nao_lidas = 0, lida_ate = now()
      where numero_id = $1 and wa_id = $2 and (nao_lidas <> 0 or lida_ate is null or lida_ate < ultima_em)`, [numeroId, waId]));
}
