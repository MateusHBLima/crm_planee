// Quem atende a conversa agora: a Sara ou a equipe. A Sara (n8n) pergunta antes de responder.
//   dono = 'humano' sem prazo (sempre)      → a equipe assumiu de vez: Sara quieta até devolverem.
//   dono = 'humano' com prazo ainda valendo → assumida por 24 h (renovadas a cada resposta da equipe): Sara quieta.
//   dono = 'humano' com prazo vencido       → a Sara volta sozinha (vale a regra do celular abaixo).
//   resposta pelo celular há < N minutos    → Sara quieta até passar o prazo (mesmo comportamento de hoje).
//   o resto                                 → Sara responde.
// Conversa que o espelho ainda não conhece: Sara responde (o agente não depende do painel).
import { config } from './config.js';
import { bancoDaEmpresa } from './banco.js';
import { rota } from './rotas.js';
import { NumeroSemDono } from './processar.js';

const digitos = (s) => String(s ?? '').replace(/\D/g, '');

// Celular do Brasil chega com e sem o 9 (o wa_id da Meta costuma vir sem). Procura nas duas formas.
export function formasDoNumero(waId) {
  const d = digitos(waId);
  const com9 = d.match(/^55(\d{2})9(\d{8})$/);
  if (com9) return [d, `55${com9[1]}${com9[2]}`];
  const sem9 = d.match(/^55(\d{2})([6-9]\d{7})$/);
  if (sem9) return [d, `55${sem9[1]}9${sem9[2]}`];
  return [d];
}

export async function estadoDoAtendimento(numero, waId) {
  const r = await rota(numero);
  if (!r) throw new NumeroSemDono(`Número ${numero || '(sem id)'} não cadastrado em whatsapp_numeros.`);
  const formas = formasDoNumero(waId);
  if (!formas[0]) throw new Error('Informe wa_id.');
  const x = await bancoDaEmpresa(r).query(
    `select c.dono, c.dono_em, c.dono_por, to_jsonb(c) ->> 'dono_ate' as dono_ate,
            (select max(m.enviada_em) from wa_mensagens m
              where m.numero_id = c.numero_id and m.wa_id = c.wa_id and m.origem = 'celular') as celular_em
       from wa_conversas c
      where c.numero_id = $1 and c.wa_id = any($2::text[])
      order by c.ultima_em desc nulls last limit 1`, [String(numero), formas]);
  const c = x.rows[0];
  if (!c) return { sara_responde: true, motivo: 'ia', dono: 'ia', por: null, desde: null, pausa_ate: null, sempre: false, ate: null };
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  // Banco sem a migração 012: dono_ate não existe e a conversa assumida vale "sempre" (o comportamento de antes).
  const ateMs = c.dono_ate ? new Date(c.dono_ate).getTime() : null;
  if (c.dono === 'humano' && (ateMs === null || ateMs > Date.now())) {
    return { sara_responde: false, motivo: 'equipe_assumiu', dono: 'humano', por: c.dono_por ?? null, desde: iso(c.dono_em), pausa_ate: null,
             sempre: ateMs === null, ate: ateMs === null ? null : new Date(ateMs).toISOString() };
  }
  const ate = c.celular_em ? new Date(c.celular_em).getTime() + config.pausaCelularMin * 60_000 : 0;
  if (ate > Date.now()) {
    return { sara_responde: false, motivo: 'equipe_no_celular', dono: 'ia', por: null, desde: iso(c.celular_em), pausa_ate: new Date(ate).toISOString(), sempre: false, ate: null };
  }
  return { sara_responde: true, motivo: 'ia', dono: 'ia', por: null, desde: iso(c.dono_em), pausa_ate: null, sempre: false, ate: null };
}
