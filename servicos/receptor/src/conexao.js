// Pedidos feitos pelo painel (tela Empresas → Números de WhatsApp), executados aqui porque só o receptor conhece
// o verify token e o próprio endereço público:
//   conectar  → inscreve o app na conta (WABA), aponta o número para este webhook (override) e lê o nome verificado;
//   histórico → pede à Meta a agenda e as conversas da coexistência (vale nas 24 h depois da conexão no celular).
// O resultado volta para whatsapp_numeros, e a tela do painel mostra. Nada aqui depende de Portainer.
import { config } from './config.js';
import { central, decifrar } from './banco.js';
import { graphApi } from './meta.js';
import { recarregarRotas } from './rotas.js';
import { erroCurto, log } from './log.js';

// Central ainda sem a migração 011: nada a fazer (sem log a cada volta).
const semMigracao = (e) => e && (e.code === '42703' || e.code === '42P01');
const consultar = (sql, p) => central().query(sql, p).catch((e) => { if (semMigracao(e)) return { rows: [], rowCount: 0 }; throw e; });

const abrir = (c) => { try { return c ? decifrar(c) : null; } catch { return null; } };

async function conectar(n) {
  const token = abrir(n.token_cifrado) || config.metaToken;
  if (!token) throw new Error('Número sem token da Meta. Cole o token no painel e peça de novo.');
  if (!config.verifyToken) throw new Error('Receptor sem META_VERIFY_TOKEN.');
  if (n.waba_id) await graphApi(`${encodeURIComponent(n.waba_id)}/subscribed_apps`, token, { metodo: 'POST' });
  await graphApi(encodeURIComponent(n.phone_number_id), token, {
    metodo: 'POST',
    corpo: { webhook_configuration: { override_callback_uri: config.urlPublica, verify_token: config.verifyToken } },
  });
  const info = await graphApi(`${encodeURIComponent(n.phone_number_id)}?fields=display_phone_number,verified_name`, token);
  return { telefone: String(info.display_phone_number || '').replace(/\D/g, '') || null, nome: info.verified_name || null };
}

export async function conectarPendentes() {
  // Duas réplicas rodam este laço: o pedido é "pego" (apagado) numa só instrução, então só uma delas chama a Meta.
  const r = await consultar(
    `update whatsapp_numeros n set conectar_pedido_em = null
      where n.phone_number_id in (select phone_number_id from whatsapp_numeros
                                   where ativo and conectar_pedido_em is not null limit 5 for update skip locked)
      returning n.phone_number_id, n.waba_id, n.token_cifrado`);
  for (const n of r.rows) {
    try {
      const { telefone, nome } = await conectar(n);
      await central().query(
        `update whatsapp_numeros set conectado_em = now(), conexao_erro = null,
                telefone = coalesce($2, telefone), verificado_nome = coalesce($3, verificado_nome), atualizado_em = now()
          where phone_number_id = $1`, [n.phone_number_id, telefone, nome]);
      log('info', 'número conectado pelo painel', { numero: n.phone_number_id });
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
  await central().query(`delete from wa_midia_links where expira_em < now() - interval '1 hour'`).catch((e) => {
    if (e.code !== '42P01') log('erro', 'limpeza dos links de mídia', { erro: erroCurto(e) });
  });
}
