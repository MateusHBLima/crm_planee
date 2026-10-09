import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { central, empresaDoBancoPadrao, registrarErro, transacao } from '@/lib/db';
import { bancoDe, type Chave } from './auth';
import { ASSINATURAS, auditar } from './servico';

// Arquivo do comprovante pelo espelho do WhatsApp (09/10). A Sara manda o pagamento sem o arquivo (a ponte dela não
// recebe a mídia), mas o receptor já guardou a imagem ou o PDF que o paciente mandou (wa_mensagens.midia.caminho).
// O painel acha essa mensagem e copia o arquivo para o pagamento:
//   - pelo wamid do pagamento, quando veio; senão,
//   - a última foto ou PDF recebido do mesmo telefone (DDD + 8 últimos dígitos) entre 2 h antes e 5 min depois do
//     registro do pagamento.
// O arquivo vem do Storage pelo receptor, com um link curto (o mesmo da Inbox, migração 011). Só PDF, JPG, PNG ou
// WEBP com o conteúdo conferido, até 10 MB. É um extra: qualquer falha só vai para o log, o pagamento fica como está.
// Mídia ainda baixando (o receptor baixa em segundos): tenta de novo algumas vezes, em segundo plano.

export type ResultadoArquivo = 'anexado' | 'baixando' | 'nao_achado' | 'indisponivel' | 'sem_espelho';
const MAX = 10 * 1024 * 1024;
const TENTATIVAS = [20_000, 60_000, 180_000];
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const baseReceptor = () => (process.env.RECEPTOR_URL || `https://${process.env.PAINEL_HOST_ADM || 'adm.planeelabia.com'}`).replace(/\/+$/, '');

export async function anexarDoWhatsApp(chave: Chave, pagamentoId: string): Promise<ResultadoArquivo> {
  const db = bancoDe(chave);
  const empresa = chave.empresa?.id ?? empresaDoBancoPadrao();
  if (!empresa) return 'sem_espelho';
  const tem = await db.query(`select to_regclass('wa_mensagens') is not null as tem`);
  if (!tem.rows[0]?.tem) return 'sem_espelho';
  const r = await db.query(
    `with p as (select p.id, p.wamid, p.criado_em, regexp_replace(coalesce(c.telefone, ''), '\\D', '', 'g') as tel
                  from pagamentos p join contatos c on c.id = p.contato_id
                 where p.id = $1 and p.arquivo_nome is null and not p.arquivado)
     select m.wamid, m.midia->>'caminho' as caminho, lower(split_part(coalesce(m.midia->>'mime_type', ''), ';', 1)) as mime,
            m.midia->>'filename' as nome, (m.midia->>'erro') is not null as erro
       from p join wa_mensagens m on m.direcao = 'entrada' and m.tipo in ('image', 'document') and m.midia is not null
        and ((p.wamid is not null and m.wamid = p.wamid)
          or (p.wamid is null and length(p.tel) >= 10 and substr(m.wa_id, 3, 2) = substr(p.tel, 3, 2) and right(m.wa_id, 8) = right(p.tel, 8)
              and m.enviada_em between p.criado_em - interval '2 hours' and p.criado_em + interval '5 minutes'))
      order by m.enviada_em desc limit 1`, [pagamentoId]);
  const m = r.rows[0];
  if (!m) return 'nao_achado';
  if (!EXT[m.mime]) return 'nao_achado';                  // figurinha, HEIC, áudio...: não é comprovante aceito
  if (!m.caminho) return m.erro ? 'indisponivel' : 'baixando';
  // O receptor grava cada arquivo na pasta da empresa dona do número: arquivo de outra empresa não sai daqui.
  if (!String(m.caminho).startsWith(`${empresa}/`)) return 'nao_achado';

  const token = randomBytes(24).toString('base64url');
  await central().query(
    `insert into wa_midia_links (token, empresa_id, caminho, mime, expira_em) values ($1, $2, $3, $4, now() + interval '5 minutes')`,
    [token, empresa, m.caminho, m.mime]);
  const resp = await fetch(`${baseReceptor()}/whatsapp/midia/${token}`, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`receptor respondeu ${resp.status}`);
  const dados = Buffer.from(await resp.arrayBuffer());
  if (!dados.length || dados.length > MAX || !ASSINATURAS[m.mime](dados)) return 'indisponivel';
  const sha = createHash('sha256').update(dados).digest('hex');
  const nome = (String(m.nome ?? '').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120)) || `comprovante-whatsapp.${EXT[m.mime]}`;

  return transacao(async (c) => {
    const u = await c.query(
      `update pagamentos set arquivo_nome = $2, arquivo_mime = $3, arquivo_tamanho = $4, arquivo_sha256 = $5, wamid = coalesce(wamid, $6), atualizado_em = now()
        where id = $1 and arquivo_nome is null returning id`, [pagamentoId, nome, m.mime, dados.length, sha, m.wamid]);
    if (!u.rowCount) return 'anexado' as const;           // outro pedido anexou antes
    await c.query('insert into pagamentos_arquivos (pagamento_id, dados) values ($1, $2) on conflict (pagamento_id) do nothing', [pagamentoId, dados]);
    await auditar(c, chave, 'atualizar', 'pagamentos', pagamentoId, { arquivo: { mime: m.mime, tamanho: dados.length, sha256: sha, origem: 'whatsapp' } });
    return 'anexado' as const;
  }, db);
}

// Chamada depois de registrar o pagamento sem arquivo. Devolve o resultado da primeira tentativa; se a mídia ainda
// está baixando, tenta de novo em segundo plano.
export async function tentarArquivoDoWhatsApp(chave: Chave, pagamentoId: string): Promise<ResultadoArquivo> {
  const uma = async (): Promise<ResultadoArquivo> => {
    try { return await anexarDoWhatsApp(chave, pagamentoId); } catch (e) { registrarErro('arquivo do comprovante pelo WhatsApp', e); return 'indisponivel'; }
  };
  const r = await uma();
  if (r === 'baixando') {
    let i = 0;
    const de_novo = () => {
      if (i >= TENTATIVAS.length) return;
      setTimeout(async () => { const x = await uma(); i++; if (x === 'baixando') de_novo(); }, TENTATIVAS[i]).unref?.();
    };
    de_novo();
  }
  return r;
}
