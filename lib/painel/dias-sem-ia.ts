import 'server-only';
import { bancoDaEmpresa, ErroApi } from '@/lib/db';
import * as api from '@/lib/api/servico';
import { hojeNoFuso } from '@/lib/periodo';
import { atorDe, pode, type Usuario } from '@/lib/sessao';
import { fuso } from './crm';

// "Dias sem marcação pela IA" (14/10, pedido do chat da Sara): a equipe fecha dias da agenda para a IA pelo próprio
// CRM. A lista fica na config do CRM, chave "agenda_fechada", no formato que a IA lê:
//   [{"prof": 1, "data": "AAAA-MM-DD", "motivo": "..."}]   (item sem "prof" = todos os profissionais)
// Os profissionais que aparecem para escolher vêm da chave "agenda_profissionais" ([{"id": 1, "nome": "..."}]):
// nada de nome de cliente no código (regra 9). Quem edita o quadro (crm.editar) pode fechar e reabrir dias.
// Fechar o dia não desmarca ninguém: a IA só deixa de oferecer, marcar e remarcar nele.

export type DiaFechado = { prof: number | null; data: string; motivo: string };
export type Profissional = { id: number; nome: string };
export type DiasSemIa = { dias: DiaFechado[]; profissionais: Profissional[]; hoje: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 200;

function limparDias(v: unknown): DiaFechado[] {
  if (!Array.isArray(v)) return [];
  const saida: DiaFechado[] = [];
  for (const x of v as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object' || !DATA.test(String(x.data ?? ''))) continue;
    const prof = Number(x.prof);
    saida.push({ prof: Number.isInteger(prof) && prof > 0 ? prof : null, data: String(x.data), motivo: String(x.motivo ?? '').slice(0, 120) });
  }
  return saida;
}

function limparProfissionais(v: unknown): Profissional[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[])
    .map((x) => ({ id: Number(x?.id), nome: String(x?.nome ?? '').trim().slice(0, 80) }))
    .filter((x) => Number.isInteger(x.id) && x.id > 0 && x.nome);
}

const ordenar = (a: DiaFechado, b: DiaFechado) => a.data.localeCompare(b.data) || (a.prof ?? 0) - (b.prof ?? 0);

function exigirEditar(u: Usuario) {
  if (!u.empresa) throw new ErroApi(400, 'Escolha uma empresa primeiro.');
  if (!pode(u, 'crm.editar')) throw new ErroApi(403, 'Você não tem permissão para isso nesta empresa.');
}

export async function lerDiasSemIa(u: Usuario): Promise<DiasSemIa> {
  exigirEditar(u);
  const r = await bancoDaEmpresa(u.empresa!).query(
    `select chave, valor from crm_config where chave in ('agenda_fechada', 'agenda_profissionais')`);
  const v = Object.fromEntries(r.rows.map((x) => [x.chave, x.valor]));
  const hoje = hojeNoFuso(fuso());
  // Dias que já passaram não aparecem (e saem da lista no próximo salvamento).
  return { dias: limparDias(v.agenda_fechada).filter((d) => d.data >= hoje).sort(ordenar), profissionais: limparProfissionais(v.agenda_profissionais), hoje };
}

// Grava a lista inteira (a tela manda a lista já com o dia novo ou sem o removido). Passa pela API, com auditoria.
export async function salvarDiasSemIa(u: Usuario, dias: unknown): Promise<DiasSemIa> {
  exigirEditar(u);
  if (!Array.isArray(dias)) throw new ErroApi(400, 'Lista de dias inválida.');
  if (dias.length > MAX_DIAS) throw new ErroApi(400, `No máximo ${MAX_DIAS} dias fechados.`);
  const hoje = hojeNoFuso(fuso());
  const vistos = new Set<string>();
  const valor: Record<string, unknown>[] = [];
  for (const x of dias as Record<string, unknown>[]) {
    const data = String(x?.data ?? '');
    if (!DATA.test(data) || Number.isNaN(Date.parse(data + 'T12:00:00Z'))) throw new ErroApi(400, 'Data inválida.');
    if (data < hoje) continue;
    const prof = x?.prof === null || x?.prof === undefined || x?.prof === '' ? null : Number(x.prof);
    if (prof !== null && (!Number.isInteger(prof) || prof <= 0)) throw new ErroApi(400, 'Profissional inválido.');
    const motivo = String(x?.motivo ?? '').trim();
    if (motivo.length > 120) throw new ErroApi(400, 'O motivo pode ter até 120 caracteres.');
    const k = `${prof ?? '*'}|${data}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    valor.push(prof === null ? { data, motivo } : { prof, data, motivo });
  }
  valor.sort((a, b) => String(a.data).localeCompare(String(b.data)) || Number(a.prof ?? 0) - Number(b.prof ?? 0));
  // A config do CRM pede o escopo "config"; aqui basta editar o quadro (a equipe fecha os dias sozinha).
  const ator = atorDe(u);
  await api.definirConfig({ ...ator, escopos: [...new Set([...ator.escopos, 'config'])] }, 'agenda_fechada', valor);
  return lerDiasSemIa(u);
}
