// Quem é dono de cada número (phone_number_id) e para onde repassar o evento bruto.
// Fica em memória e é relido a cada 60 s: se o banco central cair, o repasse para a Sara continua.
import { config } from './config.js';
import { central } from './banco.js';
import { erroCurto, log } from './log.js';

let mapa = new Map();
let lidoEm = 0;

export async function recarregarRotas() {
  try {
    const r = await central().query(
      `select n.phone_number_id, n.empresa_id, n.encaminhar_url, n.baixar_midias, n.telefone, e.banco_url_cifrado
         from whatsapp_numeros n join empresas e on e.id = n.empresa_id
        where n.ativo and e.ativo`);
    mapa = new Map(r.rows.map((x) => [x.phone_number_id, x]));
    lidoEm = Date.now();
  } catch (e) {
    log('erro', 'não consegui reler os números; sigo com a lista anterior', { erro: erroCurto(e) });
  }
  return mapa;
}

export async function rota(numero) {
  if (Date.now() - lidoEm > 60_000) await recarregarRotas();
  return numero ? mapa.get(String(numero)) ?? null : null;
}

export function rotaEmCache(numero) {
  return numero ? mapa.get(String(numero)) ?? null : null;
}

export function todasAsRotas() {
  return [...mapa.values()];
}

// Para onde repassar: o do número; sem número cadastrado, o padrão (o n8n de hoje).
export function destinoDoRepasse(numero) {
  const r = rotaEmCache(numero);
  if (r) return r.encaminhar_url || '';
  return config.encaminharPadrao;
}
