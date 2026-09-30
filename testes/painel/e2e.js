// Testes de ponta a ponta do painel: login, papéis, quadro de atendimento, detalhe, abas, celular.
// Rodar pelo rodar.sh (sobe Postgres de teste, Auth falso e o app). Variáveis:
//   BASE_URL (padrão http://localhost:3100), DATABASE_URL (Postgres local descartável),
//   CHROMIUM_PATH (opcional: navegador já instalado), SAIDA (pasta das capturas, padrão ./saida)
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100'; const out = (process.env.SAIDA || __dirname + '/saida') + '/'; fs.mkdirSync(out, { recursive: true });
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra='') => { res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : '')); };
async function entrar(p, email, senha='senha123') {
  await p.goto(B + '/crm'); await p.fill('#email', email); await p.fill('#senha', senha);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800);
}
(async () => {
  const b = await lancar();
  let ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); let p = await ctx.newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await p.goto(B + '/crm'); ok('sem sessão vai para /entrar', p.url().includes('/entrar?volta=%2Fcrm'));
  await entrar(p, 'amanda@teste.local', 'errada'); ok('senha errada mostra erro', (await p.textContent('[role=alert]')||'').includes('incorretos'));
  await entrar(p, 'semacesso@teste.local'); ok('e-mail sem acesso é barrado', (await p.textContent('[role=alert]')||'').includes('não tem acesso'));
  await entrar(p, 'amanda@teste.local'); ok('Amanda entra e cai no CRM', p.url().endsWith('/crm'), p.url());
  await p.screenshot({ path: out + '01_quadro_claro.png' });
  const nav = await p.$$eval('nav a', (as) => as.map((a) => a.textContent.trim())); ok('secretaria vê só Inbox e CRM', nav.join(',') === 'Inbox,CRM', nav.join(','));
  const cols = await p.$$eval('section[aria-label]', (s) => s.map((x) => x.getAttribute('aria-label'))); ok('colunas por assunto', cols.includes('Receita') && cols.includes('Valores e pagamento'), cols.join('|'));
  ok('selo sombra aparece', (await p.locator('text=sombra').count()) >= 2);
  // Assumir o cartão da Rita
  const rita = p.locator('article', { hasText: 'Rita Ficticia' }); await rita.getByRole('button', { name: 'Assumir' }).click(); await p.waitForTimeout(1500);
  ok('Assumir muda para Em atendimento', (await rita.textContent()).includes('Em atendimento'));
  ok('responsável gravado', sql("select responsavel || '|' || (assumido_em is not null) from atendimentos a join contatos c on c.id=a.contato_id where c.nome='Rita Ficticia'") === 'Amanda Teste|true');
  ok('auditoria com usuario_id', sql("select count(*) from painel_auditoria p join painel_usuarios u on u.id=p.usuario_id where u.email='amanda@teste.local' and p.acao='atualizar'") === '1');
  // Detalhe + nota
  await rita.getByRole('button', { name: 'Rita Ficticia' }).click(); await p.waitForSelector('aside[aria-label^="Atendimento"]'); await p.waitForTimeout(800);
  await p.fill('#nova-nota', 'Liguei para a paciente, confirmou o Pix.'); await p.click('text=Salvar nota'); await p.waitForTimeout(1200);
  const hist = await p.textContent('aside[aria-label^="Atendimento"] ol'); ok('nota aparece no histórico', hist.includes('confirmou o Pix') && hist.includes('Assumiu'), hist.replace(/\s+/g,' ').slice(0,200));
  ok('nota gravada com autor', sql("select autor from notas where texto like 'Liguei%'") === 'Amanda Teste');
  ok('secretaria não vê Arquivar', (await p.locator('text=Arquivar atendimento').count()) === 0);
  await p.screenshot({ path: out + '02_detalhe.png' });
  // mudar assunto
  await p.selectOption('#det-assunto', 'outros'); await p.waitForTimeout(1500);
  ok('mudar assunto move o cartão', (await p.locator('section[aria-label="Outros"] article', { hasText: 'Rita Ficticia' }).count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok('Esc fecha o detalhe', (await p.locator('aside[aria-label^="Atendimento"]').count()) === 0);
  // Finalizar
  const rita2 = p.locator('article', { hasText: 'Rita Ficticia' }); await rita2.getByRole('button', { name: 'Finalizar' }).click(); await p.waitForTimeout(1500);
  ok('Finalizar tira do quadro', (await p.locator('article', { hasText: 'Rita Ficticia' }).count()) === 0);
  await p.click('text=/Mostrar finalizados hoje/'); await p.waitForTimeout(300);
  ok('Mostrar finalizados traz de volta', (await p.locator('article', { hasText: 'Rita Ficticia' }).count()) === 1);
  // Filtro sombra e busca
  await p.click('button:has-text("Só sombra")'); await p.waitForTimeout(200);
  ok('filtro só sombra', (await p.locator('article', { hasText: 'Pede encaixe' }).count()) === 0 && (await p.locator('article', { hasText: 'Jorge Ficticio' }).count()) >= 1);
  await p.click('button:has-text("Todos")'); await p.fill('#busca-crm', '0012'); await p.waitForTimeout(200);
  ok('busca por final do telefone', (await p.locator('article').count()) === 1, String(await p.locator('article').count()));
  await p.fill('#busca-crm', '');
  // concorrência: outra pessoa já assumiu
  const idMarina = sql("select a.id from atendimentos a join contatos c on c.id=a.contato_id where c.nome='Marina Teste'");
  sql(`update atendimentos set etapa='em_atendimento', responsavel='Outra Pessoa' where id='${idMarina}'`);
  await p.locator('article', { hasText: 'Marina Teste' }).getByRole('button', { name: 'Assumir' }).click(); await p.waitForTimeout(1500);
  ok('não assume o que outra pessoa já assumiu', ((await p.textContent('[role=status]'))||'').includes('Outra Pessoa já assumiu'), await p.textContent('[role=status]'));
  // atualização automática: cartão novo entra sozinho
  sql("insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('00000000-0000-4000-8000-000000000002','receita','Cartão novo aberto pela Sara durante o teste','IA')");
  await p.waitForTimeout(17000);
  ok('cartão novo aparece sozinho em 15 s', (await p.locator('article', { hasText: 'Cartão novo aberto pela Sara' }).count()) === 1);
  // abas
  await p.click('role=tab[name="Comercial"]'); await p.waitForTimeout(1200); await p.screenshot({ path: out + '03_comercial.png' });
  ok('aba Comercial', (await p.locator('text=Agendamento confirmado').count()) >= 1);
  await p.click('role=tab[name="Contatos"]'); await p.waitForTimeout(1200); await p.click('button:has-text("Jorge Ficticio")'); await p.waitForTimeout(1200);
  await p.screenshot({ path: out + '04_contatos.png' });
  ok('aba Contatos com atendimentos do contato', (await p.locator('text=Mandou resultado de hemograma').count()) === 1);
  // tema escuro
  await p.click('role=tab[name="Atendimento"]'); await p.click('text=Tema escuro'); await p.waitForTimeout(400); await p.screenshot({ path: out + '05_quadro_escuro.png' });
  // sair
  await p.click('button[aria-label="Sair do painel"]'); await p.waitForTimeout(800); ok('Sair volta ao login', p.url().includes('/entrar'));
  await p.goto(B + '/crm'); ok('depois de sair não entra', p.url().includes('/entrar'));
  // planee: CPF mascarado
  await entrar(p, 'planee@teste.local');
  const txtJ = await p.locator('article', { hasText: 'Jorge Ficticio' }).first().textContent();
  ok('Planee vê CPF mascarado (campo e texto)', !txtJ.includes('111.222.333') && txtJ.includes('***.***.***-44'), txtJ.slice(0,160));
  const navP = await p.$$eval('nav a', (as) => as.map((a) => a.textContent.trim())); ok('Planee (master) vê as 7 telas', navP.join(',') === 'Inbox,CRM,Resultados,Configurações,Equipe,Empresas,Interno Planee', navP.join(','));
  await p.goto(B + '/configuracoes'); ok('tela ainda em construção abre', (await p.locator('text=em construção').count()) === 1);
  await ctx.close();
  // gestor arquiva
  ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); p = await ctx.newPage();
  await entrar(p, 'gestor@teste.local'); await p.goto(B + '/resultados'); ok('gestor abre Resultados', p.url().endsWith('/resultados'));
  await p.goto(B + '/crm'); await p.locator('article', { hasText: 'Pede encaixe' }).getByRole('button').first().click(); await p.waitForTimeout(800);
  await p.click('text=Arquivar atendimento'); await p.click('text=/^Arquivar$/'); await p.waitForTimeout(1500);
  ok('gestor arquiva', (await p.locator('article', { hasText: 'Pede encaixe' }).count()) === 0 && sql("select arquivado from atendimentos where resumo like 'Pede encaixe%'") === 't');
  await ctx.close();
  // secretaria tentando URL de tela de gestor
  ctx = await b.newContext(); p = await ctx.newPage(); await entrar(p, 'amanda@teste.local'); await p.goto(B + '/configuracoes');
  ok('secretaria não abre Configurações por URL', !p.url().endsWith('/configuracoes'), p.url());
  // desativar usuário derruba a sessão
  sql("update painel_usuarios set ativo=false where email='amanda@teste.local'"); await p.goto(B + '/crm');
  ok('usuário desativado perde acesso', p.url().includes('/entrar'), p.url()); sql("update painel_usuarios set ativo=true where email='amanda@teste.local'");
  await ctx.close();
  // celular
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); p = await ctx.newPage(); await entrar(p, 'amanda@teste.local');
  await p.screenshot({ path: out + '06_celular.png' });
  const larg = await p.evaluate(() => document.documentElement.scrollWidth); ok('celular sem rolagem lateral da página', larg <= 390, String(larg));
  await p.locator('article').first().getByRole('button').first().click(); await p.waitForTimeout(800); await p.screenshot({ path: out + '07_celular_detalhe.png' });
  await ctx.close();
  ok('sem erro no console', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
