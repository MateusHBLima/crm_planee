import 'server-only';
import { randomBytes } from 'node:crypto';
import { bancoDaEmpresa, central, ErroApi, registrarErro, transacao } from '@/lib/db';
import { atorDe, pode, type Usuario } from '@/lib/sessao';
import * as api from '@/lib/api/servico';
import { chaveTelefone, normalizarTelefone, SQL_MESMO_TELEFONE } from '@/lib/telefone';
import { fuso, mascararTexto } from './crm';
import { auditar } from './gestao';
import { completarFalasDaIa } from './falas-ia';
import { seloDoTelefone, type Selo } from '@/lib/automaticas';

// Inbox: espelho do WhatsApp (fase 1.1) e resposta pelo painel (fase 2.3). Lê as tabelas wa_* que o receptor
// (servicos/receptor) grava no banco de cada empresa (migração 008). O painel não fala com a Meta: a resposta vai
// para o webhook do n8n, que envia e avisa o receptor, e é o receptor que grava a mensagem no espelho.
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
    if ((e as { code?: string }).code === '42703') {
      throw new ErroApi(503, 'Falta atualizar o espelho do WhatsApp no banco desta empresa (migrações 009 e 010).');
    }
    throw e;
  }
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const JANELA_MS = 24 * 60 * 60 * 1000;
const POR_PAGINA = 100;
const ID_NUMERO = /^[A-Za-z0-9_.:-]{1,64}$/;
const SO_DIGITOS = /^\d{5,20}$/;
// Minutos que a Sara fica quieta depois de resposta pelo celular (o receptor usa a mesma variável).
const PAUSA_CELULAR_MS = () => (Number(process.env.SARA_PAUSA_CELULAR_MIN) || 7) * 60_000;

// O receptor grava o nome do tipo quando a mensagem não tem texto (resumo da lista); a tela mostra em português.
const RESUMO_TIPO: Record<string, string> = {
  image: 'Foto', video: 'Vídeo', audio: 'Áudio', document: 'Documento', sticker: 'Figurinha', location: 'Localização',
  contacts: 'Contato', unsupported: 'Tipo de mensagem não suportado', desconhecido: 'Mensagem da Sara',
};

// Quem atende: 'ia' (Sara) ou 'humano' (equipe assumiu no painel). pausa_ate: a equipe respondeu pelo celular e
// a Sara fica quieta até esse horário (mesma regra do receptor, GET /whatsapp/atendimento).
export type Conversa = {
  numero_id: string; wa_id: string; nome: string | null;
  ultima_em: string | null; ultima_resumo: string | null; ultima_direcao: string | null;
  nao_lidas: number; janela_aberta: boolean;
  dono: 'ia' | 'humano'; dono_por: string | null; dono_em: string | null; pausa_ate: string | null;
};
// linhas: nome de cada número da empresa (quando ela tem mais de um), para a lista mostrar por qual linha veio.
export type ListaConversas = { conversas: Conversa[]; fuso: string; lidoEm: string; linhas: Record<string, string> | null };

export type Mensagem = {
  id: string; wamid: string; por: string | null; direcao: 'entrada' | 'saida'; origem: 'contato' | 'celular' | 'api' | 'historico' | 'painel';
  tipo: string; texto: string | null;
  // pronta: o receptor já baixou o arquivo (dá para ouvir, ver ou baixar); erro: a Meta não entregou o arquivo.
  midia: { mime_type: string | null; filename: string | null; pronta: boolean; erro: boolean } | null;
  status: string | null; editada: boolean; apagada: boolean; em: string;
  reacoes: { emoji: string; daEmpresa: boolean }[];
  citada: { encontrada: boolean; tipo: string | null; texto: string | null; direcao: string | null } | null;
};
// selo: mensagens automáticas da IA (follow-up, recusa), migração 017; null sem selo ou sem a 017.
export type ConversaAberta = { conversa: Conversa; mensagens: Mensagem[]; temMais: boolean; fuso: string; selo: Selo | null };

