import 'server-only';
import { randomBytes } from 'node:crypto';
import { central, ErroApi } from '@/lib/db';
import { cifrar, cifraConfigurada, decifrar } from '@/lib/cifra';
import { clienteFeegow, ErroFeegow, tokenFeegowDaStack } from '@/lib/agenda/feegow';

// Integrações de cada empresa coladas na tela Empresas (06/11, migração 033): cliente novo sem Portainer.
// Os valores ficam cifrados no banco central (PAINEL_CHAVE_CIFRA) e nunca voltam para a tela.
//   - Feegow: token da API. Salvar testa na hora e liga a integração "feegow" (o espelho da agenda começa sozinho).
//   - n8n: segredo do cabeçalho x-painel-segredo, gerado aqui, um por empresa. Sem ele, vale N8N_WEBHOOK_SEGREDO.
// Banco central sem a 033: tudo continua pela stack, como antes.

const semColuna = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const abrir = (c: unknown) => { try { return typeof c === 'string' && c ? decifrar(c) : null; } catch { return null; } };

// Memória curta: o espelho, a agenda e os avisos pedem o token várias vezes por minuto.
const MEMORIA_MS = () => { const n = Number(process.env.PAINEL_INTEGRACOES_CACHE_MS); return Number.isFinite(n) && n >= 0 ? n : 60_000; };
const g = globalThis as unknown as { __painelIntegracoes?: Map<string, { v: string | null; ate: number }> };
const memoria = (g.__painelIntegracoes ??= new Map());
export function esquecerIntegracoes(empresaId?: string) {
  if (!empresaId) { memoria.clear(); return; }
  for (const k of [...memoria.keys()]) if (k.endsWith(':' + empresaId)) memoria.delete(k);
}
async function lembrar(chave: string, ler: () => Promise<string | null>): Promise<string | null> {
  const m = memoria.get(chave);
  if (m && m.ate > Date.now()) return m.v;
  const v = await ler();
  memoria.set(chave, { v, ate: Date.now() + MEMORIA_MS() });
  return v;
}

export async function tokenFeegow(empresaId: string): Promise<string | null> {
  const doBanco = await lembrar(`feegow:${empresaId}`, async () => {
    try {
      const r = await central().query(
        `select token_cifrado from empresa_integracoes where empresa_id = $1 and sistema = 'feegow' and ativo and token_cifrado is not null`, [empresaId]);
      return abrir(r.rows[0]?.token_cifrado);
    } catch (e) { if (semColuna(e)) return null; throw e; }
  });
  return doBanco ?? tokenFeegowDaStack(empresaId);
}

export async function segredoN8n(empresaId: string | null | undefined): Promise<string> {
  const proprio = empresaId ? await lembrar(`n8n:${empresaId}`, async () => {
    try {
      const r = await central().query(`select n8n_segredo_cifrado from empresas where id = $1`, [empresaId]);
      return abrir(r.rows[0]?.n8n_segredo_cifrado);
    } catch (e) { if (semColuna(e)) return null; throw e; }
  }) : null;
  return proprio ?? process.env.N8N_WEBHOOK_SEGREDO ?? '';
}

export type SituacaoIntegracoes = {
  feegow: { tem_token: boolean; da_stack: boolean; ativo: boolean; teste_em: string | null; teste_erro: string | null };
  n8n: { proprio: boolean };
};

export async function situacaoIntegracoes(empresaId: string): Promise<SituacaoIntegracoes> {
  const vazio: SituacaoIntegracoes = {
    feegow: { tem_token: false, da_stack: Boolean(tokenFeegowDaStack(empresaId)), ativo: false, teste_em: null, teste_erro: null },
    n8n: { proprio: false },
  };
  try {
    const [i, e] = await Promise.all([
      central().query(`select (token_cifrado is not null) as tem, ativo, teste_em, teste_erro from empresa_integracoes where empresa_id = $1 and sistema = 'feegow'`, [empresaId]),
      central().query(`select (n8n_segredo_cifrado is not null) as tem from empresas where id = $1`, [empresaId]),
    ]);
    const x = i.rows[0];
    return {
      feegow: { tem_token: Boolean(x?.tem), da_stack: vazio.feegow.da_stack, ativo: Boolean(x?.ativo),
        teste_em: x?.teste_em ? new Date(x.teste_em).toISOString() : null, teste_erro: x?.teste_erro ?? null },
      n8n: { proprio: Boolean(e.rows[0]?.tem) },
    };
  } catch (err) { if (semColuna(err)) return vazio; throw err; }
}

function exigirCifra() {
  if (!cifraConfigurada()) throw new ErroApi(503, 'Falta PAINEL_CHAVE_CIFRA na stack do painel: sem ela o token não pode ser guardado.');
}

// Testa o token na Feegow (lista de profissionais) e, se servir, guarda cifrado e liga a integração "feegow".
// Token que não serve não é guardado: a tela mostra o motivo.
export async function salvarTokenFeegow(empresaId: string, token: unknown, por: string): Promise<{ profissionais: number }> {
  exigirCifra();
  const t = String(token ?? '').trim();
  if (t.length < 10 || t.length > 2000 || /\s/.test(t)) throw new ErroApi(400, 'Cole o token da API da Feegow (Feegow → Configurações → API), sem espaços.');
  let profissionais = 0;
  try {
    const cli = clienteFeegow(t, { chamadas: 0 }, 15_000);
    const lista = await cli.profissionais(1);
    profissionais = lista.length;
    if (!profissionais && !(await cli.profissionais(0)).length) throw new ErroFeegow(0, 'a Feegow não devolveu nenhum profissional com este token');
  } catch (e) {
    const motivo = e instanceof ErroFeegow ? (e.status === 401 || e.status === 403 ? 'a Feegow recusou o token' : e.message) : 'não consegui falar com a Feegow';
    throw new ErroApi(400, `Token não guardado: ${motivo}. Confira e cole de novo.`);
  }
  try {
    await central().query(
      `insert into empresa_integracoes (empresa_id, sistema, rotulo, ativo, token_cifrado, teste_em, teste_erro, atualizado_em, atualizado_por)
       values ($1, 'feegow', 'Feegow (agenda)', true, $2, now(), null, now(), $3)
       on conflict (empresa_id, sistema) do update set token_cifrado = excluded.token_cifrado, ativo = true, teste_em = now(),
         teste_erro = null, atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, cifrar(t), por]);
  } catch (e) {
    if (semColuna(e)) throw new ErroApi(503, 'O banco central ainda não tem a migração 033 (token na tela). Rode a 033 e tente de novo.');
    throw e;
  }
  esquecerIntegracoes(empresaId);
  return { profissionais };
}

// Gera (ou troca) o segredo do n8n da empresa. Devolve o valor uma vez, para colar na credencial do n8n dela.
export async function gerarSegredoN8n(empresaId: string): Promise<string> {
  exigirCifra();
  const segredo = randomBytes(24).toString('base64url');
  try {
    const r = await central().query(`update empresas set n8n_segredo_cifrado = $2 where id = $1`, [empresaId, cifrar(segredo)]);
    if (!r.rowCount) throw new ErroApi(404, 'Empresa não encontrada.');
  } catch (e) {
    if (semColuna(e)) throw new ErroApi(503, 'O banco central ainda não tem a migração 033. Rode a 033 e tente de novo.');
    throw e;
  }
  esquecerIntegracoes(empresaId);
  return segredo;
}
