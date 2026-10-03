// Configuração do receptor: tudo vem de variáveis de ambiente (stack no Portainer). Nada de valor no código.
import os from 'node:os';

const env = process.env;
const num = (v, padrao) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : padrao);

export const config = {
  porta: num(env.PORTA, 3010),
  centralUrl: env.CENTRAL_DATABASE_URL || env.DATABASE_URL || '',
  padraoUrl: env.DATABASE_URL || '',
  empresasNoPadrao: (env.EMPRESA_BANCO_PADRAO ?? 'teste').split(',').map((s) => s.trim()).filter(Boolean),
  chaveCifra: env.PAINEL_CHAVE_CIFRA || '',
  // Um segredo por app da Meta que entrega para cá, separados por vírgula (ex.: app da Planee e app da clínica).
  appSecrets: (env.META_APP_SECRET || '').split(',').map((s) => s.trim()).filter(Boolean),
  verifyToken: env.META_VERIFY_TOKEN || '',
  chaveInterna: env.RECEPTOR_CHAVE_INTERNA || '', // a Sara (n8n) usa para registrar o que mandou
  // Minutos que a Sara fica quieta depois que a equipe responde pelo celular (mesmo valor no painel).
  pausaCelularMin: num(env.SARA_PAUSA_CELULAR_MIN, 7),
  metaToken: env.META_TOKEN || '',
  graphUrl: (env.META_GRAPH_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
  graphVersao: env.META_GRAPH_VERSAO || 'v23.0',
  encaminharPadrao: env.ENCAMINHAR_PADRAO || '',
  // Só estes campos vão para a Sara: o que ela já recebe hoje (mensagens, status e ecos da equipe).
  // Histórico da conexão e agenda do celular ficam só no painel (milhares de mensagens antigas não podem virar atendimento).
  repassarCampos: (env.REPASSAR_CAMPOS ?? 'messages,smb_message_echoes').split(',').map((s) => s.trim()).filter(Boolean),
  supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseChave: env.SUPABASE_SERVICE_KEY || '',
  bucket: env.WA_BUCKET || 'whatsapp',
  reterDias: num(env.WA_RETER_DIAS, 30),
  spoolDir: env.SPOOL_DIR || '/dados',
  instancia: env.HOSTNAME || os.hostname(),
  maxCorpo: num(env.WA_MAX_CORPO, 30 * 1024 * 1024),
  intervaloMs: num(env.WA_INTERVALO_MS, 1000),
  semLacos: env.WA_SEM_LACOS === '1', // testes: roda os laços à mão
};

export const midiaConfigurada = () => Boolean(config.metaToken && config.supabaseUrl && config.supabaseChave);
