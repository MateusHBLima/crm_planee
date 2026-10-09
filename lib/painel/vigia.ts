import 'server-only';
import { bancoDaEmpresa, central, registrarErro } from '@/lib/db';
import { avisoDoSistema, lembreteDoSistema, resolverDoSistema } from '@/lib/avisos-sistema';

// Vigia (08/10): de 15 em 15 minutos o painel confere sozinho o que costuma dar problema e abre aviso para a Planee.
//   • token de integração vencendo (ex.: Feegow): a partir de 30 dias antes, lembra a cada 3 dias até a data mudar;
//   • número sem mensagens: em horário comercial, um número que costuma receber mensagens ficou quieto demais
//     (sinal de número desconectado ou webhook parado);
//   • envios falhando: muitas mensagens com status "falhou" na última hora;
//   • fila parada (09/10): em horário comercial, 5 ou mais pedidos do quadro esperando a equipe além do prazo
//     vermelho (Configurações → prazos). Fecha sozinho quando a fila zera.
// Cada aviso tem chave própria: rodar de novo (ou em duas réplicas ao mesmo tempo) não duplica.
// Ligado em instrumentation.ts; PAINEL_VIGIA=0 desliga. O botão "Verificar agora" do Interno Planee roda na hora.

const DIAS_ANTES = 30;
const LEMBRAR_A_CADA_DIAS = 3;
const SILENCIO_MIN_7D = 40;         // abaixo disso o número recebe pouco e o silêncio não diz nada
const SILENCIO_ESPERADAS = 8;       // dispara quando já deviam ter chegado ~8 mensagens
const SILENCIO_MIN_H = 2;
const COMERCIAL = { de: 8, ate: 20, horasSemana: 72 }; // segunda a sábado, 8 h às 20 h
const FALHAS_MIN = 5;
const FALHAS_FRACAO = 0.2;
const FILA_MIN = 5;

export type ResumoVigia = { em: string; tokens: number; silencio: number; falhas: number; fila: number; resolvidos: number; empresas: number; sem_banco: string[] };

const fuso = () => process.env.PAINEL_FUSO || 'America/Sao_Paulo';
const final4 = (s: string) => String(s).replace(/\D/g, '').slice(-4);

// Data, dia da semana e hora no fuso da Planee.
export function relogio(agora: Date, tz = fuso()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, semana: String(p.weekday), hora: Number(p.hour) + Number(p.minute) / 60 };
}

// Silêncio que conta: só dentro do horário comercial de hoje. Às 8 h da manhã a noite não pesa.
export function silencioSuspeito(d: { entradas7d: number; ultimaEntrada: Date | null; agora: Date; tz?: string }): { horas: number } | null {
  if (d.entradas7d < SILENCIO_MIN_7D || !d.ultimaEntrada) return null;
  const r = relogio(d.agora, d.tz);
  if (r.semana === 'Sun' || r.hora < COMERCIAL.de || r.hora >= COMERCIAL.ate) return null;
  const desde = (d.agora.getTime() - d.ultimaEntrada.getTime()) / 3600_000;
  const horas = Math.min(desde, r.hora - COMERCIAL.de);
  const porHora = d.entradas7d / COMERCIAL.horasSemana;
  const limiar = Math.max(SILENCIO_MIN_H, SILENCIO_ESPERADAS / porHora);
  return horas >= limiar ? { horas: Math.floor(desde) } : null;
}

const dataBr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

async function vigiarTokens(agora: Date): Promise<{ abertos: number; resolvidos: number }> {
  const r = await central().query(
    `select empresa_id, sistema, rotulo, to_char(token_valido_ate, 'YYYY-MM-DD') as validade,
            (token_valido_ate - ($1::timestamptz at time zone $2)::date) as dias
       from empresa_integracoes where ativo and token_valido_ate is not null
        and token_valido_ate <= ($1::timestamptz at time zone $2)::date + $3::int`, [agora, fuso(), DIAS_ANTES]);
  const chaves: string[] = [];
  let abertos = 0;
  for (const x of r.rows) {
    const nome = x.rotulo || x.sistema;
    const dias = Number(x.dias);
    const quando = dias < 0 ? `venceu em ${dataBr(x.validade)}` : dias === 0 ? 'vence hoje' : `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'} (${dataBr(x.validade)})`;
    const chave = `token:${x.empresa_id}:${x.sistema}:${x.validade}`;
    chaves.push(chave);
    if (await lembreteDoSistema(x.empresa_id, { tipo: 'token_vencendo', titulo: `Token da integração ${nome} ${quando}`, chave,
      ref: { sistema: x.sistema, validade: x.validade } }, LEMBRAR_A_CADA_DIAS)) abertos++;
  }
  // Data nova cadastrada (ou integração desligada): o lembrete antigo fecha sozinho.
  const velhos = await central().query(
    `select id from avisos where tipo = 'token_vencendo' and estado <> 'resolvido' and not (chave = any($1::text[]))`, [chaves]);
  const resolvidos = await resolverDoSistema(velhos.rows.map((x) => String(x.id)), 'Validade do token atualizada (ou integração desligada).');
  return { abertos, resolvidos };
}