function limparConversa(u: Usuario, r: Record<string, unknown>): Conversa {
  let resumo = r.ultima_resumo == null ? null : String(r.ultima_resumo);
  if (resumo && RESUMO_TIPO[resumo]) resumo = RESUMO_TIPO[resumo];
  if (resumo && u.master) resumo = mascararTexto(resumo);
  const entrada = r.ultima_entrada_em ? new Date(r.ultima_entrada_em as string).getTime() : 0;
  const pausa = r.celular_em ? new Date(r.celular_em as string).getTime() + PAUSA_CELULAR_MS() : 0;
  return {
    numero_id: String(r.numero_id), wa_id: String(r.wa_id), nome: (r.nome as string | null) ?? null,
    ultima_em: iso(r.ultima_em), ultima_resumo: resumo, ultima_direcao: (r.ultima_direcao as string | null) ?? null,
    nao_lidas: Number(r.nao_lidas) || 0, janela_aberta: entrada > 0 && Date.now() - entrada < JANELA_MS,
    dono: r.dono === 'humano' ? 'humano' : 'ia', dono_por: (r.dono_por as string | null) ?? null, dono_em: iso(r.dono_em),
    pausa_ate: pausa > Date.now() ? new Date(pausa).toISOString() : null,
  };
}

const SELECT_CONVERSA = `
  select c.numero_id, c.wa_id, coalesce(nullif(k.nome_painel, ''), nullif(k.nome_salvo, ''), nullif(k.nome_perfil, '')) as nome,
         c.ultima_em, c.ultima_resumo, c.ultima_direcao, c.ultima_entrada_em, c.nao_lidas, c.dono, c.dono_por, c.dono_em,
         (select max(m.enviada_em) from wa_mensagens m
           where m.numero_id = c.numero_id and m.wa_id = c.wa_id and m.origem = 'celular') as celular_em
    from wa_conversas c left join wa_contatos k on k.numero_id = c.numero_id and k.wa_id = c.wa_id`;

// Filtro "Em follow-up": o contato recebeu follow-up da IA nos últimos 31 dias e não respondeu depois (migração 017).
const SQL_EM_FOLLOWUP = `
        and exists (select 1 from envios_automaticos e join contatos ct on ct.id = e.contato_id
                     where e.tipo like 'followup%' and e.situacao = 'enviado' and e.quando > now() - interval '31 days'
                       and ct.automaticas_paradas_em is null
                       and substr(regexp_replace(e.telefone, '\\D', '', 'g'), 3, 2) = substr(c.wa_id, 3, 2)
                       and right(regexp_replace(e.telefone, '\\D', '', 'g'), 8) = right(c.wa_id, 8)
                       and e.quando > coalesce(c.ultima_entrada_em, '-infinity'::timestamptz))`;

export async function listarConversas(u: Usuario, busca?: string, filtro?: string | null): Promise<ListaConversas> {
  const q = String(busca ?? '').trim().slice(0, 80);
  // Busca pelo nome (sem curinga vindo da tela) ou pelos dígitos do número (3 ou mais).
  const nome = q.replace(/[\\%_]/g, (x) => '\\' + x);
  const dig = q.replace(/\D/g, '');
  const followup = filtro === 'followup';
  let r;
  // Os números da empresa (banco central) vêm junto, em paralelo: com um número só, a tela não mostra a linha.
  const linhas = linhasDaEmpresa(u);
  try {
    r = await consultar(() => db(u).query(
      `${SELECT_CONVERSA}
        where not c.arquivada
          and ($1 = '' or coalesce(k.nome_painel, '') ilike '%' || $1 || '%'
               or coalesce(k.nome_salvo, '') ilike '%' || $1 || '%' or coalesce(k.nome_perfil, '') ilike '%' || $1 || '%'
               or (length($2) >= 3 and c.wa_id like '%' || $2 || '%'))${followup ? SQL_EM_FOLLOWUP : ''}
        order by c.ultima_em desc nulls last limit 300`, [nome, dig]));
  } catch (e) {
    // Banco ainda sem a 017: o filtro de follow-up volta vazio, em vez de erro.
    if (followup && ['42P01', '42703'].includes((e as { code?: string }).code ?? '')) return { conversas: [], fuso: fuso(), lidoEm: new Date().toISOString(), linhas: await linhas };
    throw e;
  }
  return { conversas: r.rows.map((x) => limparConversa(u, x)), fuso: fuso(), lidoEm: new Date().toISOString(), linhas: await linhas };
}

