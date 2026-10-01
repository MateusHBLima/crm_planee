import { config } from './config.js';
import { criarServidor } from './servidor.js';
import { iniciarLacos, pararLacos } from './trabalhador.js';
import { recarregarRotas } from './rotas.js';
import { fecharTudo } from './banco.js';
import { erroCurto, log } from './log.js';

process.on('unhandledRejection', (e) => log('erro', 'promessa sem tratamento', { erro: erroCurto(e) }));
process.on('uncaughtException', (e) => log('erro', 'exceção sem tratamento', { erro: erroCurto(e) }));

await recarregarRotas();
const servidor = criarServidor();
servidor.keepAliveTimeout = 65_000;
servidor.listen(config.porta, () => log('info', 'receptor no ar', { porta: config.porta, instancia: config.instancia }));
if (!config.semLacos) iniciarLacos();

const desligar = () => {
  log('info', 'desligando');
  pararLacos();
  servidor.close(() => fecharTudo().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', desligar);
process.on('SIGINT', desligar);
