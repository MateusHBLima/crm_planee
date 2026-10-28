// Nova empresa em um formulário só (28/10, lib/painel/nova-empresa.ts). Roda pelo rodar.sh, depois do central.js.
// O banco do "cliente" imita um projeto Supabase novo: usuário admin SEM superusuário (só CREATEROLE), pgcrypto no
// schema "extensions" e uma tabela do agente em public, que o painel não pode tocar. Confere: usuário painel_app e
// schema painel donos de tudo, base inteira, CRM do modelo, agente, chave do n8n que funciona, domínio, admin com
// primeiro acesso, nada de senha na auditoria, rodar de novo continua de onde parou, banco de outra empresa recusado,
// e o "Conectar número" nos dois modos.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt "${url}"`, { input: q, env: process.env }).toString().trim();
const PORTA = new URL(process.env.BASE_URL || 'http://localhost:3100').port;
const GERAL = `http://localhost:${PORTA}`;
const ID = 'loja-nova';
const DOMINIO = `${ID}.localhost`;
const NOVA = `http://${DOMINIO}:${PORTA}`;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));

// Banco do cliente (imitação do Supabase), criado com o superusuário local.
const base = new URL(process.env.DATABASE_URL);
const SUPER = `${base.protocol}//${base.username}:${base.password}@${base.host}/postgres`;
const SENHA_ADMIN = 'SenhaAdminCliente123';
const ADMIN_URL = `postgresql://admin_supa:${SENHA_ADMIN}@${base.host}/cliente_novo`;
const CLIENTE = `${base.protocol}//${base.username}:${base.password}@${base.host}/cliente_novo`;
sql(`drop database if exists cliente_novo;`, SUPER);
sql(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'admin_supa') then create role admin_supa login createrole password '${SENHA_ADMIN}'; end if;
  if exists (select 1 from pg_roles where rolname = 'painel_app') then execute 'grant painel_app to admin_supa with admin option'; end if;