// Números cadastrados da empresa (banco central). Com um só, a tela não mostra etiqueta de linha.
async function linhasDaEmpresa(u: Usuario): Promise<Record<string, string> | null> {
  try {
    const r = await central().query(
      `select n.phone_number_id as id, coalesce(nullif(n.nome, ''), nullif(to_jsonb(n)->>'verificado_nome', ''), n.telefone, n.phone_number_id) as nome
         from whatsapp_numeros n where n.empresa_id = $1`, [u.empresa!.id]);
    return r.rowCount && r.rowCount > 1 ? Object.fromEntries(r.rows.map((x) => [String(x.id), String(x.nome)])) : null;
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return null;
    throw e;
  }
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

// Abrir a conversa (09/10): uma ida ao banco traz o resumo da conversa, a página de mensagens, as reações e as
// citadas; depois, em paralelo, o texto da Sara que faltava, o selo, o "lida" e o registro de acesso do master.
// Antes eram ~8 idas em fila (~2 s com o banco em outra região); agora são 2.
export async function lerConversa(u: Usuario, numeroId: string, waId: string, antesDeId?: string | null, opcoes: { marcar?: boolean } = {}): Promise<ConversaAberta> {
  validar(numeroId, waId);
  if (antesDeId != null && !/^\d{1,18}$/.test(String(antesDeId))) throw new ErroApi(400, 'Página inválida.');
  const banco = db(u);
  // Página mais recente, ou a anterior a uma mensagem (mesma ordem da tela: horário da Meta e id).
  const r = await consultar(() => banco.query(
    `with conv as (${SELECT_CONVERSA} where c.numero_id = $1 and c.wa_id = $2),
     pag as (
       select m.id, m.wamid, m.direcao, case when m.origem = 'painel' then left(m.bruto->>'por', 80) end as por, m.origem, m.tipo, m.texto, m.resposta_a, m.status,
              m.midia->>'mime_type' as mime_type, m.midia->>'filename' as filename, (m.midia is not null) as tem_midia,
              (m.midia->>'caminho') is not null as midia_pronta, (m.midia->>'erro') is not null as midia_erro,
              m.editada_em, m.apagada_em, m.enviada_em, coalesce(m.bruto->>'texto_de', '') as texto_de
         from wa_mensagens m
        where exists (select 1 from conv) and m.numero_id = $1 and m.wa_id = $2 and m.tipo <> 'reaction'
          and ($3::bigint is null or (m.enviada_em, m.id) < (select a.enviada_em, a.id from wa_mensagens a
                                                              where a.id = $3::bigint and a.numero_id = $1 and a.wa_id = $2))
        order by m.enviada_em desc, m.id desc limit $4)
     select (select row_to_json(conv) from conv) as conversa,
            coalesce((select json_agg(json_build_object('id', p.id::text, 'wamid', p.wamid, 'direcao', p.direcao, 'por', p.por, 'origem', p.origem,
                        'tipo', p.tipo, 'texto', p.texto, 'resposta_a', p.resposta_a, 'status', p.status, 'mime_type', p.mime_type,
                        'filename', p.filename, 'tem_midia', p.tem_midia, 'midia_pronta', p.midia_pronta, 'midia_erro', p.midia_erro, 'editada_em', p.editada_em, 'apagada_em', p.apagada_em,
                        'enviada_em', p.enviada_em, 'texto_de', p.texto_de) order by p.enviada_em desc, p.id desc) from pag p), '[]'::json) as msgs,
            coalesce((select json_agg(x) from (select wamid, autor, emoji from wa_reacoes
                        where numero_id = $1 and wamid in (select wamid from pag) order by em) x), '[]'::json) as reacoes,
            coalesce((select json_agg(x) from (select wamid, tipo, left(texto, 160) as texto, direcao from wa_mensagens
                        where numero_id = $1 and wamid in (select resposta_a from pag where resposta_a is not null)) x), '[]'::json) as citadas`,
    [numeroId, waId, antesDeId ?? null, POR_PAGINA + 1]));
  const x = r.rows[0] ?? {};
  if (!x.conversa) throw new ErroApi(404, 'Conversa não encontrada.');
  const conversa = limparConversa(u, x.conversa as Record<string, unknown>);
  const todas = x.msgs as Record<string, unknown>[];
  const temMais = todas.length > POR_PAGINA;
  const linhas = todas.slice(0, POR_PAGINA).reverse();
  const primeira = !antesDeId;
  const marcar = Boolean(opcoes.marcar) && primeira && !u.master;
  const entrada = (x.conversa as Record<string, unknown>).ultima_entrada_em;

  // Em paralelo: o texto da Sara que faltava (lib/painel/falas-ia.ts), o selo das automáticas (só na primeira página),
  // o "lida" da equipe e o registro de acesso do master. Selo e registro são extras: falha neles não derruba a tela.
  const [, seloBruto] = await Promise.all([
    completarFalasDaIa(banco, waId, linhas),
    primeira
      ? seloDoTelefone(banco, waId, entrada ? new Date(entrada as string).toISOString() : null).catch((e) => { registrarErro('selo das automáticas', e); return null; })
      : Promise.resolve(null),
    marcar ? marcarLida(u, numeroId, waId) : Promise.resolve(),
    registrarAcessoDoMaster(u, numeroId, waId),
  ]);
  if (marcar) conversa.nao_lidas = 0;
  const selo: Selo | null = seloBruto && u.master ? { ...seloBruto, texto: mascararTexto(seloBruto.texto) } : seloBruto;

  const porWamid = new Map<string, Mensagem['reacoes']>();
  for (const y of x.reacoes as Record<string, unknown>[]) {
    const l = porWamid.get(String(y.wamid)) ?? [];
    l.push({ emoji: String(y.emoji), daEmpresa: y.autor === 'empresa' });
    porWamid.set(String(y.wamid), l);
  }
  const mascarar = (t: string | null) => (t && u.master ? mascararTexto(t) : t);
  const citadaPor = new Map((x.citadas as Record<string, unknown>[]).map((y) => [String(y.wamid), y]));

  const mensagens: Mensagem[] = linhas.map((m) => {
    const cit = m.resposta_a ? citadaPor.get(String(m.resposta_a)) : undefined;
    return {
      id: String(m.id), wamid: String(m.wamid), por: (m.por as string | null) ?? null, direcao: m.direcao as Mensagem['direcao'], origem: m.origem as Mensagem['origem'], tipo: String(m.tipo),
      texto: mascarar(m.texto == null ? null : String(m.texto)),
      midia: m.tem_midia ? { mime_type: (m.mime_type as string | null) ?? null, filename: (m.filename as string | null) ?? null, pronta: Boolean(m.midia_pronta), erro: Boolean(m.midia_erro) } : null,
      status: m.direcao === 'saida' ? ((m.status as string | null) ?? null) : null,
      editada: Boolean(m.editada_em), apagada: Boolean(m.apagada_em), em: iso(m.enviada_em) as string,
      reacoes: porWamid.get(String(m.wamid)) ?? [],
      citada: m.resposta_a
        ? cit
          ? { encontrada: true, tipo: String(cit.tipo), texto: mascarar(cit.texto == null ? null : String(cit.texto)), direcao: String(cit.direcao) }
          : { encontrada: false, tipo: null, texto: null, direcao: null }
        : null,
    };
  });
  return { conversa, mensagens, temMais, fuso: fuso(), selo };
}

// ---- Ouvir, ver e baixar as mídias (áudio, foto, vídeo, documento) ----
// O arquivo fica no Storage (o receptor baixa da Meta). A tela pede um link curto: aqui se confere a sessão, a empresa
// e a conversa, e grava-se na central um token aleatório que vale 10 min; o receptor entrega o arquivo por ele.
// O caminho do arquivo nunca vai para o navegador.
const LINK_MIDIA_MIN = 10;
const baseReceptor = () => (process.env.RECEPTOR_URL || `https://${process.env.PAINEL_HOST_ADM || 'adm.planeelabia.com'}`).replace(/\/+$/, '');

export async function linkDaMidia(u: Usuario, numeroId: string, waId: string, mensagemId: string): Promise<{ url: string; mime: string | null }> {
  validar(numeroId, waId);
  if (!/^\d{1,18}$/.test(String(mensagemId ?? ''))) throw new ErroApi(400, 'Mensagem inválida.');
  const r = await consultar(() => db(u).query(
    `select m.midia->>'caminho' as caminho, m.midia->>'mime_type' as mime, (m.midia->>'erro') is not null as erro
       from wa_mensagens m where m.id = $1 and m.numero_id = $2 and m.wa_id = $3 and m.midia is not null`, [mensagemId, numeroId, waId]));
  const x = r.rows[0];
  if (!x) throw new ErroApi(404, 'Mídia não encontrada.');
  if (!x.caminho) throw new ErroApi(409, x.erro ? 'A Meta não entregou este arquivo.' : 'O arquivo ainda está sendo baixado. Tente em alguns segundos.');
  // O receptor grava cada arquivo na pasta da empresa dona do número: arquivo de outra empresa não sai daqui.
  if (!String(x.caminho).startsWith(`${u.empresa!.id}/`)) throw new ErroApi(404, 'Mídia não encontrada.');
  const token = randomBytes(24).toString('base64url');
  const mime = x.mime ? String(x.mime).split(';')[0].trim().slice(0, 100) || null : null;
  try {
    await central().query(
      `insert into wa_midia_links (token, empresa_id, caminho, mime, expira_em) values ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
      [token, u.empresa!.id, x.caminho, mime, LINK_MIDIA_MIN]);
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') throw new ErroApi(503, 'Falta a migração 011 no banco central para abrir as mídias.');
    throw e;
  }
  if (u.master) await auditar(central(), u, u.empresa!.id, 'abrir_midia', `${numeroId}:${waId.slice(-4)}`, undefined);
  return { url: `${baseReceptor()}/whatsapp/midia/${token}`, mime };
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

// ---- Responder pelo painel (fase 2.3) ----

const ENVIO_MS = 15000;
const MAX_TEXTO = 4096;
const WAMID = /^[A-Za-z0-9_.=:+/-]{1,200}$/;
export const MSG_FORA_DA_JANELA = 'Fora da janela de 24 h: a Meta só permite modelo aprovado. Responda pelo celular ou espere o paciente escrever.';

// Manda a resposta ao webhook do n8n (painel_enviar), que envia pela Meta e registra no receptor.
// Só dentro da janela de 24 h (fora dela a Meta exige modelo aprovado). Toda tentativa vai para a auditoria
// central, sem o texto. Erro do n8n ou da Meta volta como mensagem curta, sem repassar o corpo da resposta.
export async function enviarMensagem(u: Usuario, numeroId: string, waId: string, texto: string): Promise<{ wamid: string }> {
  validar(numeroId, waId);
  const banco = db(u);
  if (!pode(u, 'inbox.responder')) throw new ErroApi(403, 'Você não tem permissão para responder pelo painel nesta empresa.');
  const t = String(texto ?? '').trim();
  if (!t) throw new ErroApi(400, 'Escreva a mensagem antes de enviar.');
  if (t.length > MAX_TEXTO) throw new ErroApi(400, 'A mensagem passou de 4.096 caracteres.');

  const r = await consultar(() => banco.query(`select ultima_entrada_em from wa_conversas where numero_id = $1 and wa_id = $2`, [numeroId, waId]));
  if (!r.rowCount) throw new ErroApi(404, 'Conversa não encontrada.');
  const entrada = r.rows[0].ultima_entrada_em ? new Date(r.rows[0].ultima_entrada_em).getTime() : 0;
  if (!entrada) throw new ErroApi(409, 'Este contato ainda não escreveu para a clínica: a Meta só permite começar a conversa com modelo aprovado. Responda pelo celular.');
  if (Date.now() - entrada >= JANELA_MS) throw new ErroApi(409, MSG_FORA_DA_JANELA);

  const url = process.env.N8N_WEBHOOK_PAINEL_ENVIAR;
  if (!url) throw new ErroApi(503, 'Envio pelo painel ainda não configurado.');

  // Quem responde pelo painel assume a conversa: a Sara não fala junto. Devolver é um clique.
  await assumirAoEnviar(u, banco, numeroId, waId);

  const alvo = `${numeroId}:${waId.slice(-4)}`;
  const registrar = (resultado: string) => auditar(central(), u, u.empresa!.id, 'enviar_mensagem', alvo, { resultado }).catch(() => undefined);
  const ctrl = new AbortController();
  const tempo = setTimeout(() => ctrl.abort(), ENVIO_MS);
  let resposta: { ok?: unknown; wamid?: unknown; erro?: unknown } | null = null;
  let status = 0;
  try {
    const x = await fetch(url, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-painel-segredo': process.env.N8N_WEBHOOK_SEGREDO || '' },
      body: JSON.stringify({ evento: 'painel_enviar', empresa: u.empresa!.id, numero_id: numeroId, para: waId, texto: t, por: u.nome, usuario_id: u.id }),
    });
    status = x.status;
    resposta = await x.json().catch(() => null);
  } catch (e) {
    await registrar('sem_resposta');
    throw new ErroApi(502, (e as { name?: string }).name === 'AbortError'
      ? 'O envio demorou demais e não foi confirmado. Confira no WhatsApp antes de mandar de novo.'
      : 'Não foi possível falar com o serviço de envio. Tente de novo em instantes.');
  } finally {
    clearTimeout(tempo);
  }

  if (status >= 200 && status < 300 && resposta?.ok === true && typeof resposta.wamid === 'string' && WAMID.test(resposta.wamid)) {
    await registrar('enviada');
    return { wamid: resposta.wamid };
  }
  await registrar('falhou');
  // Só o código da Meta (números e letras), nunca o resto da resposta.
  const codigo = resposta && resposta.ok === false && resposta.erro != null ? String(resposta.erro).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 20) : '';
  // 131047: a janela de 24 h fechou entre a última leitura e o envio.
  if (codigo === '131047') throw new ErroApi(409, MSG_FORA_DA_JANELA);
  throw new ErroApi(502, codigo ? `A Meta recusou o envio (código ${codigo}).` : 'O serviço de envio não confirmou a mensagem. Tente de novo em instantes.');
}

// ---- Quem atende: assumir e devolver para a Sara (fase 2.1, versão da Inbox) ----

const auditarDono = (u: Usuario, acao: string, numeroId: string, waId: string, extra?: Record<string, unknown>) =>
  auditar(central(), u, u.empresa!.id, acao, `${numeroId}:${waId.slice(-4)}`, extra).catch(() => undefined);

async function assumirAoEnviar(u: Usuario, banco: ReturnType<typeof db>, numeroId: string, waId: string) {
  const r = await consultar(() => banco.query(
    `update wa_conversas set dono = 'humano', dono_em = now(), dono_por = $3
      where numero_id = $1 and wa_id = $2 and dono <> 'humano' returning 1`, [numeroId, waId, u.nome]));
  if (r.rowCount) await auditarDono(u, 'assumir_conversa', numeroId, waId, { ao_enviar: true });
}

// Assumir: a Sara fica quieta nesta conversa até alguém devolver. Devolver: a Sara volta a responder; se a última
// mensagem é do contato, avisa o n8n (N8N_WEBHOOK_PAINEL_RETOMAR) para ela responder já. Só quem pode responder.
export async function mudarDono(u: Usuario, numeroId: string, waId: string, dono: 'ia' | 'humano'): Promise<Conversa> {
  validar(numeroId, waId);
  if (dono !== 'ia' && dono !== 'humano') throw new ErroApi(400, 'Escolha assumir ou devolver.');
  const banco = db(u);
  if (!pode(u, 'inbox.responder')) throw new ErroApi(403, 'Você não tem permissão para atender pelo painel nesta empresa.');
  const r = await consultar(() => banco.query(
    `update wa_conversas set dono = $3, dono_em = now(), dono_por = $4
      where numero_id = $1 and wa_id = $2 and dono <> $3 returning ultima_direcao`, [numeroId, waId, dono, u.nome]));
  if (r.rowCount) {
    await auditarDono(u, dono === 'humano' ? 'assumir_conversa' : 'devolver_conversa', numeroId, waId);
    if (dono === 'ia' && r.rows[0].ultima_direcao === 'entrada') await avisarDevolvida(u, numeroId, waId);
  }
  return lerConversaResumo(u, numeroId, waId);
}

// O aviso é extra: sem o endereço, ou com o n8n fora, a Sara responde na próxima mensagem do contato.
async function avisarDevolvida(u: Usuario, numeroId: string, waId: string) {
  const url = process.env.N8N_WEBHOOK_PAINEL_RETOMAR;
  if (!url) return;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3000);
  await fetch(url, {
    method: 'POST', signal: ctrl.signal,
    headers: { 'content-type': 'application/json', 'x-painel-segredo': process.env.N8N_WEBHOOK_SEGREDO || '' },
    body: JSON.stringify({ evento: 'conversa_devolvida', empresa: u.empresa!.id, numero_id: numeroId, wa_id: waId, por: u.nome }),
  }).catch(() => undefined).finally(() => clearTimeout(t));
}

// ---- Nome do contato corrigido pela equipe ----

const MAX_NOME = 80;

// Troca o nome que o painel mostra. Vazio volta ao nome da agenda do celular ou do perfil do WhatsApp.
// O nome do painel fica em wa_contatos.nome_painel (a sincronização da agenda não mexe nele) e cada troca vai para
// wa_contatos_nomes no banco da empresa. Quem também edita o CRM atualiza junto o contato do CRM com o mesmo
// telefone (pela API do CRM); empresa sem CRM no banco segue só com a Inbox.
export async function renomearContato(u: Usuario, numeroId: string, waId: string, nome: unknown): Promise<Conversa> {
  validar(numeroId, waId);
  const banco = db(u);
  if (!pode(u, 'inbox.responder')) throw new ErroApi(403, 'Você não tem permissão para editar contatos nesta empresa.');
  const n = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (n.length > MAX_NOME) throw new ErroApi(400, `O nome passou de ${MAX_NOME} caracteres.`);
  const novo = n || null;

  const anterior = await consultar(() => transacao(async (c) => {
    const a = await c.query(
      `select coalesce(nullif(k.nome_painel, ''), nullif(k.nome_salvo, ''), nullif(k.nome_perfil, '')) as nome
         from wa_conversas w left join wa_contatos k on k.numero_id = w.numero_id and k.wa_id = w.wa_id
        where w.numero_id = $1 and w.wa_id = $2`, [numeroId, waId]);
    if (!a.rowCount) throw new ErroApi(404, 'Conversa não encontrada.');
    await c.query(
      `insert into wa_contatos (numero_id, wa_id, nome_painel, nome_painel_em, nome_painel_por) values ($1, $2, $3, now(), $4)
       on conflict (numero_id, wa_id) do update set nome_painel = excluded.nome_painel, nome_painel_em = now(),
         nome_painel_por = excluded.nome_painel_por, atualizado_em = now()`, [numeroId, waId, novo, u.nome]);
    await c.query(`insert into wa_contatos_nomes (numero_id, wa_id, anterior, novo, por) values ($1, $2, $3, $4, $5)`,
      [numeroId, waId, a.rows[0].nome ?? null, novo, u.nome]);
    return (a.rows[0].nome as string | null) ?? null;
  }, banco));

  // Na auditoria central só a ação e o alvo; os nomes ficam no banco da empresa.
  await auditar(central(), u, u.empresa!.id, 'renomear_contato', `${numeroId}:${waId.slice(-4)}`, { limpou: !novo }).catch(() => undefined);
  if (novo && novo !== anterior) await atualizarNomeNoCrm(u, waId, novo);
  return lerConversaResumo(u, numeroId, waId);
}

async function atualizarNomeNoCrm(u: Usuario, waId: string, nome: string) {
  if (!pode(u, 'crm.editar')) return;
  try {
    const tel = normalizarTelefone(waId);
    const r = await db(u).query(
      `select id from contatos where not arquivado and ${SQL_MESMO_TELEFONE('telefone', 1, 2)} order by criado_em limit 1`,
      chaveTelefone(tel));
    if (r.rowCount) await api.atualizar(atorDe(u), 'contatos', String(r.rows[0].id), { nome });
  } catch (e) {
    // Empresa sem o CRM no banco (42P01) ou telefone fora do padrão: a troca na Inbox já valeu.
    if ((e as { code?: string }).code !== '42P01' && !(e instanceof ErroApi)) registrarErro('renomear contato no CRM', e);
  }
}
