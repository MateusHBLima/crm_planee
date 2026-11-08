// Cliente novo sem Portainer (06/11, migração 033). Roda pelo rodar.sh depois do nova-empresa.js.
// Confere, na tela Empresas (master):
//   - token da Feegow colado na tela: testado na Feegow (falsa) antes de guardar; recusado não é guardado; aceito fica
//     cifrado e liga a integração "feegow"; a tela mostra a situação;
//   - segredo do n8n por empresa: gerado na tela, aparece uma vez, fica cifrado, e o painel passa a mandar esse
//     segredo (e não o geral) no cabeçalho x-painel-segredo da empresa (pela aba Dúvidas);
//   - botão "Conectar WhatsApp" (cadastro incorporado da Meta, com o SDK falso): abre com o config_id e a coexistência,
//     e o número chega com conta, código cifrado e pedido de conexão; cancelar não grava nada.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const PORTA_FEEGOW = Number((process.env.FEEGOW_API_URL || 'http://127.0.0.1:3997').split(':').pop());
const PORTA_IA = 3994;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
const BOM = 'feegow-token-bom-ficticio-123456';

async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const subir = (porta, fn) => new Promise((ok2) => { const s = http.createServer(fn); s.listen(porta, '127.0.0.1', () => ok2(s)); });

