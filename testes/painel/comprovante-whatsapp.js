// Arquivo do comprovante pelo espelho do WhatsApp (09/10): pagamento sem arquivo copia a foto que o paciente mandou,
// pelo wamid ou pelo telefone na janela de tempo; figurinha e áudio não contam; mídia ainda baixando fica "baixando";
// arquivo de outra empresa nunca sai. Receptor falso (GET /whatsapp/midia/<token>) como no inbox.js. Dados fictícios.
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const receptor = http.createServer((req, res) => {
  const tok = (req.url.match(/^\/whatsapp\/midia\/([A-Za-z0-9_-]{24,128})$/) || [])[1];
  const achou = tok ? sql(`select caminho from wa_midia_links where token = '${tok}' and expira_em > now()`) : '';
  if (!achou) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG);
});
const NUM = '100000000000001'; const TEL = '5500990000081';

(async () => {
  await new Promise((r) => receptor.listen(Number(new URL(process.env.RECEPTOR_URL || 'http://127.0.0.1:3998').port), '127.0.0.1', r));
  const chave = 'teste-comp-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Sara comprovante', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm'])`);
  const api = (caminho, corpo) => fetch(B + caminho, { method: 'POST', body: JSON.stringify(corpo), headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' } })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const msg = (wamid, tipo, midia, minutos) => sql(`insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, midia, enviada_em, recebida_em)
    values ('${NUM}', '${TEL}', '${wamid}', 'entrada', 'contato', '${tipo}', null, '${JSON.stringify(midia)}'::jsonb, now() - interval '${minutos} minutes', now())`);

  // 1) Pelo telefone: a última foto recebida (a figurinha, mais nova, não conta)
  msg('wamid.COMP1', 'image', { id: 'x1', mime_type: 'image/png', caminho: 'teste/100000000000001/COMP1.png' }, 10);
  msg('wamid.COMP2', 'sticker', { id: 'x2', mime_type: 'image/webp', caminho: 'teste/100000000000001/COMP2.webp' }, 5);
  let r = await api('/api/v1/pagamentos', { telefone: TEL, nome: 'Comprovante Ficticio', valor: 150, forma: 'pix', descricao: 'sinal da consulta' });
  ok('pagamento sem arquivo copia a foto do WhatsApp', r.status < 300 && r.json.arquivo_do_whatsapp === 'anexado', JSON.stringify(r.json));
  const p1 = r.json?.id;
  ok('arquivo guardado no pagamento, com o wamid da mensagem', sql(`select arquivo_mime || '|' || arquivo_tamanho || '|' || wamid || '|' || (select count(*) from pagamentos_arquivos a where a.pagamento_id = p.id) from pagamentos p where id = '${p1}'`)
    === `image/png|${PNG.length}|wamid.COMP1|1`);
  ok('auditoria registra a origem whatsapp', sql(`select count(*) from painel_auditoria where alvo_id = '${p1}' and detalhe->'arquivo'->>'origem' = 'whatsapp'`) === '1');
  const arq = await fetch(`${B}/api/v1/pagamentos/${p1}/arquivo`, { headers: { authorization: 'Bearer ' + chave } });
  ok('GET do arquivo devolve a imagem', arq.status === 200 && Buffer.from(await arq.arrayBuffer()).equals(PNG));

  // 2) Mídia ainda baixando (sem caminho): "baixando"; quando o receptor termina, o painel anexa sozinho (20 s)
  msg('wamid.COMP3', 'image', { id: 'x3', mime_type: 'image/png' }, 1);
  r = await api('/api/v1/pagamentos', { telefone: TEL, valor: 50, forma: 'pix', wamid: 'wamid.COMP3' });
  ok('mídia ainda baixando responde "baixando"', r.status < 300 && r.json.arquivo_do_whatsapp === 'baixando', JSON.stringify(r.json));
  const p3 = r.json?.id;
  sql(`update wa_mensagens set midia = midia || '{"caminho":"teste/100000000000001/COMP3.png"}'::jsonb where wamid = 'wamid.COMP3'`);
  for (let i = 0; i < 30 && sql(`select coalesce(arquivo_mime, '') from pagamentos where id = '${p3}'`) === ''; i++) await new Promise((s) => setTimeout(s, 1000));
  ok('quando termina de baixar, o painel anexa sozinho', sql(`select arquivo_mime from pagamentos where id = '${p3}'`) === 'image/png');

  // 3) Arquivo de outra empresa nunca sai (caminho fora da pasta da empresa)
  msg('wamid.COMP4', 'image', { id: 'x4', mime_type: 'image/png', caminho: 'clinica-outra/999/COMP4.png' }, 1);
  r = await api('/api/v1/pagamentos', { telefone: TEL, valor: 70, forma: 'pix', wamid: 'wamid.COMP4' });
  ok('arquivo de outra empresa não é copiado', r.status < 300 && r.json.arquivo_do_whatsapp === 'nao_achado' && sql(`select coalesce(arquivo_mime, 'nenhum') from pagamentos where id = '${r.json.id}'`) === 'nenhum', JSON.stringify(r.json));

  // 4) Com arquivo enviado pela Sara, nada muda
  r = await api('/api/v1/pagamentos', { telefone: TEL, valor: 80, forma: 'pix', arquivo: { nome: 'c.png', mime: 'image/png', base64: PNG.toString('base64') } });
  ok('com arquivo enviado, não procura no WhatsApp', r.status < 300 && r.json.arquivo_do_whatsapp === undefined);

  receptor.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
