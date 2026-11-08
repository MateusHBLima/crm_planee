import 'server-only';
import { central, ErroApi, transacao } from '@/lib/db';
import { cifrar, cifraConfigurada } from '@/lib/cifra';
import type { Usuario } from '@/lib/sessao';
import { auditar } from './gestao';

// Números de WhatsApp de cada empresa (banco central, migrações 007 e 011), cadastrados pela Planee na tela Empresas.
// O painel não fala com a Meta (regra 7): "Conectar" e "Puxar histórico" só marcam o pedido; o receptor executa
// em até 10 s e grava o resultado, que a tela mostra. Token e segredo do app ficam cifrados e nunca voltam para a tela.

export type NumeroWhats = {
  phone_number_id: string; waba_id: string | null; empresa_id: string; nome: string | null; telefone: string | null;
  encaminhar_url: string | null; eco_url: string | null; ativo: boolean; tem_token: boolean; tem_segredo: boolean;
  conectar_pedido_em: string | null; conectado_em: string | null; conexao_erro: string | null; verificado_nome: string | null;
  historico_pedido_em: string | null; historico_status: string | null; historico_em: string | null;
};

const ID_META = /^\d{5,30}$/;
const semTabela = (e: unknown) => ['42P01', '42703'].includes((e as { code?: string }).code ?? '');
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function exigirMaster(u: Usuario) {
  if (u.nivel !== 'master') throw new ErroApi(403, 'Só a Planee (master) faz isso.');
}

// to_jsonb: funciona com a central antes da migração 011 (as colunas novas só aparecem vazias).
export async function listarNumeros(u: Usuario): Promise<NumeroWhats[]> {
  exigirMaster(u);
  try {
    const r = await central().query(`select to_jsonb(n) as j from whatsapp_numeros n order by n.empresa_id, n.ativo desc, n.nome nulls last`);
    return r.rows.map(({ j }) => ({
      phone_number_id: j.phone_number_id, waba_id: j.waba_id ?? null, empresa_id: j.empresa_id, nome: j.nome ?? null,
      telefone: j.telefone ?? null, encaminhar_url: j.encaminhar_url ?? null, eco_url: j.eco_url ?? null, ativo: Boolean(j.ativo),
      tem_token: Boolean(j.token_cifrado), tem_segredo: Boolean(j.app_secret_cifrado),
      conectar_pedido_em: iso(j.conectar_pedido_em), conectado_em: iso(j.conectado_em), conexao_erro: j.conexao_erro ?? null,
      verificado_nome: j.verificado_nome ?? null, historico_pedido_em: iso(j.historico_pedido_em),
      historico_status: j.historico_status ?? null, historico_em: iso(j.historico_em),
    }));
  } catch (e) {
    if (semTabela(e)) return [];
    throw e;
  }
}

const textoCurto = (v: unknown, max: number) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };

// Cria ou atualiza. Token e segredo em branco na edição = mantém o que já está guardado.
export async function salvarNumero(u: Usuario, empresa: string, dados: {
  phone_number_id: unknown; waba_id?: unknown; nome?: unknown; encaminhar_url?: unknown; eco_url?: unknown; token?: unknown; app_secret?: unknown;
}) {
  exigirMaster(u);
  const id = String(dados.phone_number_id ?? '').trim();
  if (!ID_META.test(id)) throw new ErroApi(400, 'Identificação do número (phone_number_id): só números, como aparece na Meta.');
  const waba = textoCurto(dados.waba_id, 30);
  if (waba && !ID_META.test(waba)) throw new ErroApi(400, 'Conta do WhatsApp (WABA): só números.');
  const nome = textoCurto(dados.nome, 80);
  const url = textoCurto(dados.encaminhar_url, 500);
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new ErroApi(400, 'Repassar para: use o endereço https do webhook da Sara no n8n.');
  // 27/10: empresa cuja IA recebe direto da Meta (sem repasse pelo receptor) recebe aqui só o aviso das respostas pelo painel.
  const eco = textoCurto(dados.eco_url, 500);
  if (eco && !/^https:\/\/[^\s]+$/.test(eco)) throw new ErroApi(400, 'Avisar a IA das respostas pelo painel: use o endereço https do webhook da IA.');
  const token = textoCurto(dados.token, 2000);
  const segredo = textoCurto(dados.app_secret, 200);
  if (token && !/^[A-Za-z0-9_\-.|]{20,}$/.test(token)) throw new ErroApi(400, 'Token da Meta: cole só o token (sem espaços nem "Bearer").');
  if (segredo && !/^[A-Za-z0-9]{16,}$/.test(segredo)) throw new ErroApi(400, 'Chave secreta do app: cole só a chave (letras e números).');
  if ((token || segredo) && !cifraConfigurada()) throw new ErroApi(503, 'Falta PAINEL_CHAVE_CIFRA no servidor para guardar o token.');
  try {
    await transacao(async (c) => {
      const atual = await c.query('select empresa_id from whatsapp_numeros where phone_number_id = $1 for update', [id]);
      if (atual.rowCount && atual.rows[0].empresa_id !== empresa) {
        throw new ErroApi(409, 'Esse número já está cadastrado em outra empresa.');
      }
      await c.query(
        `insert into whatsapp_numeros (phone_number_id, waba_id, empresa_id, nome, encaminhar_url, token_cifrado, app_secret_cifrado)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (phone_number_id) do update set
           waba_id = excluded.waba_id, nome = excluded.nome, encaminhar_url = excluded.encaminhar_url,
           token_cifrado = coalesce(excluded.token_cifrado, whatsapp_numeros.token_cifrado),
           app_secret_cifrado = coalesce(excluded.app_secret_cifrado, whatsapp_numeros.app_secret_cifrado),
           atualizado_em = now()`,
        [id, waba, empresa, nome, url, token ? cifrar(token) : null, segredo ? cifrar(segredo) : null]);
      // Coluna da migração 030: central ainda sem ela só falha se alguém tentar gravar o endereço.
      const temEco = (await c.query(`select 1 from information_schema.columns where table_name = 'whatsapp_numeros' and column_name = 'eco_url' limit 1`)).rowCount;
      if (temEco) await c.query('update whatsapp_numeros set eco_url = $2 where phone_number_id = $1', [id, eco]);
      else if (eco) throw new ErroApi(503, 'O banco central ainda não tem a migração 030 (aviso à IA das respostas pelo painel).');
      // Nunca o token nem o segredo na auditoria: só se foram trocados.
      await auditar(c, u, empresa, atual.rowCount ? 'atualizar_numero' : 'cadastrar_numero', id,
        { waba_id: waba, nome, repasse: Boolean(url), eco: Boolean(eco), trocou_token: Boolean(token), trocou_segredo: Boolean(segredo) });
    }, central());
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23503') throw new ErroApi(404, 'Empresa não encontrada.');
    if (semTabela(e)) throw new ErroApi(503, 'O banco central ainda não tem as migrações 007 e 011 (números de WhatsApp).');
    throw e;
  }
}