(async () => {
  // Feegow falsa: só o token bom lista profissionais.
  const feegow = await subir(PORTA_FEEGOW, (req, resp) => {
    const bom = req.headers['x-access-token'] === BOM;
    resp.writeHead(bom ? 200 : 401, { 'content-type': 'application/json' });
    resp.end(JSON.stringify(bom ? { success: true, content: req.url.includes('ativo=1') ? [{ profissional_id: 1, nome: 'Dra Ficticia' }] : [] } : { success: false }));
  });
  // Agente das Dúvidas falso: guarda o cabeçalho recebido.
  const recebidos = [];
  const ia = await subir(PORTA_IA, (req, resp) => {
    let c = ''; req.on('data', (x) => { c += x; });
    req.on('end', () => { recebidos.push(req.headers['x-painel-segredo']); resp.writeHead(200, { 'content-type': 'application/json' }); resp.end(JSON.stringify({ resposta: 'ok fictício', erro: null })); });
  });

  const b = await lancar(); const erros = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(e.message.slice(0, 160)));
  // SDK da Meta falso: devolve a conta e o número pela mensagem da janela (origem facebook.com) e o código no login.
  await ctx.route('https://connect.facebook.net/**', (rota) => rota.fulfill({ contentType: 'application/javascript', body: `
    window.FB = { init: function (o) { window.__fbInit = o; }, login: function (cb, opt) {
      window.__fbOpt = opt;
      if (window.__cancelar) {
        window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE_NUMBER_SETUP' } }) }));
        setTimeout(function () { cb({ authResponse: null, status: 'unknown' }); }, 30); return;
      }
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://www.facebook.com', data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', data: { waba_id: '888000111', phone_number_id: '999000111' } }) }));
      setTimeout(function () { cb({ authResponse: { code: 'codigo-ficticio-do-cadastro-1234567890' } }); }, 30);
    } };
    window.fbAsyncInit && window.fbAsyncInit();` }));
  await entrar(p, 'planee@teste.local', '/empresas');
  await p.goto(B + '/empresas'); await p.waitForLoadState('networkidle');
  const cartao = (id) => p.locator(`article[data-empresa="${id}"]`);
  const alerta = async () => ((await p.locator('[role=alert]').first().textContent().catch(() => '')) || '');

  // ---- Feegow ----
  ok('sem token: a outra empresa mostra "Sem token"', (await cartao('clinica-outra').locator('[data-feegow]').getAttribute('data-feegow')) === 'nao');
  ok('empresa com token na stack: avisa que é o antigo', (await cartao('teste').locator('[data-feegow]').getAttribute('data-feegow')) === 'stack');
  await cartao('clinica-outra').locator('#feegow-clinica-outra').fill('feegow-token-ruim-ficticio-0000');
  await cartao('clinica-outra').locator('[data-integracoes] form button[type=submit]').click(); await p.waitForTimeout(1500);
  ok('token recusado pela Feegow: avisa e não guarda', (await alerta()).includes('Token não guardado')
    && sql(`select count(*) from empresa_integracoes where empresa_id = 'clinica-outra' and sistema = 'feegow' and token_cifrado is not null`) === '0', await alerta());
  await cartao('clinica-outra').locator('#feegow-clinica-outra').fill(BOM);
  await cartao('clinica-outra').locator('[data-integracoes] form button[type=submit]').click(); await p.waitForTimeout(1800);
  const linha = sql(`select ativo || '|' || (token_cifrado like 'v1:%') || '|' || (position('${BOM}' in token_cifrado) = 0) || '|' || (teste_em is not null) from empresa_integracoes where empresa_id = 'clinica-outra' and sistema = 'feegow'`);
  ok('token aceito: guardado cifrado, integração feegow ligada e testada', linha === 'true|true|true|true', linha);
  ok('tela mostra "Token testado · espelho da agenda ligado"', (await cartao('clinica-outra').locator('[data-feegow]').getAttribute('data-feegow')) === 'ok');
  ok('Registro guarda a troca do token sem o token', sql(`select count(*) from central_auditoria where acao = 'feegow_token' and empresa_id = 'clinica-outra' and position('${BOM}' in coalesce(detalhe::text, '')) = 0`) === '1');

  // ---- Segredo do n8n por empresa ----
  ok('sem segredo próprio: mostra que usa o geral', (await cartao('teste').locator('[data-n8n]').getAttribute('data-n8n')) === 'geral');
  await cartao('teste').locator('[data-integracoes] button', { hasText: 'Gerar segredo' }).click(); await p.waitForTimeout(1500);
  const segredo = ((await p.locator('[data-segredo]').textContent().catch(() => '')) || '').trim();
  ok('segredo gerado aparece uma vez e fica cifrado', segredo.length >= 30
    && sql(`select (n8n_segredo_cifrado like 'v1:%') and position('${segredo}' in n8n_segredo_cifrado) = 0 from empresas where id = 'teste'`) === 't', segredo.slice(0, 6));
  ok('tela passa a mostrar "Próprio desta empresa"', (await cartao('teste').locator('[data-n8n]').getAttribute('data-n8n')) === 'proprio');
  await p.reload(); await p.waitForLoadState('networkidle');
  ok('o segredo não aparece de novo depois de recarregar', (await p.locator('[data-segredo]').count()) === 0);

  // O painel manda o segredo da empresa, não o geral (pela aba Dúvidas; o SQL do módulo já rodou no duvidas.js).
  sql(`update empresas set modulos = array(select distinct unnest(modulos || array['m.duvidas.ver'])) where id = 'teste';
       update painel_vinculos set permissoes = array(select distinct unnest(permissoes || array['m.duvidas.ver'])) where empresa_id = 'teste' and usuario_id = (select id from painel_usuarios where email = 'amanda@teste.local');
       insert into crm_config (chave, valor) values ('duvidas', '{"url":"http://127.0.0.1:${PORTA_IA}/duvidas"}') on conflict (chave) do update set valor = excluded.valor`);
  const ctx2 = await b.newContext(); const a = await ctx2.newPage();
  await entrar(a, 'amanda@teste.local', '/duvidas');
  if (!a.url().endsWith('/duvidas')) { await a.goto(B + '/duvidas'); await a.waitForLoadState('networkidle'); }
  const antes = await a.locator('[data-duvida]').count();
  await a.fill('[data-duvida-texto]', 'Teste do segredo da empresa'); await a.click('[data-duvida-enviar]');
  await a.locator('[data-duvida]').nth(antes).locator('[data-resposta]').waitFor({ timeout: 10000 }).catch(() => undefined);
  ok('Dúvidas: o cabeçalho x-painel-segredo é o da empresa, não o geral', recebidos.at(-1) === segredo && segredo !== process.env.N8N_WEBHOOK_SEGREDO,
    `${recebidos.length} pedidos · ${a.url()} · ${((await a.locator('main').textContent().catch(() => '')) || '').slice(-200)}`);
  await ctx2.close();
  sql(`update empresas set modulos = array_remove(modulos, 'm.duvidas.ver') where id = 'teste';
       update painel_vinculos set permissoes = array_remove(permissoes, 'm.duvidas.ver') where empresa_id = 'teste';
       delete from crm_config where chave = 'duvidas'; update empresas set n8n_segredo_cifrado = null where id = 'teste'`);

  // ---- Botão "Conectar WhatsApp" ----
  await cartao('clinica-outra').locator('[data-integracoes]').screenshot({ path: (process.env.SAIDA || __dirname + '/saida') + '/integracoes.png' }).catch(() => undefined);
  await cartao('clinica-outra').locator('[data-conectar-whatsapp]').screenshot({ path: (process.env.SAIDA || __dirname + '/saida') + '/conectar-whatsapp.png' }).catch(() => undefined);
  ok('com META_APP_ID e META_CADASTRO_CONFIG_ID na stack, o botão aparece', (await cartao('clinica-outra').locator('[data-botao-conectar-whatsapp]').count()) === 1);
  await p.evaluate(() => { window.__cancelar = true; });
  await cartao('clinica-outra').locator('[data-botao-conectar-whatsapp]').click(); await p.waitForTimeout(1500);
  ok('cadastro cancelado na Meta: avisa e não grava nada', ((await cartao('clinica-outra').locator('[data-conectar-whatsapp] [role=alert]').textContent().catch(() => '')) || '').includes('PHONE_NUMBER_SETUP')
    && sql(`select count(*) from whatsapp_numeros where phone_number_id = '999000111'`) === '0');
  await p.evaluate(() => { window.__cancelar = false; });
  await cartao('clinica-outra').locator('[data-conectar-whatsapp] input[type=url]').fill('https://ia.exemplo.test/webhook/cliente');
  await cartao('clinica-outra').locator('[data-botao-conectar-whatsapp]').click(); await p.waitForTimeout(2500);
  const opt = await p.evaluate(() => window.__fbOpt);
  const init = await p.evaluate(() => window.__fbInit);
  ok('abre o cadastro com o app, o config_id e a coexistência', init?.appId === process.env.META_APP_ID && opt?.config_id === process.env.META_CADASTRO_CONFIG_ID
    && opt?.response_type === 'code' && opt?.extras?.featureType === 'whatsapp_business_app_onboarding', JSON.stringify(opt).slice(0, 160));
  const num = sql(`select empresa_id || '|' || waba_id || '|' || coalesce(encaminhar_url, '') || '|' || (cadastro_codigo_cifrado like 'v1:%') || '|' || (position('codigo-ficticio' in cadastro_codigo_cifrado) = 0) || '|' || (conectar_pedido_em is not null) || '|' || ativo
                    from whatsapp_numeros where phone_number_id = '999000111'`);
  ok('número chega da Meta: conta, repasse para a IA, código cifrado e pedido de conexão', num === 'clinica-outra|888000111|https://ia.exemplo.test/webhook/cliente|true|true|true|true', num);
  ok('a tela mostra o número conectando', (await cartao('clinica-outra').locator('[data-numero="999000111"] [data-estado="conectando"]').count()) === 1);
  sql(`delete from whatsapp_numeros where phone_number_id = '999000111'; delete from empresa_integracoes where empresa_id = 'clinica-outra' and sistema = 'feegow'`);

  ok('sem erro de JavaScript', erros.length === 0, erros.join(' | '));
  await ctx.close(); await b.close(); feegow.close(); ia.close();
  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`\n${res.length - falhas}/${res.length} ok`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
