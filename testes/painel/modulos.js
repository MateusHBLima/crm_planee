// Módulos por empresa (16/10, docs/modulos.md): duas empresas fictícias, "teste" (banco padrão) e "clinica-outra"
// (banco próprio, criada pelo central.js), e o módulo fictício "teste_notas" (só existe no build dos testes).
// Confere: SQL de módulo trava no banco errado e não grava nada; marcado sem SQL = 409; desligado = 404 e fora do
// catálogo e da ficha; ligado = rota, catálogo e bloco na ficha; banco que diz ser de outra empresa não liga nada;
// tela Empresas mostra a situação; o master só tem permissão de módulo que a empresa tem.
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const URL_OUTRA = process.env.OUTRA_DATABASE_URL;
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
// Roda e devolve o erro do Postgres (ou '' se passou), sem derrubar o teste.
const sqlErro = (q, url) => {
  try { execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] }); return ''; } catch (e) { return String(e.stderr || e.message); }
};
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const MOD_SQL = fs.readFileSync(path.join(__dirname, 'modulos/teste_notas/001_notas.sql'), 'utf8');
const modSql = (empresa) => MOD_SQL.replace('TROQUE_PELO_ID_DA_EMPRESA', empresa);
const tabelaExiste = (url) => sql(`select count(*) from pg_tables where tablename = 'mod_teste_notas'`, url) === '1';
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}

