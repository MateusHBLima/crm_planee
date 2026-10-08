import 'server-only';
import type { Pool } from 'pg';
import { registrarErro } from '@/lib/db';

// Texto das mensagens da IA na Inbox (08/10).
// A Meta não devolve o texto do que é enviado pela API: só o status (enviada, entregue, lida). O receptor grava a
// linha sem texto (origem 'api', tipo 'desconhecido'). O texto existe no histórico da própria IA, no banco da
// empresa. Cada empresa expõe esse histórico numa visão padrão `falas_ia` (adaptação do banco antigo é visão no
// banco do cliente, decisão 22):
//   falas_ia(telefone text, em timestamptz, texto text)  — só as falas da IA (role model)
// Sem a visão, nada muda. Achado o texto, ele é gravado na própria mensagem: nas próximas leituras não há busca.
// Uma resposta da IA vira vários balões no WhatsApp (um por parágrafo): os parágrafos vão para os balões na ordem.

export type Lacuna = { id: string; em: string };   // mensagem da IA sem texto: id da linha e horário da Meta
export type Fala = { em: string; texto: string };

const ANTES_MS = 60_000;        // a fala é gravada no histórico pouco antes do envio
const DEPOIS_MS = 5 * 60_000;   // os balões de uma resposta saem em poucos segundos; folga para fila e reenvio
const PROCURAR_ATE_MS = 30 * 60_000; // depois disso, balão sem fala no histórico não é procurado de novo

// Tira marcações internas do histórico ("[AUTOMÁTICA · lembrete_2d] …") e devolve os parágrafos.
export function partes(texto: string): { partes: string[]; rotulo: string | null } {
  let t = String(texto ?? '').trim();
  let rotulo: string | null = null;
  const m = t.match(/^\[(AUTOM[ÁA]TICA[^\]]*)\]\s*/i);
  if (m) { rotulo = m[1].replace(/\s+/g, ' ').trim(); t = t.slice(m[0].length); }
  const ps = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { partes: ps.length ? ps : (t ? [t] : []), rotulo };
}

// Liga cada balão sem texto à fala da IA que o gerou: a fala mais recente que começou até ANTES_MS depois do balão
// e no máximo DEPOIS_MS antes dele. Os balões de uma fala recebem os parágrafos em ordem; se houver mais
// parágrafos que balões, o último balão leva o resto; balão sobrando fica como está.
export function casar(lacunas: Lacuna[], falas: Fala[]): Map<string, string> {
  const fs = falas
    .map((f) => ({ t: new Date(f.em).getTime(), ...partes(f.texto) }))
    .filter((f) => Number.isFinite(f.t) && f.partes.length)
    .sort((a, b) => a.t - b.t);
  const ls = lacunas.map((l) => ({ ...l, t: new Date(l.em).getTime() })).sort((a, b) => a.t - b.t);
  const grupos = new Map<number, typeof ls>();
  for (const l of ls) {
    let escolhida = -1;
    for (let i = 0; i < fs.length; i++) {
      if (fs[i].t - ANTES_MS <= l.t && l.t <= fs[i].t + DEPOIS_MS) escolhida = i; // a mais recente que serve
    }
    if (escolhida < 0) continue;
    const g = grupos.get(escolhida) ?? [];
    g.push(l);
    grupos.set(escolhida, g);
  }
  const res = new Map<string, string>();
  for (const [i, g] of grupos) {
    const f = fs[i];
    const prefixo = f.rotulo ? `[${f.rotulo}] ` : '';
    g.forEach((l, k) => {
      if (k >= f.partes.length) return;
      const texto = k === g.length - 1 ? f.partes.slice(k).join('\n\n') : f.partes[k];
      res.set(l.id, (k === 0 ? prefixo : '') + texto);
    });
  }
  return res;
}

// Formas do mesmo número no histórico: com e sem o 9, com e sem "@s.whatsapp.net".
export function formasDoTelefone(waId: string): string[] {
  const d = String(waId ?? '').replace(/\D/g, '');
  const f = new Set<string>([d]);
  const com9 = d.match(/^55(\d{2})9(\d{8})$/);
  const sem9 = d.match(/^55(\d{2})([6-9]\d{7})$/);
  if (com9) f.add(`55${com9[1]}${com9[2]}`);
  if (sem9) f.add(`55${sem9[1]}9${sem9[2]}`);
  return [...f].flatMap((x) => [x, `${x}@s.whatsapp.net`]);
}

// Completa as linhas (mutando) e grava o texto achado. Nunca derruba a tela: qualquer erro só vai para o log.
export async function completarFalasDaIa(banco: Pool, waId: string, linhas: Record<string, unknown>[]): Promise<void> {
  let lacunas: Lacuna[] = linhas
    .filter((m) => m.origem === 'api' && m.direcao === 'saida' && (m.texto == null || m.texto === '') && (m.tipo === 'desconhecido' || m.tipo === 'text'))
    .map((m) => ({ id: String(m.id), em: new Date(m.enviada_em as string).toISOString() }));
  if (!lacunas.length) return;
  try {
    // Balão já procurado sem achar (marcado abaixo) não é procurado de novo: a Inbox atualiza a cada 10 s.
    const r = await banco.query(
      `select id::text from wa_mensagens where id = any($1::bigint[]) and coalesce(bruto->>'texto_de', '') <> 'nao_achado'`, [lacunas.map((l) => l.id)]);
    const vivas = new Set(r.rows.map((x) => String(x.id)));
    lacunas = lacunas.filter((l) => vivas.has(l.id));
  } catch (e) { registrarErro('texto da IA na Inbox', e); return; }
  if (!lacunas.length) return;
  const ts = lacunas.map((l) => new Date(l.em).getTime());
  const de = new Date(Math.min(...ts) - DEPOIS_MS - 60_000).toISOString();
  const ate = new Date(Math.max(...ts) + ANTES_MS + 60_000).toISOString();
  try {
    const r = await banco.query(
      `select em, texto from falas_ia where telefone = any($1::text[]) and em between $2 and $3 order by em`,
      [formasDoTelefone(waId), de, ate]);
    const achados = casar(lacunas, r.rows.map((x) => ({ em: new Date(x.em).toISOString(), texto: String(x.texto ?? '') })));
    // Sem fala no histórico depois de 30 min: marca para não procurar mais (a fala é gravada antes do envio).
    const perdidas = lacunas.filter((l) => !achados.has(l.id) && Date.now() - new Date(l.em).getTime() > PROCURAR_ATE_MS).map((l) => l.id);
    if (perdidas.length) {
      await banco.query(
        `update wa_mensagens set bruto = coalesce(bruto, '{}'::jsonb) || '{"texto_de":"nao_achado"}'::jsonb
          where id = any($1::bigint[]) and texto is null`, [perdidas]);
    }
    if (!achados.size) return;
    for (const m of linhas) {
      const t = achados.get(String(m.id));
      if (t) { m.texto = t; m.tipo = 'text'; }
    }
    const ids = [...achados.keys()];
    await banco.query(
      `update wa_mensagens set texto = x.texto, tipo = 'text',
              bruto = coalesce(bruto, '{}'::jsonb) || '{"texto_de":"historico_ia"}'::jsonb
         from (select unnest($1::bigint[]) as id, unnest($2::text[]) as texto) x
        where wa_mensagens.id = x.id and wa_mensagens.texto is null`,
      [ids, ids.map((i) => achados.get(i) as string)]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42P01' || code === '42703') return; // empresa sem a visão falas_ia: segue sem texto
    registrarErro('texto da IA na Inbox', e);
  }
}
