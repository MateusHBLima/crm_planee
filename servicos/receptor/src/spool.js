// Plano B quando o banco central não responde: o evento vai para um arquivo local (volume do serviço) e é
// gravado no banco assim que ele voltar. A resposta para a Meta continua 200 e a Sara continua recebendo.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const arquivo = () => path.join(config.spoolDir, `spool-${config.instancia}.jsonl`);

export function guardarNoSpool(registro) {
  fs.mkdirSync(config.spoolDir, { recursive: true });
  fs.appendFileSync(arquivo(), JSON.stringify(registro) + '\n');
}

// Lê o que estiver guardado (de qualquer instância: o container pode ter sido recriado com outro nome) e tenta
// gravar; o que falhar volta para o arquivo desta instância. O rename é atômico: só uma instância pega cada arquivo.
export async function esvaziarSpool(gravar) {
  let arquivos;
  try { arquivos = fs.readdirSync(config.spoolDir).filter((f) => /^spool-.+\.jsonl$/.test(f)); } catch { return 0; }
  let ok = 0;
  for (const f of arquivos) {
    const a = path.join(config.spoolDir, f);
    const tmp = `${a}.${config.instancia}.processando`;
    try { fs.renameSync(a, tmp); } catch { continue; }
    const linhas = fs.readFileSync(tmp, 'utf8').split('\n').filter(Boolean);
    const sobra = [];
    for (const l of linhas) {
      try { await gravar(JSON.parse(l)); ok++; } catch { sobra.push(l); }
    }
    if (sobra.length) fs.appendFileSync(arquivo(), sobra.join('\n') + '\n');
    fs.unlinkSync(tmp);
  }
  return ok;
}

export function tamanhoSpool() {
  try {
    return fs.readdirSync(config.spoolDir).filter((f) => /^spool-.+\.jsonl$/.test(f))
      .reduce((n, f) => n + fs.readFileSync(path.join(config.spoolDir, f), 'utf8').split('\n').filter(Boolean).length, 0);
  } catch { return 0; }
}
