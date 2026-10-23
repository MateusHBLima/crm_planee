// Empresa em toda resposta da API e do conector, X-Empresa, chave recusada na auditoria central, catálogo e ficha
// sem nada de clínica em outro modelo, e idempotência por "chave" (23/10, pedido do SSA AUGUSTO: "de forma alguma
// pode misturar as coisas de empresas"). Duas empresas fictícias: "teste" (banco padrão) e "clinica-outra" (banco
// próprio, endereço outra.localhost, criada pelo central.js). Só API: sem navegador.
const crypto = require('crypto');
const { execSync } = require('child_process');
const URL_OUTRA = process.env.OUTRA_DATABASE_URL;
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const curto = (x) => JSON.stringify(x).slice(0, 180);

(async () => {
  const h = (k) => crypto.createHash('sha256').update(k).digest('hex');
  const kTeste = 'emp-teste-' + crypto.randomBytes(8).toString('hex');
  const kOutra = 'emp-outra-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Empresa teste', '${h(kTeste)}', array['leitura','crm','config'])`);
  sql(`insert into api_chaves (nome, hash, escopos) values ('Empresa outra', '${h(kOutra)}', array['leitura','crm','config'])`, URL_OUTRA);
  const api = (caminho, { k = kTeste, corpo, metodo, outra = false, empresa } = {}) => fetch(B + caminho, {
    method: metodo ?? (corpo === undefined ? 'GET' : 'POST'), body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: {
      ...(k ? { authorization: 'Bearer ' + k } : {}), 'content-type': 'application/json',
      ...(outra ? { 'x-forwarded-host': 'outra.localhost' } : {}), ...(empresa ? { 'x-empresa': empresa } : {}),
    },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), empresa: r.headers.get('x-painel-empresa') }));
  const mcp = (metodo, params, { k = kTeste, outra = false, empresa } = {}) => fetch(B + '/api/mcp', {
    method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }),
    headers: { authorization: 'Bearer ' + k, 'content-type': 'application/json', ...(outra ? { 'x-forwarded-host': 'outra.localhost' } : {}), ...(empresa ? { 'x-empresa': empresa } : {}) },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const textoMcp = (r) => r.json?.result?.content?.[0]?.text ?? '';

  // Telefones, textos e chaves únicos por rodada: o teste pode rodar de novo no mesmo banco.
  const RODADA = crypto.randomBytes(3).toString('hex');
  const dig = () => String(crypto.randomInt(10_000_000, 99_999_999));
  const TEL = '55479' + dig(), TEL_O = '55479' + dig();
  const CONT = sql(`insert into contatos (nome, telefone) values ('Empresa Ficticia', '${TEL}') returning id`);
  sql(`insert into contatos (nome, telefone) values ('Empresa Outra Ficticia', '${TEL_O}')`, URL_OUTRA);

  // ---- 1. Empresa no topo e no cabeçalho ----
  let r = await api('/api/v1', { k: null });
  ok('catálogo do banco padrão diz empresa "teste" no topo e no cabeçalho', r.status === 200 && r.json?.empresa?.slug === 'teste' && r.empresa === 'teste' && r.json?.modelo === 'clinica', curto(r.json?.empresa));
  r = await api('/api/v1', { k: null, outra: true });
  ok('catálogo de outra.localhost diz "clinica-outra", com nome e domínio', r.json?.empresa?.slug === 'clinica-outra' && r.json?.empresa?.dominio === 'outra.localhost' && Boolean(r.json?.empresa?.nome) && r.empresa === 'clinica-outra', curto(r.json?.empresa));
  r = await api(`/api/v1/ficha?telefone=${TEL}`);
  ok('ficha traz empresa no topo', r.status === 200 && r.json?.empresa?.slug === 'teste' && r.json?.encontrado === true, curto(r.json?.empresa));
  r = await api('/api/v1/config/modelo');
  ok('config traz empresa no topo (e o valor de sempre)', r.status === 200 && r.json?.empresa?.slug === 'teste' && r.json?.valor === 'clinica', curto(r.json));
  r = await api('/api/v1/config');
  ok('config inteira: empresa no topo e itens', r.json?.empresa?.slug === 'teste' && Array.isArray(r.json?.itens));

  // ---- 2. X-Empresa ----
  const notasAntes = sql(`select count(*) from notas`);
  r = await api('/api/v1/notas', { empresa: 'ssa', corpo: { alvo_tipo: 'contatos', alvo_id: CONT, texto: 'não pode gravar', autor: 'Teste' } });
  ok('X-Empresa diferente do endereço: 409 empresa_divergente', r.status === 409 && r.json?.detalhe?.codigo === 'empresa_divergente' && r.json?.detalhe?.empresa === 'teste', curto(r.json));
  ok('X-Empresa diferente: nada foi gravado', sql(`select count(*) from notas`) === notasAntes);
  r = await api('/api/v1/notas', { k: kOutra, outra: true, empresa: 'teste', corpo: { alvo_tipo: 'contatos', alvo_id: CONT, texto: 'x', autor: 'Teste' } });
  ok('X-Empresa "teste" em outra.localhost: 409, mesmo com a chave certa de lá', r.status === 409 && r.json?.detalhe?.empresa === 'clinica-outra', curto(r.json));
  r = await api(`/api/v1/ficha?telefone=${TEL_O}`, { k: kOutra, outra: true, empresa: 'clinica-outra' });
  ok('X-Empresa igual ao endereço: passa', r.status === 200 && r.json?.empresa?.slug === 'clinica-outra' && r.json?.encontrado === true, curto(r.json?.empresa));
  r = await api('/api/v1', { k: null, empresa: 'ssa' });
  ok('X-Empresa diferente: até o catálogo recusa', r.status === 409);

  // ---- 3. Chave de outra empresa: 401 e auditoria central ----
  const audAntes = Number(sql(`select count(*) from central_auditoria where acao = 'api_chave_recusada'`));
  r = await api(`/api/v1/ficha?telefone=${TEL_O}`, { k: kTeste, outra: true });
  ok('chave da "teste" em outra.localhost: 401', r.status === 401 && r.empresa === 'clinica-outra', curto(r.json));
  const aud = sql(`select empresa_id || '|' || alvo || '|' || (detalhe->>'rota') || '|' || (detalhe->>'chave') from central_auditoria where acao = 'api_chave_recusada' order by quando desc limit 1`);
  ok('chave recusada fica na auditoria central: empresa, endereço, rota e só o começo do hash',
    Number(sql(`select count(*) from central_auditoria where acao = 'api_chave_recusada'`)) === audAntes + 1 && aud === `clinica-outra|outra.localhost|GET /api/v1/ficha|${h(kTeste).slice(0, 8)}`, aud);
  await api(`/api/v1/ficha?telefone=${TEL_O}`, { k: kTeste, outra: true });
  ok('a mesma chave insistindo no mesmo minuto não enche a auditoria', Number(sql(`select count(*) from central_auditoria where acao = 'api_chave_recusada'`)) === audAntes + 1);
  ok('auditoria da chave recusada não guarda a chave', sql(`select count(*) from central_auditoria where detalhe::text like '%${kTeste}%' or detalhe::text like '%${h(kTeste)}%'`) === '0');

  // ---- 4. Modelo "empresa": nada de clínica no catálogo nem na ficha ----
  sql(`insert into crm_config (chave, valor) values ('modelo', '"empresa"') on conflict (chave) do update set valor = excluded.valor`, URL_OUTRA);
  sql(`update contatos set protocolo = 'em_analise' where telefone = '${TEL_O}'`, URL_OUTRA);
  r = await api('/api/v1', { k: null, outra: true });
  const { empresa: _e, ...semEmpresa } = r.json ?? {};
  const txt = JSON.stringify(semEmpresa).toLowerCase();
  const proibidas = ['paciente', 'feegow', 'clínica', 'clinica', 'consulta', 'protocolo', 'agendamento'].filter((p) => txt.includes(p));
  ok('modelo "empresa": catálogo sem servicos, sem protocolo e sem palavras de clínica', r.json?.modelo === 'empresa' && !r.json?.recursos?.some((x) => x.nome === 'servicos')
    && !('protocolo' in (r.json?.recursos?.find((x) => x.nome === 'contatos')?.campos ?? { protocolo: 1 })) && proibidas.length === 0, proibidas.join(', '));
  r = await api('/api/v1', { k: null });
  ok('modelo "clinica" (banco padrão) segue com tudo', r.json?.recursos?.some((x) => x.nome === 'servicos') && 'protocolo' in (r.json?.recursos?.find((x) => x.nome === 'contatos')?.campos ?? {}));
  r = await api(`/api/v1/ficha?telefone=${TEL_O}`, { k: kOutra, outra: true });
  ok('modelo "empresa": ficha sem servicos e sem protocolo no contato', r.status === 200 && !('servicos' in r.json) && r.json?.contatos?.[0] && !('protocolo' in r.json.contatos[0]) && 'pagamentos' in r.json, curto(Object.keys(r.json ?? {})));
  r = await mcp('tools/call', { name: 'descrever_crm', arguments: {} }, { k: kOutra, outra: true });
  ok('modelo "empresa": descrever_crm do conector também limpo', textoMcp(r).includes('"modelo": "empresa"') && !textoMcp(r).toLowerCase().includes('feegow'));
  sql(`update crm_config set valor = '"clinica"' where chave = 'modelo'`, URL_OUTRA);
  sql(`update contatos set protocolo = null where telefone = '${TEL_O}'`, URL_OUTRA);

  // ---- 5. Conector MCP ----
  r = await mcp('initialize', {}, { k: kOutra, outra: true });
  const ini = r.json?.result;
  ok('conector diz a empresa ao conectar (instructions e serverInfo)', ini?.instructions?.includes('"clinica-outra"') && ini?.instructions?.includes('outra.localhost') && ini?.serverInfo?.name === 'painel-planee-crm-clinica-outra', curto(ini?.serverInfo));
  r = await mcp('tools/call', { name: 'ficha_do_contato', arguments: { telefone: TEL_O } }, { k: kOutra, outra: true });
  ok('ficha_do_contato traz empresa', JSON.parse(textoMcp(r) || '{}')?.empresa?.slug === 'clinica-outra');
  r = await mcp('tools/call', { name: 'ler_config', arguments: { chave: 'modelo' } }, { k: kOutra, outra: true });
  ok('ler_config traz empresa', JSON.parse(textoMcp(r) || '{}')?.empresa?.slug === 'clinica-outra');
  r = await mcp('tools/call', { name: 'listar', arguments: { recurso: 'notas' } }, { k: kOutra, outra: true, empresa: 'teste' });
  ok('conector com X-Empresa diferente: 409, nada feito', r.status === 409);
  r = await mcp('tools/call', { name: 'listar', arguments: { recurso: 'notas' } }, { k: kTeste, outra: true });
  ok('conector com chave de outra empresa: recusa', r.json?.result?.isError === true && textoMcp(r).includes('Chave inválida'));

  // ---- 6. Idempotência por "chave" ----
  const nota = (chave) => api('/api/v1/notas', { corpo: { alvo_tipo: 'contatos', alvo_id: CONT, texto: 'Nota idempotente ' + RODADA, autor: 'Teste', chave } });
  const n1 = await nota('nota:1:' + RODADA); const n2 = await nota('nota:1:' + RODADA);
  ok('notas: 1ª chamada cria (201), a 2ª com a mesma chave devolve a mesma (200, repetido)', n1.status === 201 && n2.status === 200 && n2.json?.repetido === true && n2.json?.id === n1.json?.id, `${n1.status} ${n2.status}`);
  ok('notas: só uma no banco', sql(`select count(*) from notas where texto = 'Nota idempotente ${RODADA}'`) === '1');
  const n3 = await nota('nota:2:' + RODADA);
  ok('notas: chave diferente cria outra', n3.status === 201 && n3.json?.id !== n1.json?.id);
  const at = () => api('/api/v1/atendimentos', { corpo: { contato_id: CONT, topico_id: 'receita', resumo: 'Atendimento idempotente ' + RODADA, aberto_por: 'IA', chave: 'chamado:tel:maq:dia:' + RODADA } });
  const ats = await Promise.all([at(), at(), at(), at(), at()]);
  ok('atendimentos: 5 reenvios ao mesmo tempo = 1 cartão', sql(`select count(*) from atendimentos where resumo = 'Atendimento idempotente ${RODADA}'`) === '1'
    && new Set(ats.map((x) => x.json?.id)).size === 1 && ats.filter((x) => x.json?.repetido).length === 4, ats.map((x) => x.status).join(','));
  const aid = ats[0].json?.id;
  sql(`update atendimentos set etapa = 'em_atendimento' where id = '${aid}'`);
  const at2 = await at();
  ok('atendimentos: repetido devolve o cartão como está agora', at2.json?.repetido === true && at2.json?.etapa === 'em_atendimento', curto(at2.json));
  const op = (chave) => api('/api/v1/oportunidades', { corpo: { contato_id: CONT, etapa_id: 'novo', interesse: 'Oportunidade idempotente ' + RODADA, chave } });
  const o1 = await op('pedido:1:' + RODADA); const o2 = await op('pedido:1:' + RODADA);
  ok('oportunidades: mesma chave não duplica', o1.status === 201 && o2.json?.repetido === true && sql(`select count(*) from oportunidades where interesse = 'Oportunidade idempotente ${RODADA}'`) === '1');
  const TEL_F = '55479' + dig();
  const f = (chave, etapa = 'interesse') => api('/api/v1/funil', { corpo: { telefone: TEL_F, etapa_id: etapa, interesse: 'Funil idempotente ' + RODADA, chave } });
  const f1 = await f('pedido:tel:1:' + RODADA); const f2 = await f('pedido:tel:1:' + RODADA);
  ok('funil: mesma chave devolve o mesmo pedido, repetido', f1.status === 200 && f1.json?.criou === true && f2.json?.repetido === true && f2.json?.oportunidade?.id === f1.json?.oportunidade?.id, curto(f2.json));
  const f3 = await f('pedido:tel:1:' + RODADA, 'oferecido');
  ok('funil: mesma chave com outra etapa não move de novo (o pedido já foi feito)', f3.json?.repetido === true && f3.json?.oportunidade?.etapa_id === 'interesse');
  const f4 = await f('pedido:tel:2:' + RODADA, 'oferecido');
  ok('funil: chave nova move normalmente', f4.json?.movida === true && f4.json?.oportunidade?.etapa_id === 'oferecido' && !f4.json?.repetido);
  const f5 = await api('/api/v1/funil', { corpo: { telefone: TEL_F, etapa_id: 'oferecido' } });
  ok('funil: sem chave funciona como antes', f5.status === 200 && !f5.json?.repetido);
  r = await api('/api/v1/etapas', { corpo: { id: 'x-chave', nome: 'X', tipo: 'aberta', ordem: 99, chave: 'a' } });
  ok('chave em recurso que não aceita: 400 (campo que não existe)', r.status === 400 || r.status === 403, curto(r.json));
  r = await nota('x'.repeat(201));
  ok('chave com mais de 200 caracteres: 400', r.status === 400);
  ok('mesma chave em outra empresa é outra chave (banco dela)', (await api('/api/v1/notas', { k: kOutra, outra: true, corpo: { alvo_tipo: 'contatos', alvo_id: sql(`select id from contatos where telefone = '${TEL_O}'`, URL_OUTRA), texto: 'Nota outra', autor: 'Teste', chave: 'nota:1:' + RODADA } })).status === 201
    && sql(`select count(*) from api_idempotencia where chave = 'nota:1:${RODADA}'`, URL_OUTRA) === '1');
  r = await mcp('tools/call', { name: 'criar', arguments: { recurso: 'notas', dados: { alvo_tipo: 'contatos', alvo_id: CONT, texto: 'Nota idempotente ' + RODADA, autor: 'Teste', chave: 'nota:1:' + RODADA } } });
  ok('conector criar com a mesma chave: repetido', JSON.parse(textoMcp(r) || '{}')?.repetido === true, textoMcp(r).slice(0, 120));

  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas}/${res.length} OK`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
