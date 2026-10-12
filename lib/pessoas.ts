import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { chaveTelefone } from '@/lib/telefone';

// Várias pessoas no mesmo número (migração 024). O dono do número é o contato com contatos.telefone igual
// (quem conversa no WhatsApp); os outros chegam por contato_telefones, com o papel. Banco sem a 024: só o dono.

export type PessoaDoNumero = {
  id: string; nome: string | null; telefone: string | null; documento: string | null; criado_em: string;
  papel: string; dono: boolean;
};
type Banco = Pool | PoolClient;
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const dig = (col: string) => `regexp_replace(${col}, '\\D', '', 'g')`;

export { PAPEIS, NOME_PAPEL } from './pessoas-papeis';

export async function pessoasDoNumero(b: Banco, tel: string): Promise<PessoaDoNumero[]> {
  const [ddd, fim] = chaveTelefone(tel);
  const donos = await b.query(
    `select id, nome, telefone, documento, criado_em from contatos
      where not arquivado and substr(${dig('telefone')}, 3, 2) = $1 and right(${dig('telefone')}, 8) = $2 order by criado_em`, [ddd, fim]);
  let ligados: Record<string, unknown>[] = [];
  try {
    ligados = (await b.query(
      `select c.id, c.nome, c.telefone, c.documento, c.criado_em, t.papel
         from contato_telefones t join contatos c on c.id = t.contato_id
        where not t.arquivado and not c.arquivado and substr(t.telefone, 3, 2) = $1 and right(t.telefone, 8) = $2
        order by c.criado_em`, [ddd, fim])).rows;
  } catch (e) { if (!semTabela(e)) throw e; }
  const papelDe = new Map(ligados.map((l) => [String(l.id), String(l.papel)]));
  const vistos = new Set<string>();
  const saida: PessoaDoNumero[] = [];
  const incluir = (r: Record<string, unknown>, dono: boolean) => {
    const id = String(r.id);
    if (vistos.has(id)) return;
    vistos.add(id);
    saida.push({
      id, nome: (r.nome as string) ?? null, telefone: (r.telefone as string) ?? null, documento: (r.documento as string) ?? null,
      criado_em: new Date(r.criado_em as string).toISOString(), papel: papelDe.get(id) ?? 'responsavel', dono,
    });
  };
  for (const r of donos.rows) incluir(r, true);
  for (const r of ligados) incluir(r, false);
  return saida;
}

// Números a que o contato está ligado: o próprio telefone e os de contato_telefones.
export async function numerosDoContato(b: Banco, contatoId: string): Promise<{ telefone: string; papel: string }[]> {
  const c = await b.query(`select telefone from contatos where id = $1`, [contatoId]);
  const saida: { telefone: string; papel: string }[] = [];
  const tel = c.rows[0]?.telefone ? String(c.rows[0].telefone).replace(/\D/g, '') : null;
  let ligados: Record<string, unknown>[] = [];
  try {
    ligados = (await b.query(`select telefone, papel from contato_telefones where contato_id = $1 and not arquivado order by criado_em`, [contatoId])).rows;
  } catch (e) { if (!semTabela(e)) throw e; }
  const mesmo = (a: string, x: string) => a.slice(2, 4) === x.slice(2, 4) && a.slice(-8) === x.slice(-8);
  if (tel) saida.push({ telefone: tel, papel: String(ligados.find((l) => mesmo(String(l.telefone), tel))?.papel ?? 'responsavel') });
  for (const l of ligados) if (!tel || !mesmo(String(l.telefone), tel)) saida.push({ telefone: String(l.telefone), papel: String(l.papel) });
  return saida;
}

// CPF com os dois dígitos verificadores certos (e não 111.111.111-11).
export function cpfValido(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1{10}$/.test(v)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(v[i]) * (n + 1 - i);
    const d = ((s * 10) % 11) % 10;
    if (d !== Number(v[n])) return false;
  }
  return true;
}
