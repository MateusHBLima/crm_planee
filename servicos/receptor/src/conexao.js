// Pedidos feitos pelo painel (tela Empresas → Números de WhatsApp), executados aqui porque só o receptor conhece
// o verify token e o próprio endereço público:
//   conectar  → guarda para onde a Meta entrega hoje (vira o repasse, para a IA da empresa não parar), inscreve o app
//               na conta (WABA), aponta o número para este webhook (override), lê o nome verificado e, na primeira
//               conexão, já pede o histórico;
//   histórico → pede à Meta a agenda e as conversas da coexistência (vale nas 24 h depois da conexão no celular).
// Cadastro incorporado (06/11): quando o número chega pelo botão "Conectar WhatsApp" do painel, vem com o código que a
// Meta devolveu ao cliente. Antes de conectar, o receptor troca esse código pelo token do número (com a chave secreta
// do app, que só o receptor tem), guarda o token cifrado e apaga o código. Nada de colar token na tela.
// O resultado volta para whatsapp_numeros, e a tela do painel mostra. Nada aqui depende de Portainer.
import { config } from './config.js';
import { bancoDaEmpresa, central, cifrar, decifrar } from './banco.js';
import { graphApi } from './meta.js';
import { recarregarRotas, todasAsRotas } from './rotas.js';
import { erroCurto, log } from './log.js';

// Central ainda sem a migração 011: nada a fazer (sem log a cada volta).
const semMigracao = (e) => e && (e.code === '42703' || e.code === '42P01');
const consultar = (sql, p) => central().query(sql, p).catch((e) => { if (semMigracao(e)) return { rows: [], rowCount: 0 }; throw e; });

const abrir = (c) => { try { return c ? decifrar(c) : null; } catch { return null; } };

// Endereço que recebe as mensagens do número hoje (override do número, da conta ou o geral do app), lido antes do
// override. undefined = a Meta não respondeu; null = nenhum endereço configurado.
async function enderecoAtual(numero, token) {
  try {
    const r = await graphApi(`${encodeURIComponent(numero)}?fields=webhook_configuration`, token);
    const w = r.webhook_configuration || {};
    return w.phone_number || w.whatsapp_business_account || w.application || null;
  } catch (e) {
    log('aviso', 'não li o webhook atual do número', { numero, erro: erroCurto(e) });
    return undefined;
  }
}

// Troca o código do cadastro incorporado pelo token do número. O código vale uma vez e por pouco tempo; com mais de um
// app cadastrado (META_APP_SECRET com vários segredos), tenta cada segredo até um servir.
async function tokenDoCadastro(n) {
  let pedido;
  try { pedido = JSON.parse(decifrar(n.cadastro_codigo_cifrado)); } catch { throw new Error('Código do cadastro ilegível. Clique em "Conectar WhatsApp" de novo.'); }
  if (!pedido?.code || !pedido?.app_id) throw new Error('Código do cadastro incompleto. Clique em "Conectar WhatsApp" de novo.');
  if (!config.appSecrets.length) throw new Error('Receptor sem META_APP_SECRET: não dá para trocar o código pelo token.');
  let ultimo = 'sem resposta';
  for (const segredo of config.appSecrets) {
    const q = new URLSearchParams({ client_id: String(pedido.app_id), client_secret: segredo, code: String(pedido.code) });
    const r = await fetch(`${config.graphUrl}/${config.graphVersao}/oauth/access_token?${q}`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) {
      await central().query(
        `update whatsapp_numeros set token_cifrado = $2, cadastro_codigo_cifrado = null, atualizado_em = now() where phone_number_id = $1`,
        [n.phone_number_id, cifrar(j.access_token)]);
      return j.access_token;
    }
    ultimo = String(j.error?.message || r.status).slice(0, 160);
  }
  await central().query(`update whatsapp_numeros set cadastro_codigo_cifrado = null where phone_number_id = $1`, [n.phone_number_id]);
  throw new Error(`A Meta não trocou o código do cadastro (${ultimo}). Clique em "Conectar WhatsApp" de novo.`);
}