end $$;`, SUPER);
sql(`create database cliente_novo owner admin_supa;`, SUPER);
sql(`create schema extensions; create extension pgcrypto schema extensions;
     create table public.mensagens_do_agente (id serial primary key, texto text); insert into public.mensagens_do_agente (texto) values ('do agente');
     alter table public.mensagens_do_agente owner to admin_supa;`, CLIENTE);

(async () => {
  const b = await lancar(); const erros = [];
  const novo = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => erros.push(p.url() + ' ' + e.message.slice(0, 120))); return [c, p]; };
  let [ctx, p] = await novo();
  await p.goto(GERAL + '/empresas'); await p.fill('#email', 'planee@teste.local'); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
  if (!p.url().endsWith('/empresas')) await p.goto(GERAL + '/empresas');

  const preencher = async (apelido, banco) => {
    await p.fill('#ne-nome', 'Loja Nova Assistência');
    if (apelido) await p.fill('#ne-apelido', apelido);
    await p.selectOption('#ne-modelo', 'assistencia');
    await p.fill('#ne-agente', 'Bia'); await p.fill('#ne-pausa', '45');
    await p.fill('#ne-admin-nome', 'Admin Loja'); await p.fill('#ne-admin-email', 'admin@loja-nova.local');
    await p.fill('#ne-banco', banco);
  };
  const alerta = async () => ((await p.locator('[data-nova-empresa] [role=alert]').textContent({ timeout: 800 }).catch(() => '')) || '').trim();
  // Clica em Criar e espera a resposta (o botão volta a ficar livre, ou o resultado aparece).
  const criar = async () => {
    await p.click('[data-criar-completa]'); await p.waitForTimeout(300);
    await p.waitForFunction(() => document.querySelector('[data-nova-resultado]') || !document.querySelector('[data-criar-completa]')?.disabled, null, { timeout: 90000 }).catch(() => undefined);
  };

  // ---- Erros que não gravam nada ----
  // No GitHub o Postgres de teste não confere senha (trust): ali o teste da senha errada não tem como recusar e fica de fora.
  const SENHA_CONFERIDA = (() => { try { execSync(`psql -qAt "${ADMIN_URL.replace(SENHA_ADMIN, 'senhaErrada')}" -c "select 1"`, { stdio: 'pipe', env: { ...process.env, PGPASSWORD: '' } }); return false; } catch { return true; } })();
  await preencher(null, SENHA_CONFERIDA ? ADMIN_URL.replace(SENHA_ADMIN, 'senhaErrada') : ADMIN_URL.replace('/cliente_novo', '/nao_existe'));
  ok('apelido sugerido a partir do nome', (await p.inputValue('#ne-apelido')) === 'loja-nova-assistencia', await p.inputValue('#ne-apelido'));
  ok('endereço previsto na tela', ((await p.textContent('[data-endereco-previsto]')) || '').includes('loja-nova-assistencia.localhost'));
  await p.fill('#ne-apelido', ID);
  await criar();
  let t = await alerta();
  if (SENHA_CONFERIDA) {
    ok('senha errada do banco: recusa e não cria nada', /senha recusados/.test(t) && sql(`select count(*) from empresas where id='${ID}'`) === '0'
      && sql(`select count(*) from pg_namespace where nspname='painel'`, CLIENTE) === '0', t);
  }
  await p.fill('#ne-banco', ADMIN_URL.replace('/cliente_novo', '/nao_existe'));
  await criar(); t = await alerta();
  ok('banco que não existe: mensagem clara', /não existe/.test(t), t);

  // ---- Cria tudo ----
  await p.fill('#ne-banco', ADMIN_URL);
  await criar();
  const codigo = ((await p.textContent('[data-convite-novo]').catch(() => '')) || '').trim();
  const chave = ((await p.textContent('[data-chave-n8n]').catch(() => '')) || '').trim();
  ok('empresa criada: tela mostra endereço, código do admin e chave do n8n', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo) && /^pk_[0-9a-f]{48}$/.test(chave)
    && ((await p.textContent('[data-dominio-novo]').catch(() => '')) || '') === DOMINIO, `${codigo} ${chave.slice(0, 6)} ${await alerta()}`);

  // Banco do cliente
  ok('usuário painel_app criado, sem superusuário, com search_path = painel', sql(`select rolsuper::text || '|' || array_to_string(rolconfig, ',') from pg_roles where rolname='painel_app'`, CLIENTE) === 'false|search_path=painel');
  ok('schema painel do painel_app, com todas as tabelas dele', sql(`select nspowner::regrole::text from pg_namespace where nspname='painel'`, CLIENTE) === 'painel_app'
    && Number(sql(`select count(*) from pg_tables where schemaname='painel'`, CLIENTE)) > 20
    && sql(`select count(*) from pg_tables where schemaname='painel' and tableowner <> 'painel_app'`, CLIENTE) === '0');
  ok('nada fora do schema painel foi tocado (tabela do agente intacta, nada novo em public)', sql(`select string_agg(tablename, ',') from pg_tables where schemaname='public'`, CLIENTE) === 'mensagens_do_agente'
    && sql(`select texto from public.mensagens_do_agente`, CLIENTE) === 'do agente');
  const totalBase = execSync('grep -c "^[0-9]" supabase/base-empresa.txt').toString().trim();
  ok('banco diz de quem é e tem a base inteira registrada', sql(`select id from painel.painel_empresa`, CLIENTE) === ID
    && sql(`select count(*) from painel.painel_migracoes where modulo='base'`, CLIENTE) === totalBase, sql(`select count(*) from painel.painel_migracoes`, CLIENTE));
  ok('CRM do modelo assistência: etapas, assuntos, termo "cliente"', sql(`select string_agg(nome, ',' order by ordem) from painel.crm_etapas`, CLIENTE) === 'Novo contato,Diagnóstico,Orçamento enviado,Follow up,Aprovado,Recusado'
    && sql(`select count(*) from painel.crm_topicos`, CLIENTE) === '6' && sql(`select valor #>> '{}' from painel.crm_config where chave='termo_contato'`, CLIENTE) === 'cliente'
    && sql(`select valor #>> '{}' from painel.crm_config where chave='modelo'`, CLIENTE) === 'assistencia');
  ok('agente configurado (nome, pausa, sem Assumir)', sql(`select valor::text from painel.crm_config where chave='agente'`, CLIENTE) === '{"nome": "Bia", "assumir": false, "pausa_min": 45}', sql(`select valor::text from painel.crm_config where chave='agente'`, CLIENTE));
  ok('chave do n8n: só o hash no banco, escopos leitura e crm', sql(`select nome || '|' || array_to_string(escopos, ',') from painel.api_chaves`, CLIENTE) === 'n8n|leitura,crm'
    && !sql(`select hash from painel.api_chaves`, CLIENTE).includes(chave));

  // Banco central
  ok('empresa no central com banco cifrado, módulos de Inbox e CRM, domínio', sql(`select banco_url_cifrado like 'v1:%' from empresas where id='${ID}'`) === 't'
    && sql(`select 'inbox.ver' = any(modulos) and 'inbox.responder' = any(modulos) and 'crm.ver' = any(modulos) and not 'pagamentos.ver' = any(modulos) from empresas where id='${ID}'`) === 't'
    && sql(`select empresa_id from empresa_dominios where dominio='${DOMINIO}'`) === ID);
  ok('admin cadastrado na empresa', sql(`select v.nivel from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='admin@loja-nova.local' and v.empresa_id='${ID}'`) === 'admin');
  const aud = sql(`select coalesce(string_agg(coalesce(detalhe::text,''), ' '), '') from central_auditoria where empresa_id='${ID}'`);
  ok('auditoria sem senha, connection string nem chave', aud.includes('"modelo": "assistencia"') && !aud.includes(SENHA_ADMIN) && !aud.includes('postgres') && !aud.includes(chave.slice(3, 20)), aud.slice(0, 160));
  ok('a senha do postgres não ficou em lugar nenhum do central', sql(`select count(*) from empresas where banco_url_cifrado like '%${SENHA_ADMIN}%'`) === '0');

  // A chave funciona na API do domínio da empresa e lê o banco novo
  const r = await fetch(GERAL + '/api/v1/etapas', { headers: { authorization: 'Bearer ' + chave, 'x-forwarded-host': DOMINIO } });
  const j = await r.json().catch(() => ({}));
  ok('chave do n8n lê as etapas do banco novo pela API', r.status === 200 && (j.dados || j.itens || j.data || j)?.length === 6, `${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  const r2 = await fetch(GERAL + '/api/v1/config/agente', { method: 'PUT', headers: { authorization: 'Bearer ' + chave, 'x-forwarded-host': DOMINIO, 'content-type': 'application/json' }, body: JSON.stringify({ valor: {} }) });
  ok('chave do n8n não mexe na configuração (sem escopo config)', r2.status === 403, String(r2.status));

  // ---- O admin da empresa nova entra pelo endereço dela e vê Inbox e CRM (antes de rodar de novo: no teste o
  // painel_app é um só para os dois bancos fictícios, e a segunda empresa troca a senha dele) ----
  // pelo endereço dela e vê Inbox e CRM ----
  const ctxMaster = ctx; const pMaster = p;
  [ctx, p] = await novo();
  await p.goto(NOVA + '/entrar');
  ok('login mostra o nome da empresa nova', ((await p.textContent('main')) || '').includes('Loja Nova Assistência'));
  await p.click('text=Primeiro acesso? Crie sua senha'); await p.waitForURL(/primeiro-acesso/); await p.waitForSelector('#repete');
  await p.fill('#email', 'admin@loja-nova.local'); await p.fill('#codigo', codigo); await p.fill('#senha', 'senhaforte1'); await p.fill('#repete', 'senhaforte1');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(1200);
  const menu = await p.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()).join(','));
  ok('admin entra e tem Inbox e CRM no menu', /Inbox/.test(menu) && /CRM/.test(menu), menu);
  await p.goto(NOVA + '/crm'); await p.waitForTimeout(1500);
  const main = (await p.textContent('main')) || '';
  ok('CRM abre com os assuntos do modelo, vazio de cartões de outra empresa', main.includes('Ordem de serviço') && main.includes('Garantia') && !main.includes('Jorge Ficticio'), main.slice(0, 200));
  await p.goto(NOVA + '/inbox'); await p.waitForTimeout(1500);
  ok('Inbox abre (sem erro de banco)', p.url().endsWith('/inbox') && !((await p.textContent('main')) || '').includes('não foi configurado'), ((await p.textContent('main')) || '').slice(0, 160));
  await ctx.close(); ctx = ctxMaster; p = pMaster;

  // ---- Rodar de novo: mesmo banco, outro apelido = recusado; mesmo apelido = já existe ----
  await p.click('text=Cadastrar outra');
  await preencher('outra-loja', ADMIN_URL); await criar(); t = await alerta();
  ok('banco que já é de outra empresa é recusado, sem gravar', t.includes(`já é da empresa "${ID}"`) && sql(`select count(*) from empresas where id='outra-loja'`) === '0', t);
  await p.fill('#ne-apelido', ID); await criar(); t = await alerta();
  ok('apelido repetido é recusado antes de abrir o banco', t.includes('Já existe uma empresa'), t);

  // Continua de onde parou: banco preparado sem a empresa no central (tentativa que caiu no meio).
  sql(`drop database if exists cliente_meio;`, SUPER); sql(`create database cliente_meio owner admin_supa;`, SUPER);
  const MEIO = ADMIN_URL.replace('/cliente_novo', '/cliente_meio');
  sql(`grant painel_app to admin_supa with admin option;`, SUPER);
  // Cria pela tela, apaga a empresa do central (como se a tela tivesse caído depois do banco) e cria de novo: a segunda
  // vez termina sem repetir migração nem duplicar o CRM.
  await preencher('loja-meio', MEIO); await criar();
  const antes = sql(`select count(*) from painel.painel_migracoes`, MEIO.replace(`admin_supa:${SENHA_ADMIN}`, `${base.username}:${base.password}`));
  sql(`delete from painel_vinculos where empresa_id='loja-meio'; delete from empresa_dominios where empresa_id='loja-meio'; delete from central_auditoria where empresa_id='loja-meio'; delete from empresas where id='loja-meio';`);
  await p.click('text=Cadastrar outra');
  await preencher('loja-meio', MEIO); await criar();
  const SUPERMEIO = MEIO.replace(`admin_supa:${SENHA_ADMIN}`, `${base.username}:${base.password}`);
  ok('rodar de novo no banco preparado continua: sem migração repetida, CRM sem duplicar, chave nova', (await p.locator('[data-nova-resultado="loja-meio"]').count()) === 1
    && sql(`select count(*) from painel.painel_migracoes`, SUPERMEIO) === antes && sql(`select count(*) from painel.crm_etapas`, SUPERMEIO) === '6'
    && sql(`select count(*) from painel.api_chaves`, SUPERMEIO) === '2' && sql(`select count(*) from empresas where id='loja-meio'`) === '1', `${antes} ${await alerta()}`);

  // ---- Conectar número (passo 3), na empresa loja-meio ----
  await p.fill('#cn-phone', '880000000001'); await p.fill('#cn-token', 'EAAtokenfalsodeteste1234567890');
  await p.check('input[name=cn-modo][value=direto]');
  await p.click('[data-conectar] button[type=submit]'); await p.waitForTimeout(400);
  ok('direto da Meta sem webhook: recusa (campo obrigatório)', sql(`select count(*) from whatsapp_numeros where phone_number_id='880000000001'`) === '0');
  await p.fill('#cn-webhook', 'https://n8n.exemplo.test/webhook/ia');
  await p.click('[data-conectar] button[type=submit]'); await p.waitForTimeout(1500);
  ok('direto da Meta: número com eco_url, sem repasse e sem pedir conexão', sql(`select coalesce(encaminhar_url,'-') || '|' || coalesce(eco_url,'-') || '|' || (conectar_pedido_em is null) || '|' || (token_cifrado like 'v1:%') from whatsapp_numeros where phone_number_id='880000000001'`) === '-|https://n8n.exemplo.test/webhook/ia|true|true');
  await p.fill('#cn-phone', '880000000002'); await p.fill('#cn-token', 'EAAtokenfalsodeteste1234567890'); await p.check('input[name=cn-modo][value=painel]'); await p.fill('#cn-webhook', '');
  await p.click('[data-conectar] button[type=submit]'); await p.waitForTimeout(1500);
  ok('pelo painel: número sem eco_url e com o pedido de conexão marcado', sql(`select coalesce(encaminhar_url,'-') || '|' || coalesce(eco_url,'-') || '|' || (conectar_pedido_em is not null) || '|' || empresa_id from whatsapp_numeros where phone_number_id='880000000002'`) === '-|-|true|loja-meio');
  await ctx.close();

  await b.close();

  ok('sem erro de página', erros.length === 0, erros.join(' | '));
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas}/${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