type EmpresaVigia = { id: string; banco_url_cifrado: string | null };

// Fila parada: pedidos em "aguardando" (sem os cartões sombra) há mais que o prazo vermelho da empresa.
async function vigiarFila(e: EmpresaVigia, agora: Date): Promise<{ aberto: number; resolvidos: number }> {
  const b = bancoDaEmpresa(e);
  const r = await b.query(
    `with p as (select coalesce((select (valor->'aguardando'->>'vermelho')::int from crm_config where chave = 'prazos_atendimento'), 30) as min)
     select count(*) as atrasados, min(a.aberto_em) as mais_antigo
       from atendimentos a, p
      where not a.arquivado and a.etapa = 'aguardando' and a.resumo !~ '^\\s*\\[SOMBRA\\]'
        and a.aberto_em < $1::timestamptz - make_interval(mins => p.min)`, [agora]);
  const n = Number(r.rows[0]?.atrasados) || 0;
  const r2 = relogio(agora);
  const comercial = r2.semana !== 'Sun' && r2.hora >= COMERCIAL.de && r2.hora < COMERCIAL.ate;
  let aberto = 0;
  if (comercial && n >= FILA_MIN) {
    const horas = Math.floor((agora.getTime() - new Date(r.rows[0].mais_antigo).getTime()) / 3600_000);
    if (await avisoDoSistema(e.id, {
      tipo: 'fila_parada', chave: `fila:${e.id}:${r2.dia}`,
      titulo: `${n} pedidos esperando a equipe além do prazo no quadro (o mais antigo há ${horas >= 24 ? `${Math.floor(horas / 24)} d` : `${horas} h`}). Conferir com a clínica.`,
      ref: { atrasados: n, mais_antigo: new Date(r.rows[0].mais_antigo).toISOString() },
    })) aberto++;
  }
  let resolvidos = 0;
  if (n === 0) {
    const abertos = await central().query(`select id from avisos where empresa_id = $1 and tipo = 'fila_parada' and estado <> 'resolvido'`, [e.id]);
    resolvidos = await resolverDoSistema(abertos.rows.map((x) => String(x.id)), 'A fila do quadro zerou.');
  }
  return { aberto, resolvidos };
}