type Pedido = 'conectar' | 'historico' | 'ativar' | 'desativar';

export async function pedirNoNumero(u: Usuario, phoneNumberId: string, pedido: Pedido) {
  exigirMaster(u);
  if (!ID_META.test(phoneNumberId)) throw new ErroApi(400, 'Número inválido.');
  const sql: Record<Pedido, string> = {
    conectar: `conectar_pedido_em = now(), conectar_pedido_por = $2, conexao_erro = null`,
    historico: `historico_pedido_em = now(), historico_pedido_por = $2, historico_status = 'pedido no painel: o receptor envia à Meta em segundos'`,
    ativar: `ativo = true`,
    desativar: `ativo = false, conectar_pedido_em = null, historico_pedido_em = null`,
  };
  try {
    await transacao(async (c) => {
      const r = await c.query(
        `update whatsapp_numeros set ${sql[pedido]}, atualizado_em = now() where phone_number_id = $1 ${pedido === 'conectar' || pedido === 'historico' ? 'and ativo' : ''}
         returning empresa_id`, pedido === 'conectar' || pedido === 'historico' ? [phoneNumberId, u.email ?? u.id] : [phoneNumberId]);
      if (!r.rowCount) throw new ErroApi(404, pedido === 'conectar' || pedido === 'historico' ? 'Número não encontrado ou desativado.' : 'Número não encontrado.');
      await auditar(c, u, r.rows[0].empresa_id, `numero_${pedido}`, phoneNumberId, null);
    }, central());
  } catch (e) {
    if (semTabela(e)) throw new ErroApi(503, 'O banco central ainda não tem a migração 011 (conectar pelo painel).');
    throw e;
  }
}

// ---- "Conectar WhatsApp" pelo cadastro incorporado da Meta (06/11, coexistência) ----
// O cliente escaneia o QR no WhatsApp Business do celular; a Meta devolve ao navegador a conta (WABA), o número e um
// código de uso único. O painel não fala com a Meta (regra 7): guarda o código cifrado junto com o número e pede a
// conexão. O receptor troca o código pelo token (com a chave secreta do app), guarda o token cifrado, inscreve o app,
// aponta o número para o webhook e puxa o histórico. A Inbox começa a receber sem ninguém colar nada.
export const appDaMeta = () => {
  const appId = (process.env.META_APP_ID || '').trim();
  const configId = (process.env.META_CADASTRO_CONFIG_ID || '').trim();
  return /^\d{5,30}$/.test(appId) && /^\d{5,30}$/.test(configId) ? { appId, configId } : null;
};

export async function cadastrarPeloBotao(u: Usuario, empresa: string, d: { code: unknown; waba_id: unknown; phone_number_id: unknown; webhook_ia?: unknown; nome?: unknown }) {
  exigirMaster(u);
  const app = appDaMeta();
  if (!app) throw new ErroApi(503, 'O botão ainda não foi configurado: faltam META_APP_ID e META_CADASTRO_CONFIG_ID na stack do painel.');
  const code = String(d.code ?? '').trim();
  if (!/^[A-Za-z0-9_\-.#]{20,2000}$/.test(code)) throw new ErroApi(400, 'A Meta não devolveu o código do cadastro. Tente de novo e conclua todas as telas.');
  if (!ID_META.test(String(d.phone_number_id ?? '')) || !ID_META.test(String(d.waba_id ?? ''))) {
    throw new ErroApi(400, 'A Meta não devolveu a conta e o número. Tente de novo e conclua todas as telas.');
  }
  if (!cifraConfigurada()) throw new ErroApi(503, 'Falta PAINEL_CHAVE_CIFRA no servidor para guardar o código.');
  const id = String(d.phone_number_id);
  await salvarNumero(u, empresa, { phone_number_id: id, waba_id: d.waba_id, nome: d.nome, encaminhar_url: d.webhook_ia });
  try {
    await central().query(`update whatsapp_numeros set cadastro_codigo_cifrado = $2, ativo = true where phone_number_id = $1`,
      [id, cifrar(JSON.stringify({ code, app_id: app.appId }))]);
  } catch (e) {
    if (semTabela(e)) throw new ErroApi(503, 'O banco central ainda não tem a migração 033 (Conectar WhatsApp pelo botão).');
    throw e;
  }
  await pedirNoNumero(u, id, 'conectar');
  return { phone_number_id: id };
}
