import 'server-only';
import { central, registrarErro } from '@/lib/db';

// Avisos que o próprio sistema abre para a Planee (08/10): comprovante suspeito, número sem mensagens, envios
// falhando, token de integração vencendo. Ficam na mesma fila dos avisos da equipe (Interno Planee).
// Só o índice vai para o banco central: nada de nome, telefone inteiro ou texto de paciente no título.
// Nenhuma destas funções derruba quem chamou: erro vai para o log e a função devolve false.

export type TipoSistema = 'comprovante_suspeito' | 'numero_silencioso' | 'envios_falhando' | 'token_vencendo';

const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const falhou = (onde: string, e: unknown) => { if (!semTabela(e)) registrarErro(onde, e); return false; };

// Um aviso por chave: repetir a mesma chave não abre outro.
export async function avisoDoSistema(empresaId: string, d: { tipo: TipoSistema; titulo: string; chave: string; ref?: Record<string, unknown> }): Promise<boolean> {
  try {
    const r = await central().query(
      `insert into avisos (empresa_id, origem, tipo, titulo, chave, ref) values ($1,'sistema',$2,$3,$4,$5) on conflict (chave) do nothing returning id`,
      [empresaId, d.tipo, d.titulo.slice(0, 200), d.chave.slice(0, 200), JSON.stringify(d.ref ?? {})]);
    return Boolean(r.rowCount);
  } catch (e) { return falhou('aviso do sistema', e); }
}

// Aviso que se repete enquanto o problema existir (token vencendo): a mesma chave volta para "aberto" e ganha
// o título novo a cada `dias` dias, mesmo que alguém tenha marcado como resolvido sem resolver de fato.
export async function lembreteDoSistema(empresaId: string, d: { tipo: TipoSistema; titulo: string; chave: string; ref?: Record<string, unknown> }, dias: number): Promise<boolean> {
  try {
    const r = await central().query(
      `insert into avisos (empresa_id, origem, tipo, titulo, chave, ref, lembrado_em) values ($1,'sistema',$2,$3,$4,$5, now())
       on conflict (chave) do update set titulo = excluded.titulo, ref = excluded.ref, lembrado_em = now(), atualizado_em = now(),
              estado = case when avisos.estado = 'resolvido' then 'aberto' else avisos.estado end
        where avisos.lembrado_em is null or avisos.lembrado_em <= now() - make_interval(days => $6::int) + interval '5 minutes'
       returning id`,
      [empresaId, d.tipo, d.titulo.slice(0, 200), d.chave.slice(0, 200), JSON.stringify(d.ref ?? {}), dias]);
    return Boolean(r.rowCount);
  } catch (e) { return falhou('lembrete do sistema', e); }
}

// Fecha sozinho os avisos automáticos cujo problema acabou (token renovado, número voltou a receber).
export async function resolverDoSistema(ids: string[], resposta: string): Promise<number> {
  if (!ids.length) return 0;
  try {
    const r = await central().query(
      `update avisos set estado = 'resolvido', resposta = $2, respondido_por = 'Sistema', respondido_em = now(), atualizado_em = now()
        where id = any($1::uuid[]) and estado <> 'resolvido'`, [ids, resposta.slice(0, 2000)]);
    return r.rowCount ?? 0;
  } catch (e) { falhou('resolver aviso do sistema', e); return 0; }
}
