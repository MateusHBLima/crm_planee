// Quem é dono de cada número (phone_number_id) e para onde repassar o evento bruto.
// Fica em memória e é relido a cada 60 s: se o banco central cair, o repasse para a Sara continua.
import { config } from './config.js';
import { central, decifrar } from './banco.js';
import { erroCurto, log } from './log.js';

let mapa = new Map();
let lidoEm = 0;
let segredosNumeros = [];

function abrir(cifrado) {
  if (!cifrado) return null;
  try { return decifrar(cifrado); } catch (e) { log('erro', 'não consegui abrir um segredo de número (confira PAINEL_CHAVE_CIFRA)', { erro: erroCurto(e) }); return null; }
}

// Segredos de app cadastrados por número no painel (além dos de META_APP_SECRET).
export const segredosDosNumeros = () => segredosNumeros;

export async function recarregarRotas() {
  try {
    const r = await central().query(
      `select n.phone_number_id, n.empresa_id, n.encaminhar_url, n.baixar_midias, n.telefone, e.banco_url_cifrado,
              to_jsonb(n) ->> 'token_cifrado' as token_cifrado, to_jsonb(n) ->> 'app_secret_cifrado' as app_secret_cifrado
         from whatsapp_numeros n join empresas e on e.id = n.empresa_id
        where n.ativo and e.ativo`);
    const segredos = new Set();
    mapa = new Map(r.rows.map((x) => {
      // Token e segredo do app cadastrados no painel (cifrados). Sem cadastro, valem META_TOKEN e META_APP_SECRET.
      x.meta_token = abrir(x.token_cifrado);
      const s = abrir(x.app_secret_cifrado);
      if (s) segredos.add(s);
      delete x.token_cifrado; delete x.app_secret_cifrado;
      return [x.phone_number_id, x];
    }));
    segredosNumeros = [...segredos];
    lidoEm = Date.now();
  } catch (e) {
    log('erro', 'não consegui reler os números; sigo com a lista anterior', { erro: erroCurto(e) });
  }
  return mapa;
}

export async function rota(numero) {
  if (Date.now() - lidoEm > config.rotasMs) await recarregarRotas();
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

// Token da Meta do número: o cadastrado no painel ou, sem cadastro, o META_TOKEN do receptor.
export function tokenDoNumero(numero) {
  return rotaEmCache(numero)?.meta_token || config.metaToken || '';
}
