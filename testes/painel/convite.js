// Link de convite de uso único (09/10): o admin gera o link na Equipe, a pessoa cria o próprio acesso e entra
// como membro com o acesso escolhido (padrão nenhum); o admin aumenta depois. Roda depois do central.js
// (usa a "Clínica Outra", o domínio outra.localhost e o admin2 que ele cria).
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const sql = (q) => execSync(`psql -qAt "${process.env.DATABASE_URL}"`, { input: q, env: process.env }).toString().trim();
const PORTA = new URL(process.env.BASE_URL || 'http://localhost:3100').port;
const GERAL = `http://localhost:${PORTA}`;
const OUTRA = `http://outra.localhost:${PORTA}`;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const nav = (p) => p.$$eval('nav a', (as) => as.map((a) => a.textContent.trim()).join(','));
async function entrar(p, base, email, senha = 'senha123', destino = '/equipe') {
  await p.goto(base + destino); await p.fill('#email', email); await p.fill('#senha', senha);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const alerta = async (p) => ((await p.locator('[role=alert]').first().textContent().catch(() => '')) || '').trim();
const tokenDe = (url) => url.split('/').pop();

(async () => {
  const b = await lancar();
  const erros = [];
  const novo = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', (e) => erros.push(p.url() + ' ' + e.message.slice(0, 120))); return [c, p]; };
  const gerar = async (p, acesso = '') => {
    await p.selectOption('#link-acesso', acesso);
    const antes = await p.inputValue('#link-gerado').catch(() => '');
    await p.getByRole('button', { name: 'Gerar link' }).click();
    await p.waitForFunction((a) => { const i = document.querySelector('#link-gerado'); return i && i.value && i.value !== a; }, antes, { timeout: 8000 });
    return p.inputValue('#link-gerado');
  };
  const cadastrar = async (p, url, nome, email, senha = 'senhaforte1', repete = senha) => {
    await p.goto(url); await p.waitForSelector('#repete');
    await p.fill('#nome', nome); await p.fill('#email', email); await p.fill('#senha', senha); await p.fill('#repete', repete);
    await p.click('button[type=submit]');
    // Deu certo: o navegador vai para o painel. Deu errado: aparece o aviso.
    await Promise.race([p.waitForURL((u) => !u.pathname.startsWith('/entrar'), { timeout: 8000 }), p.locator('[role=alert]').waitFor({ timeout: 8000 })]).catch(() => {});
    await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(300);
  };

  // ---- Gestor (admin da empresa de teste) gera os links ----
  const [cg, pg] = await novo();
  await entrar(pg, GERAL, 'gestor@teste.local');
  ok('Equipe mostra "Convidar por link"', (await pg.locator('#titulo-link').count()) === 1);
  ok('acesso padrão do link é nenhum', (await pg.inputValue('#link-acesso')) === '');
  const link1 = await gerar(pg);
  ok('link gerado no endereço atual, com token de 32 caracteres', new RegExp(`^${GERAL}/entrar/convite/[A-Za-z0-9_-]{32}$`).test(link1), link1);
  ok('no banco fica só o hash do link, sem acesso', sql(`select count(*) from convites_link where empresa_id='teste' and permissoes='{}' and token_hash <> '${tokenDe(link1)}'`) === '1'
    && sql(`select count(*) from convites_link where token_hash = '${tokenDe(link1)}'`) === '0');
  ok('gerar link fica na auditoria', sql("select count(*) from central_auditoria where acao='gerar_link_convite' and empresa_id='teste'") === '1');
  const link2 = await gerar(pg, 'secretaria');
  ok('link com o modelo Secretária leva as permissões dele', sql("select array_to_string(permissoes, ',') from convites_link where empresa_id='teste' order by criado_em desc limit 1") === 'inbox.ver,crm.ver,crm.editar'); // a empresa de teste não tem inbox.responder
  ok('lista os links ainda não usados', (await pg.locator('[data-link-ativo]').count()) === 2);
  await pg.locator('[data-link-ativo]').first().getByRole('button', { name: 'Cancelar link' }).click(); await pg.waitForTimeout(900);
  ok('cancelar tira o link da lista', (await pg.locator('[data-link-ativo]').count()) === 1
    && sql("select count(*) from convites_link where cancelado and array_length(permissoes,1) = 3") === '1');

  // ---- Link cancelado não abre ----
  let [ctx, p] = await novo();
  await p.goto(link2);
  ok('link cancelado mostra "Link inválido" e não tem formulário', ((await p.textContent('h1')) || '').includes('Link inválido') && (await p.locator('#senha').count()) === 0);
  await p.goto(GERAL + '/entrar/convite/curto');
  ok('link malformado também é inválido', ((await p.textContent('h1')) || '').includes('Link inválido'));
  await ctx.close();

  // ---- Pessoa nova entra pelo link, sem acesso ----
  [ctx, p] = await novo();
  await p.goto(link1);
  ok('página do convite mostra o nome da empresa, sem pedir login', ((await p.textContent('main')) || '').includes('Clínica Teste') || ((await p.textContent('main')) || '').includes('Você foi convidado'), p.url());
  await cadastrar(p, link1, 'Convidada Link', 'Convidada@Teste.local', 'senhaforte1', 'outrasenha1');
  ok('senhas diferentes são recusadas e o link não é gasto', (await alerta(p)).includes('não são iguais') && sql(`select count(*) from convites_link where usado_em is not null`) === '0', await alerta(p));
  await cadastrar(p, link1, 'Convidada Link', 'Convidada@Teste.local');
  ok('pessoa cria o acesso e entra', !p.url().includes('/entrar'), p.url());
  ok('entra só com a tela Planee (nenhum acesso)', (await nav(p)) === 'Planee', await nav(p));
  ok('a tela avisa que o admin vai liberar o acesso', (await p.locator('[data-sem-acesso]').count()) === 1);
  ok('vira membro da empresa do link, sem permissões', sql("select v.nivel || '|' || v.empresa_id || '|' || coalesce(array_to_string(v.permissoes, ','), '') from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='convidada@teste.local'") === 'membro|teste|');
  ok('o link fica marcado como usado por ela', sql("select count(*) from convites_link l join painel_usuarios u on u.id=l.usado_por where u.email='convidada@teste.local' and l.usado_em is not null") === '1');
  ok('a entrada pelo link fica na auditoria', sql("select count(*) from central_auditoria a join painel_usuarios u on u.id=a.usuario_id where a.acao='entrar_por_link' and u.email='convidada@teste.local'") === '1');
  await p.goto(GERAL + '/crm');
  ok('sem permissão, não abre o CRM', !p.url().endsWith('/crm'), p.url());
  const ctxConvidada = ctx; const pConvidada = p;

  // ---- O mesmo link não vale de novo ----
  [ctx, p] = await novo();
  await p.goto(link1);
  ok('link usado não abre de novo (uso único)', ((await p.textContent('h1')) || '').includes('Link inválido') && (await p.locator('#senha').count()) === 0);
  await ctx.close();

  // ---- Admin aumenta o acesso depois ----
  await pg.reload(); await pg.waitForTimeout(600);
  const linha = pg.locator('[data-email="convidada@teste.local"]');
  ok('na Equipe, a pessoa aparece "sem acesso ainda"', (await linha.locator('[data-sem-acesso]').count()) === 1);
  await linha.getByRole('button', { name: 'Permissões' }).click();
  await pg.check(`[id^="ed-"][id$="-crm.ver"]`);
  await pg.getByRole('button', { name: 'Salvar permissões' }).click(); await pg.waitForTimeout(900);
  await pConvidada.goto(GERAL + '/crm'); await pConvidada.waitForTimeout(600);
  ok('depois que o admin libera, a pessoa abre o CRM', pConvidada.url().endsWith('/crm') && (await nav(pConvidada)).includes('CRM'), pConvidada.url());
  await ctxConvidada.close();

  // ---- Quem já está na equipe, quem já tem senha e o master ----
  const link3 = await gerar(pg);
  [ctx, p] = await novo();
  await cadastrar(p, link3, 'Amanda', 'amanda@teste.local', 'senha123');
  ok('e-mail que já está na equipe é avisado e o link não é gasto', (await alerta(p)).includes('já está na equipe') && sql(`select count(*) from convites_link where usado_em is null and not cancelado and empresa_id='teste'`) === '1', await alerta(p));
  await cadastrar(p, link3, 'Planee', 'planee@teste.local', 'senha123');
  ok('o e-mail da Planee (master) não entra por convite', (await alerta(p)).includes('não pode entrar por convite'), await alerta(p));
  await cadastrar(p, link3, 'Admin Outra', 'admin2@teste.local', 'senhaerrada9');
  ok('quem já tem senha no painel precisa usar a mesma', (await alerta(p)).includes('já tem senha') && sql("select count(*) from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='admin2@teste.local' and v.empresa_id='teste'") === '0', await alerta(p));
  // Link de uma empresa aberto no domínio de outra não cria acesso.
  await cadastrar(p, link3.replace(GERAL, OUTRA), 'Admin Outra', 'admin2@teste.local', 'senhaforte1');
  ok('link aberto no domínio de outra empresa é recusado', (await alerta(p)).includes('exatamente como você recebeu'), await alerta(p));
  await cadastrar(p, link3, 'Admin Outra', 'admin2@teste.local', 'senhaforte1');
  ok('com a senha certa, entra também nesta empresa (como membro)', !p.url().includes('/entrar')
    && sql("select v.nivel from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='admin2@teste.local' and v.empresa_id='teste'") === 'membro'
    && sql("select v.nivel from painel_vinculos v join painel_usuarios u on u.id=v.usuario_id where u.email='admin2@teste.local' and v.empresa_id='clinica-outra'") === 'admin', p.url());
  await ctx.close();

  // ---- Link vencido ----
  const link4 = await gerar(pg);
  sql("update convites_link set expira_em = now() - interval '1 minute' where usado_em is null and not cancelado and empresa_id='teste'");
  [ctx, p] = await novo();
  await p.goto(link4);
  ok('link vencido mostra "Link inválido"', ((await p.textContent('h1')) || '').includes('Link inválido'));
  await ctx.close();
  await pg.reload(); await pg.waitForTimeout(500);
  ok('link vencido sai da lista', (await pg.locator('[data-link-ativo]').count()) === 0);
  await cg.close();

  // ---- Admin de outra empresa: só o que a empresa dele tem, só os links dele ----
  [ctx, p] = await novo();
  await entrar(p, OUTRA, 'admin2@teste.local', 'senhaforte1');
  ok('admin da outra empresa não vê os links da empresa de teste', (await p.locator('[data-link-ativo]').count()) === 0, p.url());
  const link5 = await gerar(p, 'gestor');
  ok('link no domínio da empresa', link5.startsWith(OUTRA + '/entrar/convite/'), link5);
  ok('modelo cortado ao que a empresa tem (só "Ver o CRM")', sql("select array_to_string(permissoes, ',') from convites_link where empresa_id='clinica-outra'") === 'crm.ver');
  await ctx.close();

  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
