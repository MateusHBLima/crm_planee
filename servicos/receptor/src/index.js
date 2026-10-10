import { config } from './config.js';
import { criarServidor } from './servidor.js';
import { iniciarLacos, pararLacos } from './trabalhador.js';
import { createHash } from 'node:crypto';
import { recarregarRotas, segredosDosNumeros } from './rotas.js';
import { fecharTudo } from './banco.js';
import { erroCurto, log } from './log.js';

process.on('unhandledRejection', (e) => log('erro', 'promessa sem tratamento', { erro: erroCurto(e) }));
process.on('uncaughtException', (e) => log('erro', 'exceção sem tratamento', { erro: erroCurto(e) }));

await recarregarRotas();
// Quantos segredos de app valem e a impressão curta de cada um (6 letras do sha256, não revela o segredo):
// numa troca da stack, dá para ver no log se algum segredo sumiu (falha de 09/10).
log('info', 'segredos de app carregados', {
  meta_app_secret: config.appSecrets.length,
  impressoes: config.appSecrets.map((s) => createHash('sha256').update(s).digest('hex').slice(0, 6)),
  por_numero: segredosDosNumeros().length,
});
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