async function vigiarEmpresa(e: EmpresaVigia, agora: Date): Promise<{ silencio: number; falhas: number; resolvidos: number }> {
  const b = bancoDaEmpresa(e);
  const [nums, falhas] = await Promise.all([
    b.query(
      `select numero_id, max(enviada_em) filter (where direcao = 'entrada') as ultima_entrada,
              count(*) filter (where direcao = 'entrada') as entradas_7d
         from wa_mensagens where enviada_em > $1::timestamptz - interval '7 days' group by numero_id`, [agora]),
    b.query(
      `select numero_id, count(*) as saidas, count(*) filter (where status = 'falhou') as falhas,
              mode() within group (order by erro->>'code') filter (where status = 'falhou') as codigo
         from wa_mensagens where direcao = 'saida' and enviada_em > $1::timestamptz - interval '1 hour' group by numero_id`, [agora]),
  ]);
  const hoje = relogio(agora).dia;
  let silencio = 0; let nFalhas = 0;
  const ultima = new Map<string, Date | null>();
  for (const x of nums.rows) {
    const ult = x.ultima_entrada ? new Date(x.ultima_entrada) : null;
    ultima.set(String(x.numero_id), ult);
    const s = silencioSuspeito({ entradas7d: Number(x.entradas_7d), ultimaEntrada: ult, agora });
    if (!s) continue;
    if (await avisoDoSistema(e.id, {
      tipo: 'numero_silencioso', chave: `silencio:${e.id}:${x.numero_id}:${hoje}`,
      titulo: `Número (id ••${final4(x.numero_id)}) sem mensagens recebidas há ${s.horas} h em horário comercial. Conferir se está conectado.`,
      ref: { numero_id: String(x.numero_id), ultima_entrada: ult?.toISOString() ?? null },
    })) silencio++;
  }
  for (const x of falhas.rows) {
    const f = Number(x.falhas); const t = Number(x.saidas);
    if (f < FALHAS_MIN || f < t * FALHAS_FRACAO) continue;
    if (await avisoDoSistema(e.id, {
      tipo: 'envios_falhando', chave: `falhas:${e.id}:${x.numero_id}:${hoje}`,
      titulo: `${f} de ${t} envios falharam na última hora (número id ••${final4(x.numero_id)})${x.codigo ? ` · erro da Meta ${String(x.codigo).slice(0, 12)}` : ''}`,
      ref: { numero_id: String(x.numero_id), codigo: x.codigo ?? null },
    })) nFalhas++;
  }
  // Número voltou a receber: fecha o aviso de silêncio sozinho.
  const abertos = await central().query(
    `select id, criado_em, ref->>'numero_id' as numero_id from avisos where empresa_id = $1 and tipo = 'numero_silencioso' and estado <> 'resolvido'`, [e.id]);
  const voltou = abertos.rows.filter((a) => { const u = ultima.get(String(a.numero_id)); return u && u > new Date(a.criado_em); }).map((a) => String(a.id));
  const resolvidos = await resolverDoSistema(voltou, 'O número voltou a receber mensagens.');
  return { silencio, falhas: nFalhas, resolvidos };
}

let rodando = false;

export async function rodarVigia(agora = new Date()): Promise<ResumoVigia> {
  const resumo: ResumoVigia = { em: agora.toISOString(), tokens: 0, silencio: 0, falhas: 0, fila: 0, resolvidos: 0, empresas: 0, sem_banco: [] };
  if (rodando) return resumo;
  rodando = true;
  try {
    try {
      const t = await vigiarTokens(agora);
      resumo.tokens = t.abertos; resumo.resolvidos += t.resolvidos;
    } catch (e) { if (!['42P01', '42703'].includes((e as { code?: string }).code ?? '')) registrarErro('vigia (tokens)', e); }
    let empresas: (EmpresaVigia & { nome: string })[] = [];
    try { empresas = (await central().query('select id, nome, banco_url_cifrado from empresas where ativo order by id')).rows; }
    catch (e) { registrarErro('vigia (empresas)', e); }
    // Empresas que dividem o mesmo banco (teste: todas no banco padrão) são conferidas uma vez só por banco.
    const vistos = new Set<string>();
    for (const e of empresas) {
      const chaveBanco = e.banco_url_cifrado ?? 'padrao';
      if (vistos.has(chaveBanco)) continue;
      vistos.add(chaveBanco);
      resumo.empresas++;
      try {
        const f = await vigiarFila(e, agora);
        resumo.fila += f.aberto; resumo.resolvidos += f.resolvidos;
      } catch (err) {
        if (!['42P01', '42703'].includes((err as { code?: string }).code ?? '')) registrarErro(`vigia fila ${e.id}`, err);
      }
      try {
        const r = await vigiarEmpresa(e, agora);
        resumo.silencio += r.silencio; resumo.falhas += r.falhas; resumo.resolvidos += r.resolvidos;
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        if (!['42P01', '42703'].includes(code)) { resumo.sem_banco.push(e.nome); registrarErro(`vigia ${e.id}`, err); }
      }
    }
    return resumo;
  } finally { rodando = false; }
}

const MINUTOS = 15;
export function iniciarVigia() {
  const g = globalThis as unknown as { __vigiaPlanee?: boolean };
  if (g.__vigiaPlanee) return;
  g.__vigiaPlanee = true;
  const rodar = () => { rodarVigia().catch((e) => registrarErro('vigia', e)); };
  setTimeout(() => { rodar(); setInterval(rodar, MINUTOS * 60_000).unref?.(); }, 90_000).unref?.();
}
