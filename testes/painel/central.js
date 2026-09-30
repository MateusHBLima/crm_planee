// Testes da tarefa 0.8 (decisão 26): empresas, domínios, níveis, permissões e isolamento entre empresas.
// Roda pelo rodar.sh, depois do e2e.js (mesmo app e mesmo Auth falso). Usa *.localhost, que o Chromium
// resolve para 127.0.0.1: assim dá para testar "o endereço escolhe a empresa" sem DNS.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt "${url}"`, { input: q, env: process.env }).toString().trim();
const PORTA = new URL(process.env.BASE_URL || 'http://localhost:3100').port;
const GERAL = `http://localhost:${PORTA}`;
const OUTRA = `http://outra.localhost:${PORTA}`;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const nav = (p) => p.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()).join(','));
async function entrar(p, base, email, senha = 'senha123', destino = '/crm') {
  await p.goto(base + destino); await p.fill('#email', email); await p.fill('#senha', senha);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
}
const aviso = async (p) => ((await p.locator('main [role=status], main [role=alert]').first().textContent().catch(() => '')) || '').trim();

(async () => {
  const b = await lancar();
  const erros = [];
  const novo = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => erros.push(p.url() + ' ' + e.message.slice(0, 120))); return [c, p]; };

  // ---- Master cria a empresa, domínio, admin e banco próprio ----
  let [ctx, p] = await novo();
  await entrar(p, GERAL, 'planee@teste.local', 'senha123', '/empresas');
  ok('master abre Empresas', p.url().endsWith('/empresas'), p.url());
  await p.fill('#nova-nome', 'Clínica Outra');
  ok('identificador sugerido a partir do nome', (await p.inputValue('#nova-id')) === 'clinica-outra', await p.inputValue('#nova-id'));
  for (const id of ['inbox.ver', 'crm.editar', 'crm.arquivar', 'crm.config', 'resultados.ver']) await p.uncheck(`[id="nova-${id}"]`);
  await p.click('text=Criar empresa'); await p.waitForTimeout(1200);
  ok('empresa criada com só "Ver o CRM"', sql("select array_to_string(modulos, ',') from empresas where id='clinica-outra'") === 'crm.ver');
  const cartao = p.locator('article[data-empresa="clinica-outra"]');
  await cartao.locator('#dom-clinica-outra').fill('https://OUTRA.localhost/'); await cartao.getByRole('button', { name: 'Adicionar domínio' }).click(); await p.waitForTimeout(1000);
  ok('domínio normalizado e gravado', sql("select empresa_id from empresa_dominios where dominio='outra.localhost'") === 'clinica-outra');
  await cartao.locator('#dom-clinica-outra').fill('adm.planeelabia.com'); await cartao.getByRole('button', { name: 'Adicionar domínio' }).click(); await p.waitForTimeout(800);
  ok('domínio do painel da Planee é recusado', (await aviso(p)).includes('endereço do painel da Planee'), await aviso(p));
  await cartao.getByLabel('Nome do admin').fill('Admin Outra'); await cartao.getByLabel('E-mail do admin').fill('Admin2@Teste.local');
  await cartao.getByRole('button', { name: 'Adicionar admin' }).click(); await p.waitForTimeout(1000);
  ok('admin cadastrado (e-mail em minúsculas)', sql("select v.nivel from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='admin2@teste.local' and v.empresa_id='clinica-outra'") === 'admin');
  await cartao.getByLabel('Connection string do banco').fill(process.env.OUTRA_DATABASE_URL); await cartao.getByRole('button', { name: 'Salvar banco' }).click(); await p.waitForTimeout(1000);
  const cif = sql("select banco_url_cifrado from empresas where id='clinica-outra'");
  ok('banco da empresa guardado cifrado', cif.startsWith('v1:') && !cif.includes('postgres'), cif.slice(0, 12));
  ok('auditoria central registrou sem o endereço do banco', sql("select count(*) from central_auditoria where empresa_id='clinica-outra'") === '4' && sql("select count(*) from central_auditoria where detalhe::text like '%postgres%'") === '0');

  // Traefik
  const tr = await (await fetch(`${GERAL}/api/traefik`)).json();
  const rota = tr.http.routers['empresa-outra-localhost'];
  ok('/api/traefik publica o domínio com HTTPS', rota && rota.rule === 'Host(`outra.localhost`)' && rota.service === 'painel@swarm' && rota.tls.certResolver === 'letsencryptresolver', JSON.stringify(tr).slice(0, 200));

  // Master troca de empresa no endereço geral e vê o CRM da outra (banco próprio)
  await p.goto(GERAL + '/crm'); await p.selectOption('#trocar-empresa', 'clinica-outra'); await p.waitForTimeout(1500);
  ok('master troca para a Clínica Outra', ((await p.textContent('aside')) || '').includes('Clínica Outra'));
  ok('CRM da outra empresa vem do banco dela', (await p.locator('article', { hasText: 'Cartão só da Clínica Outra' }).count()) === 1 && (await p.locator('article', { hasText: 'Jorge Ficticio' }).count()) === 0);
  await p.selectOption('#trocar-empresa', 'teste'); await p.waitForTimeout(1500);
  ok('e volta para a empresa de teste', (await p.locator('article', { hasText: 'Cartão só da Clínica Outra' }).count()) === 0 && (await p.locator('article', { hasText: 'Jorge Ficticio' }).count()) >= 1);
  await ctx.close();

  // ---- O endereço escolhe a empresa; quem não é dela não entra ----
  [ctx, p] = await novo();
  await entrar(p, OUTRA, 'amanda@teste.local'); await p.waitForURL(/motivo=empresa/, { timeout: 5000 }).catch(() => {});
  ok('Amanda (só da empresa de teste) é barrada no domínio da outra', p.url().includes('/entrar') && (await aviso(p)).includes('não tem acesso a esta empresa'), p.url());
  await p.goto(OUTRA + '/crm'); ok('nem por URL direta', p.url().includes('/entrar'), p.url());
  await ctx.close();

  // ---- Primeiro acesso do admin da outra empresa, no domínio dela ----
  [ctx, p] = await novo();
  await p.goto(OUTRA + '/entrar'); ok('login mostra o nome da empresa do domínio', ((await p.textContent('main')) || '').includes('Clínica Outra'));
  await p.click('text=Primeiro acesso? Crie sua senha'); await p.waitForURL(/primeiro-acesso/); await p.waitForSelector('#repete');
  await p.fill('#email', 'naocadastrado@teste.local'); await p.fill('#senha', 'senhaforte1'); await p.fill('#repete', 'senhaforte1');
  await p.click('button[type=submit]'); await p.waitForTimeout(800);
  ok('primeiro acesso recusa e-mail não cadastrado', (await aviso(p)).includes('ainda não foi cadastrado'), await aviso(p));
  await p.fill('#email', 'admin2@teste.local'); await p.fill('#senha', 'senhaforte1'); await p.fill('#repete', 'senhaforte1');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(1000);
  ok('admin cria a senha e entra', p.url().endsWith('/crm'), p.url());
  ok('admin só vê o que a empresa tem (CRM) e a Equipe', (await nav(p)) === 'CRM,Equipe', await nav(p));
  ok('admin vê só o CRM da empresa dele', (await p.locator('article', { hasText: 'Cartão só da Clínica Outra' }).count()) === 1 && (await p.locator('article', { hasText: 'Jorge Ficticio' }).count()) === 0);
  await p.goto(OUTRA + '/resultados'); ok('admin não abre tela fora dos módulos', p.url().endsWith('/crm'), p.url());
  await p.goto(OUTRA + '/empresas'); ok('admin não abre Empresas', !p.url().endsWith('/empresas'), p.url());
  await p.goto(OUTRA + '/equipe');
  ok('admin não escolhe nível (só a Planee cria admin)', (await p.locator('#novo-nivel').count()) === 0);
  const perms = await p.$$eval('form[aria-labelledby="titulo-novo"] input[type=checkbox]', (xs) => xs.map((x) => x.id));
  ok('admin só distribui o que a empresa tem', perms.join(',') === 'novo-crm.ver', perms.join(','));
  await p.fill('#novo-nome', 'Membro Outra'); await p.fill('#novo-email', 'membro3@teste.local'); await p.click('text=/^Adicionar$/'); await p.waitForTimeout(1000);
  ok('admin adiciona membro com a permissão da empresa', sql("select array_to_string(v.permissoes, ',') from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='membro3@teste.local'") === 'crm.ver');
  await p.fill('#novo-nome', 'Membro Outra'); await p.fill('#novo-email', 'membro3@teste.local'); await p.click('text=/^Adicionar$/'); await p.waitForTimeout(800);
  ok('não duplica pessoa na equipe', (await aviso(p)).includes('já está na equipe'), await aviso(p));
  ok('admin não mexe no próprio acesso', (await p.locator('[data-email="admin2@teste.local"] button').count()) === 0);
  await ctx.close();

  // ---- Gestor (admin da empresa de teste) cuida da equipe ----
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'gestor@teste.local', 'senha123', '/equipe');
  ok('admin de teste abre Equipe', p.url().endsWith('/equipe'), p.url());
  ok('admin não vê pessoas de outra empresa', (await p.locator('[data-email="membro3@teste.local"]').count()) === 0 && (await p.locator('[data-email="amanda@teste.local"]').count()) === 1);
  ok('um só endereço e uma só empresa: sem seletor', (await p.locator('#trocar-empresa').count()) === 0);
  await p.fill('#novo-nome', 'Nova Secretária'); await p.fill('#novo-email', 'nova@teste.local');
  await p.click('form[aria-labelledby="titulo-novo"] >> text=Secretária'); await p.click('text=/^Adicionar$/'); await p.waitForTimeout(1000);
  ok('modelo Secretária aplicado', sql("select array_to_string(v.permissoes, ',') from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='nova@teste.local'") === 'inbox.ver,crm.ver,crm.editar');
  const linhaA = p.locator('[data-email="amanda@teste.local"]');
  await linhaA.getByRole('button', { name: 'Permissões' }).click(); await p.check('[id="ed-' + sql("select id from painel_usuarios where email='amanda@teste.local'") + '-crm.arquivar"]');
  await p.click('text=Salvar permissões'); await p.waitForTimeout(1000);
  ok('admin dá "Arquivar" para a Amanda', sql("select 'crm.arquivar' = any(v.permissoes) from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='amanda@teste.local'") === 't');
  await p.locator('[data-email="nova@teste.local"]').getByRole('button', { name: 'Desativar' }).click(); await p.waitForTimeout(1000);
  ok('admin desativa uma pessoa', sql("select v.ativo from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='nova@teste.local'") === 'f');
  await ctx.close();

  // ---- O master tira um módulo: a permissão some na hora, mesmo que o vínculo ainda a tenha ----
  [ctx, p] = await novo();
  sql("update empresas set modulos = array_remove(modulos, 'crm.ver') where id='teste'");
  await entrar(p, GERAL, 'amanda@teste.local', 'senha123', '/crm');
  ok('sem o módulo, a Amanda não vê o CRM', !p.url().endsWith('/crm') && !(await nav(p)).includes('CRM'), p.url() + ' ' + (await nav(p)));
  sql("update empresas set modulos = array_append(modulos, 'crm.ver') where id='teste'");
  await p.goto(GERAL + '/crm'); ok('módulo devolvido, CRM volta', p.url().endsWith('/crm'), p.url());
  ok('Amanda agora vê "Arquivar"', await (async () => { await p.locator('article').first().getByRole('button').first().click(); await p.waitForTimeout(800); return (await p.locator('text=Arquivar atendimento').count()) === 1; })());
  await ctx.close();

  // ---- Empresa desativada: ninguém dela entra ----
  [ctx, p] = await novo();
  sql("update empresas set ativo=false where id='clinica-outra'");
  await entrar(p, OUTRA, 'admin2@teste.local', 'senhaforte1'); await p.waitForURL(/entrar\?motivo/, { timeout: 5000 }).catch(() => {});
  ok('empresa desativada barra o admin dela', p.url().includes('/entrar'), p.url());
  const tr2 = await (await fetch(`${GERAL}/api/traefik`)).json();
  ok('e o domínio sai do Traefik', !tr2.http.routers['empresa-outra-localhost']);
  sql("update empresas set ativo=true where id='clinica-outra'");
  await ctx.close();

  // Master renomeia uma empresa pela tela Empresas
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'planee@teste.local', 'senha123', '/empresas');
  const cOutra = p.locator('article[data-empresa="clinica-outra"]');
  await cOutra.getByRole('button', { name: 'Renomear' }).click();
  await cOutra.getByLabel('Novo nome de Clínica Outra').fill('Clínica Outra (renomeada)');
  await cOutra.getByRole('button', { name: 'Salvar', exact: true }).click(); await p.waitForTimeout(1200);
  ok('master renomeia a empresa', sql("select nome from empresas where id='clinica-outra'") === 'Clínica Outra (renomeada)'
    && (await p.locator('article[data-empresa="clinica-outra"] h2').textContent()) === 'Clínica Outra (renomeada)'
    && sql("select count(*) from central_auditoria where empresa_id='clinica-outra' and detalhe::text like '%renomeada%'") === '1');
  await ctx.close();

  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