async function conectar(n) {
  const token = (n.cadastro_codigo_cifrado ? await tokenDoCadastro(n) : null) || abrir(n.token_cifrado) || config.metaToken;
  if (!token) throw new Error('Número sem token da Meta. Cole o token no painel e peça de novo.');
  if (!config.verifyToken) throw new Error('Receptor sem META_VERIFY_TOKEN.');
  // Conectar nunca corta a IA da empresa: sem repasse cadastrado, quem recebe hoje passa a receber pelo receptor.
  // Grava e recarrega as rotas ANTES do override, para a primeira mensagem já seguir para lá.
  let repasse = null;
  if (!n.encaminhar_url) {
    const atual = await enderecoAtual(n.phone_number_id, token);
    if (atual === undefined) throw new Error('Não consegui ler na Meta para onde o número entrega hoje. Preencha "Repassar para" (ou confirme que não há IA) e conecte de novo.');
    if (atual && atual !== config.urlPublica) {
      await central().query(`update whatsapp_numeros set encaminhar_url = $2, atualizado_em = now() where phone_number_id = $1 and coalesce(encaminhar_url, '') = ''`,
        [n.phone_number_id, atual]);
      await recarregarRotas();
      repasse = atual;
    }
  }
  if (n.waba_id) await graphApi(`${encodeURIComponent(n.waba_id)}/subscribed_apps`, token, { metodo: 'POST' });
  await graphApi(encodeURIComponent(n.phone_number_id), token, {
    metodo: 'POST',
    corpo: { webhook_configuration: { override_callback_uri: config.urlPublica, verify_token: config.verifyToken } },
  });
  const info = await graphApi(`${encodeURIComponent(n.phone_number_id)}?fields=display_phone_number,verified_name`, token);
  return { telefone: String(info.display_phone_number || '').replace(/\D/g, '') || null, nome: info.verified_name || null, repasse };
}

export async function conectarPendentes() {
  // Duas réplicas rodam este laço: o pedido é "pego" (apagado) numa só instrução, então só uma delas chama a Meta.
  const r = await consultar(
    `update whatsapp_numeros n set conectar_pedido_em = null
      where n.phone_number_id in (select phone_number_id from whatsapp_numeros
                                   where ativo and conectar_pedido_em is not null limit 5 for update skip locked)
      returning n.phone_number_id, n.waba_id, n.token_cifrado, n.encaminhar_url, to_jsonb(n)->>'cadastro_codigo_cifrado' as cadastro_codigo_cifrado`);
  for (const n of r.rows) {
    try {
      const { telefone, nome, repasse } = await conectar(n);
      // Primeira conexão já pede o histórico (coexistência: a Meta só entrega nas 24 h depois de ligar no celular).
      await central().query(
        `update whatsapp_numeros set conectado_em = now(), conexao_erro = null,
                telefone = coalesce($2, telefone), verificado_nome = coalesce($3, verificado_nome), atualizado_em = now(),
                historico_pedido_em = case when historico_em is null and historico_pedido_em is null and historico_status is null then now() else historico_pedido_em end,
                historico_status = case when historico_em is null and historico_pedido_em is null and historico_status is null
                                        then 'pedido junto com a conexão: o receptor envia à Meta em segundos' else historico_status end
          where phone_number_id = $1`, [n.phone_number_id, telefone, nome]);
      log('info', 'número conectado pelo painel', { numero: n.phone_number_id, repasse_guardado: Boolean(repasse) });
    } catch (e) {
      await central().query(
        `update whatsapp_numeros set conexao_erro = $2, atualizado_em = now() where phone_number_id = $1`,
        [n.phone_number_id, erroCurto(e).slice(0, 300)]);
    }
  }
  if (r.rowCount) await recarregarRotas();
  return r.rowCount;
}

export async function pedirHistoricoPendente() {
  const r = await consultar(
    `update whatsapp_numeros n set historico_pedido_em = null, historico_status = 'pedindo à Meta…'
      where n.phone_number_id in (select phone_number_id from whatsapp_numeros
                                   where ativo and historico_pedido_em is not null limit 5 for update skip locked)
      returning n.phone_number_id, n.token_cifrado`);
  for (const n of r.rows) {
    let status;
    try {
      const token = abrir(n.token_cifrado) || config.metaToken;
      if (!token) throw new Error('Número sem token da Meta.');
      for (const tipo of ['smb_app_state_sync', 'history']) {
        await graphApi(`${encodeURIComponent(n.phone_number_id)}/smb_app_data`, token,
          { metodo: 'POST', corpo: { messaging_product: 'whatsapp', sync_type: tipo } });
      }
      status = 'pedido aceito pela Meta: agenda e conversas chegam em até algumas horas';
    } catch (e) {
      status = `recusado: ${erroCurto(e)}`.slice(0, 300);
    }
    await central().query(
      `update whatsapp_numeros set historico_status = $2, historico_em = now(), atualizado_em = now()
        where phone_number_id = $1`, [n.phone_number_id, status]);
  }
  return r.rowCount;
}

export async function limparLinksVencidos() {
  const limpar = (banco) => banco.query(`delete from wa_midia_links where expira_em < now() - interval '1 hour'`).catch((e) => {
    if (e.code !== '42P01') log('erro', 'limpeza dos links de mídia', { erro: erroCurto(e) });
  });
  await limpar(central());
  // Links no banco de cada empresa (migração 020): um banco por empresa, mesmo com vários números.
  const feitas = new Set();
  for (const r of todasAsRotas()) {
    if (feitas.has(r.empresa_id)) continue;
    feitas.add(r.empresa_id);
    let banco; try { banco = bancoDaEmpresa(r); } catch { continue; }
    if (banco !== central()) await limpar(banco);
  }
}