// efetivas() de verdade (lib/permissoes.ts + lib/modulos.ts), transpilado aqui, com o módulo de teste ligado no build.
function carregarPermissoes() {
  const ts = require(path.join(__dirname, '../../node_modules/typescript'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-'));
  for (const f of ['permissoes', 'modulos']) {
    const fonte = fs.readFileSync(path.join(__dirname, `../../lib/${f}.ts`), 'utf8');
    fs.writeFileSync(path.join(dir, `${f}.js`), ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
  }
  process.env.NEXT_PUBLIC_PAINEL_MODULO_TESTE = '1';
  return require(path.join(dir, 'permissoes.js'));
}

(async () => {
  // ---- Chaves da API nas duas empresas (só o hash fica no banco) ----
  const h = (k) => crypto.createHash('sha256').update(k).digest('hex');
  const kTeste = 'mod-teste-' + crypto.randomBytes(8).toString('hex');
  const kOutra = 'mod-outra-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Módulos teste', '${h(kTeste)}', array['leitura','crm'])`);
  sql(`insert into api_chaves (nome, hash, escopos) values ('Módulos outra', '${h(kOutra)}', array['leitura','crm'])`, URL_OUTRA);
  // A outra empresa é escolhida pelo endereço: o painel lê x-forwarded-host antes do Host (lib/empresa.ts).
  const api = (caminho, { k = kTeste, corpo, metodo, outra = false } = {}) => fetch(B + caminho, {
    method: metodo ?? (corpo === undefined ? 'GET' : 'POST'), body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { ...(k ? { authorization: 'Bearer ' + k } : {}), 'content-type': 'application/json', ...(outra ? { 'x-forwarded-host': 'outra.localhost' } : {}) },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const TEL = '5547900007001', TEL_O = '5547900007002';
  const CONT = sql(`insert into contatos (nome, telefone) values ('Modulo Ficticio', '${TEL}') returning id`);
  sql(`insert into contatos (nome, telefone) values ('Modulo Outra Ficticia', '${TEL_O}')`, URL_OUTRA);
  const temNoCatalogo = (j) => Boolean(j?.recursos?.some((r) => r.nome === 'teste_notas'));

  // ---- Banco de cada empresa diz de quem é (migração 027, rodar.sh) ----
  ok('migração 027 nos dois bancos, cada um com a sua empresa',
    sql('select id from painel_empresa') === 'teste' && sql('select id from painel_empresa', URL_OUTRA) === 'clinica-outra');

  // ---- Desligado: 404, fora do catálogo e da ficha ----
  let r = await api('/api/v1/teste_notas');
  ok('módulo desligado: rota responde 404', r.status === 404, JSON.stringify(r.json).slice(0, 120));
  r = await api('/api/v1', { k: null });
  ok('módulo desligado: catálogo não lista o recurso', r.status === 200 && !temNoCatalogo(r.json) && (r.json.modulos ?? []).length === 0);
  r = await api(`/api/v1/ficha?telefone=${TEL}`);
  ok('módulo desligado: a chave do módulo nem aparece na ficha', r.status === 200 && r.json.contatos?.[0] && !('teste_notas' in r.json.contatos[0]));

  // ---- Marcado sem o SQL: 409, nada consulta tabela que não existe ----
  sql(`update empresas set modulos = array_append(modulos, 'm.teste_notas.ver') where id = 'teste' and not 'm.teste_notas.ver' = any(modulos)`);
  r = await api('/api/v1/teste_notas');
  ok('marcado sem o SQL: 409 modulo_sem_migracao', r.status === 409 && r.json?.detalhe?.codigo === 'modulo_sem_migracao', JSON.stringify(r.json).slice(0, 160));
  r = await api('/api/v1', { k: null });
  ok('marcado sem o SQL: catálogo ainda não lista', !temNoCatalogo(r.json));

  // ---- Trava do SQL de módulo: banco errado e id esquecido não gravam nada ----
  let erro = sqlErro(modSql('teste'), URL_OUTRA);
  ok('SQL do módulo no banco de OUTRA empresa: aborta e não cria nada', erro.includes('é da empresa "clinica-outra", não de "teste"') && !tabelaExiste(URL_OUTRA), erro.slice(0, 160));
  erro = sqlErro(MOD_SQL, process.env.DATABASE_URL);
  ok('SQL do módulo sem trocar o id da empresa: aborta e não cria nada', erro.includes('Troque TROQUE_PELO_ID_DA_EMPRESA') && !tabelaExiste(process.env.DATABASE_URL), erro.slice(0, 160));

  // ---- SQL certo: liga ----
  erro = sqlErro(modSql('teste'), process.env.DATABASE_URL) + sqlErro(modSql('teste'), process.env.DATABASE_URL);
  ok('SQL do módulo no banco certo: cria e registra (rodar de novo não muda nada)', !erro && tabelaExiste(process.env.DATABASE_URL)
    && sql(`select string_agg(id || ':' || modulo, ',') from painel_migracoes`) === 'teste_notas/001:teste_notas', erro.slice(0, 160));
  r = await api('/api/v1/teste_notas', { corpo: { contato_id: CONT, texto: 'Nota do módulo' } });
  ok('ligado: cria pelo recurso do módulo (com auditoria)', r.status === 201 && r.json?.texto === 'Nota do módulo'
    && sql(`select count(*) from painel_auditoria where recurso = 'teste_notas' and acao = 'criar'`) === '1', JSON.stringify(r.json).slice(0, 160));
  r = await api(`/api/v1/teste_notas?contato_id=${CONT}`);
  ok('ligado: lista pelo recurso do módulo', r.status === 200 && r.json?.itens?.length === 1);
  r = await api('/api/v1', { k: null });
  ok('ligado: catálogo lista o recurso e o módulo', temNoCatalogo(r.json) && r.json.modulos?.[0]?.id === 'teste_notas');
  r = await api(`/api/v1/ficha?telefone=${TEL}`);
  ok('ligado: bloco do módulo na ficha do contato', JSON.stringify(r.json?.contatos?.[0]?.teste_notas) === '["Nota do módulo"]', JSON.stringify(r.json?.contatos?.[0]).slice(0, 200));

  // ---- A outra empresa não vê nada do módulo ----
  r = await api('/api/v1/teste_notas', { k: kOutra, outra: true });
  ok('outra empresa: rota do módulo responde 404', r.status === 404, JSON.stringify(r.json).slice(0, 120));
  r = await api('/api/v1', { k: null, outra: true });
  ok('outra empresa: catálogo do endereço dela não lista o módulo', r.status === 200 && !temNoCatalogo(r.json));
  r = await api(`/api/v1/ficha?telefone=${TEL_O}`, { k: kOutra, outra: true });
  ok('outra empresa: ficha sem a chave do módulo', r.status === 200 && r.json.contatos?.[0] && !('teste_notas' in r.json.contatos[0]));
  ok('outra empresa: nada do módulo foi criado no banco dela', !tabelaExiste(URL_OUTRA));

  // ---- Banco trocado: o banco diz que é de outra empresa, nenhum módulo vale ----
  sql(`update painel_empresa set id = 'outra-coisa'`);
  r = await api('/api/v1/teste_notas');
  ok('banco que diz ser de outra empresa: módulo não liga (409)', r.status === 409, JSON.stringify(r.json).slice(0, 120));
  const b = await lancar();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message.slice(0, 120)));
  await entrar(p, 'planee@teste.local', '/empresas');
  const cartao = (id) => p.locator(`article[data-empresa="${id}"]`);
  ok('tela Empresas avisa do banco trocado', (await cartao('teste').locator('[data-modulos-problema="banco_de_outra_empresa"]').count()) === 1);
  sql(`update painel_empresa set id = 'teste'`);

  // ---- Tela Empresas: situação de cada módulo ----
  await p.reload(); await p.waitForLoadState('networkidle');
  ok('tela Empresas: módulo instalado na empresa teste', (await cartao('teste').locator('[data-modulo="teste_notas"]').getAttribute('data-estado')) === 'ligado');
  ok('tela Empresas: módulo desligado na outra', (await cartao('clinica-outra').locator('[data-modulo="teste_notas"]').getAttribute('data-estado')) === 'desligado');
  // O master marca o módulo na outra pela tela, sem rodar o SQL: a tela avisa e a API dá 409.
  await cartao('clinica-outra').locator('[id="mod-clinica-outra-m.teste_notas.ver"]').check();
  await cartao('clinica-outra').getByRole('button', { name: 'Salvar módulos' }).click(); await p.waitForTimeout(1200);
  ok('marcar pela tela grava a permissão do módulo', sql(`select 'm.teste_notas.ver' = any(modulos) from empresas where id = 'clinica-outra'`) === 't');
  ok('tela Empresas: marcado sem o SQL mostra a pasta do SQL', (await cartao('clinica-outra').locator('[data-modulo="teste_notas"]').getAttribute('data-estado')) === 'sem_migracao'
    && ((await cartao('clinica-outra').locator('[data-modulo="teste_notas"]').textContent()) || '').includes('testes/painel/modulos/teste_notas/'));
  r = await api('/api/v1/teste_notas', { k: kOutra, outra: true });
  ok('outra empresa marcada sem o SQL: 409', r.status === 409);
  await ctx.close(); await b.close();
  sql(`update empresas set modulos = array_remove(modulos, 'm.teste_notas.ver') where id = 'clinica-outra'`);

  // ---- Permissões: o master só tem módulo que a empresa tem; ninguém tem módulo sem o SQL ----
  const { efetivas } = carregarPermissoes();
  const LIG = new Set(['teste_notas']);
  ok('master sem o módulo na empresa: não tem a permissão do módulo', !efetivas('master', ['crm.ver'], [], LIG).includes('m.teste_notas.ver')
    && efetivas('master', ['crm.ver'], [], LIG).includes('agente.config'));
  ok('master com o módulo marcado e ligado: tem', efetivas('master', ['m.teste_notas.ver'], [], LIG).includes('m.teste_notas.ver'));
  ok('admin com o módulo marcado mas sem o SQL: não tem', !efetivas('admin', ['crm.ver', 'm.teste_notas.ver'], [], new Set()).includes('m.teste_notas.ver')
    && efetivas('admin', ['crm.ver', 'm.teste_notas.ver'], [], new Set()).includes('crm.ver'));
  ok('membro: só o que o admin deu, dentro do que está ligado', JSON.stringify(efetivas('membro', ['crm.ver', 'm.teste_notas.ver', 'm.teste_notas.editar'], ['m.teste_notas.ver'], LIG)) === '["m.teste_notas.ver"]');

  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  // Deixa a empresa teste como estava para os testes seguintes (o módulo marcado não muda nada fora dele).
  sql(`update empresas set modulos = array_remove(modulos, 'm.teste_notas.ver') where id = 'teste'`);
  console.log(res.join('\n'));
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
