// Testes dos avisos para a Planee (08/10): "Avisar a Planee" no menu da mensagem da Inbox, a tela Planee da empresa,
// a fila no Interno Planee (abrir, responder, resolver, link para a conversa), LGPD (no central só o índice),
// novidades e manutenção (todas as empresas ou uma só), integrações com validade do token e o vigia
// (token vencendo com lembrete a cada 3 dias, envios falhando, comprovante suspeito), saúde dos clientes,
// permissões e o link /ir (sem redirecionamento para fora). Roda pelo rodar.sh depois do inbox.js. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');
const out = (process.env.SAIDA || __dirname + '/saida') + '/'; fs.mkdirSync(out, { recursive: true });
const sql = (q, url = process.env.DATABASE_URL) => execSync(`psql -qAt -v ON_ERROR_STOP=1 "${url}"`, { input: q, env: process.env }).toString().trim();
const PORTA = new URL(process.env.BASE_URL || 'http://localhost:3100').port;
const GERAL = `http://localhost:${PORTA}`;
const OUTRA = `http://outra.localhost:${PORTA}`;
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, base, email, senha = 'senha123', destino = '/inbox') {
  await p.goto(base + destino); await p.fill('#email', email); await p.fill('#senha', senha);
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const NUM = '100000000000001';
const BIA = '5547900001001';
const diaSp = (dias) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(Date.now() + dias * 86400000);
const campoLocal = (ms) => { const d = new Date(Date.now() + ms); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const ler = (p, recurso) => p.evaluate(async (r) => { const x = await fetch('/api/painel/ler/' + r); return x.status + ' ' + await x.text(); }, recurso);

(async () => {
  const b = await lancar();
  const erros = [];
  const novo = async () => {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage();
    p.on('pageerror', (e) => erros.push(p.url() + ' ' + e.message.slice(0, 120)));
    return [c, p];
  };
  let ctx, p;

  // ---- Equipe: "Avisar a Planee" pelo menu da mensagem ----
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'amanda@teste.local');
  ok('menu da tela tem "Planee" para a equipe', ((await p.textContent('nav')) || '').includes('Planee'));
  await p.locator('section[aria-label="Conversas"] li', { hasText: 'Beatriz Ficticia' }).click();
  const bolha = p.locator('[data-id]', { hasText: 'Pode ser às 15h?' });
  await bolha.waitFor({ timeout: 8000 });
  await bolha.hover();
  await bolha.locator('button[aria-label="Opções da mensagem"]').click();
  await p.getByRole('menuitem', { name: 'Avisar a Planee' }).click();
  const janela = p.locator('[role=dialog][aria-label="Avisar a Planee"]');
  await janela.waitFor({ timeout: 5000 });
  ok('janela mostra a mensagem do aviso', ((await janela.textContent()) || '').includes('Pode ser às 15h?'));
  await p.selectOption('#aviso-tipo', 'info_errada');
  await p.fill('#aviso-comentario', 'Horário errado: a clínica fecha às 14h no sábado (teste fictício)');
  await janela.getByRole('button', { name: 'Enviar para a Planee' }).click();
  await p.getByText('Aviso enviado para a Planee').waitFor({ timeout: 8000 }).catch(() => {});
  const central = sql(`select origem || '|' || tipo || '|' || estado || '|' || titulo || '|' || (ref->>'wa_final') || '|' || tem_detalhe || '|' || criado_por from avisos where origem = 'equipe'`);
  ok('aviso entra no central (índice: tipo, estado, título curto, 4 dígitos)', central === 'equipe|info_errada|aberto|Informação errada · conversa ••1001|1001|true|Amanda Teste', central);
  const idAviso = sql(`select id from avisos where origem = 'equipe'`);
  const detalhe = sql(`select comentario || '|' || numero_id || '|' || wa_id || '|' || wamid || '|' || trecho from avisos_detalhe where aviso_id = '${idAviso}'`);
  ok('detalhe fica no banco da empresa (comentário, conversa, mensagem, trecho)',
    detalhe === `Horário errado: a clínica fecha às 14h no sábado (teste fictício)|${NUM}|${BIA}|wamid.TI7|Pode ser às 15h?`, detalhe);
  const linhaCentral = sql(`select row_to_json(a)::text from avisos a where id = '${idAviso}'`);
  ok('LGPD: no central não vai telefone inteiro nem comentário', !linhaCentral.includes(BIA) && !linhaCentral.includes('14h') && !linhaCentral.includes('15h'), linhaCentral.slice(0, 200));
  // Bolha da Sara já abre com "A Sara errou".
  const sara = p.locator('[data-id]', { has: p.locator('[data-tipo="sara"]') }).first();
  await sara.hover(); await sara.locator('button[aria-label="Opções da mensagem"]').click();
  await p.getByRole('menuitem', { name: 'Avisar a Planee' }).click();
  ok('aviso de mensagem da Sara já vem como "A Sara errou"', (await p.inputValue('#aviso-tipo')) === 'sara_errou');
  await p.locator('[role=dialog][aria-label="Avisar a Planee"]').getByRole('button', { name: 'Cancelar' }).click();
  const filaEquipe = await p.evaluate(async () => (await fetch('/api/painel/ler/avisos')).status);
  ok('equipe não lê a fila da Planee (só master)', filaEquipe === 403, String(filaEquipe));

  // ---- Tela Planee da empresa ----
  await p.goto(GERAL + '/planee');
  const meu = p.locator(`[data-aviso="${idAviso}"]`);
  await meu.waitFor({ timeout: 8000 });
  const meuTexto = (await meu.textContent()) || '';
  ok('tela Planee mostra o aviso, o estado e o comentário', meuTexto.includes('Aberto') && meuTexto.includes('fecha às 14h'), meuTexto.slice(0, 160));
  // Aviso sem mensagem, pela tela Planee.
  await p.getByRole('button', { name: 'Novo aviso' }).click();
  await p.selectOption('#aviso-tipo', 'sugestao');
  await p.fill('#aviso-comentario', 'Seria bom ver o resumo do dia (teste)');
  await p.locator('[role=dialog]').getByRole('button', { name: 'Enviar para a Planee' }).click();
  await p.getByText('Seria bom ver o resumo do dia').waitFor({ timeout: 8000 }).catch(() => {});
  ok('aviso sem mensagem (Novo aviso) também funciona', sql(`select count(*) from avisos where origem = 'equipe' and tipo = 'sugestao' and ref->>'wa_final' is null`) === '1');
  await ctx.close();

  // ---- Outra empresa não vê os avisos da empresa de teste ----
  [ctx, p] = await novo();
  await entrar(p, OUTRA, 'admin2@teste.local', 'senhaforte1', '/planee');
  const outraLe = await ler(p, 'planee_empresa');
  ok('outra empresa: lista de avisos vazia (isolamento)', outraLe.startsWith('200') && outraLe.includes('"avisos":[]'), outraLe.slice(0, 120));
  await ctx.close();

  // ---- Planee (master): fila, detalhe, resposta, link para a conversa ----
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'planee@teste.local', 'senha123', '/interno');
  const item = p.locator(`button[data-aviso="${idAviso}"]`);
  await item.waitFor({ timeout: 8000 });
  const fila = (await p.locator('ul[aria-label="Fila de avisos"]').textContent()) || '';
  ok('fila do Interno traz os avisos da equipe e o automático do comprovante', fila.includes('Informação errada') && fila.includes('Sugestão') && fila.includes('Comprovante suspeito'), fila.slice(0, 200));
  await item.click();
  const det = p.locator('[role=dialog]');
  await det.getByText('Comentário da equipe').waitFor({ timeout: 8000 });
  const detTexto = (await det.textContent()) || '';
  ok('detalhe traz comentário e mensagem (lidos no banco da empresa)', detTexto.includes('fecha às 14h') && detTexto.includes('Pode ser às 15h?'), detTexto.slice(0, 200));
  ok('abrir o detalhe fica na auditoria central', sql(`select count(*) from central_auditoria where acao = 'abrir_aviso' and alvo = '${idAviso}'`) === '1');
  const link = await det.getByRole('link', { name: 'Abrir a conversa na Inbox' }).getAttribute('href');
  await det.getByRole('button', { name: 'Assumir' }).click();
  await p.waitForTimeout(800);
  ok('Assumir: em análise, com quem está cuidando', sql(`select estado || '|' || responsavel from avisos where id = '${idAviso}'`) === 'em_analise|Planee Teste',
    sql(`select estado || '|' || coalesce(responsavel,'') from avisos where id = '${idAviso}'`));
  await p.selectOption('#aviso-estado', 'resolvido');
  await p.fill('#aviso-resposta', 'Corrigimos o horário de sábado na base da Sara.');
  await det.getByRole('button', { name: 'Salvar' }).click();
  await p.getByText('Aviso salvo.').waitFor({ timeout: 8000 }).catch(() => {});
  ok('resposta e estado gravados', sql(`select estado || '|' || resposta || '|' || respondido_por from avisos where id = '${idAviso}'`) === 'resolvido|Corrigimos o horário de sábado na base da Sara.|Planee Teste');
  await p.keyboard.press('Escape');
  await p.goto(GERAL + link);
  await p.waitForURL(/\/inbox\?numero=/, { timeout: 8000 }).catch(() => {});
  await p.locator('section[aria-label^="Conversa com"]').waitFor({ timeout: 8000 }).catch(() => {});
  ok('link do aviso entra na empresa e abre a conversa', p.url().includes(`/inbox?numero=${NUM}&wa=${BIA}`) && (await p.locator('section[aria-label="Conversa com Beatriz Ficticia"]').count()) === 1, p.url());
  ok('master não vê o menu "Avisar a Planee"', (await p.locator('button[aria-label="Opções da mensagem"]').count()) === 0);
  await p.goto(GERAL + '/ir?empresa=teste&para=' + encodeURIComponent('https://exemplo.invalid/x'));
  ok('/ir não leva para fora do painel', new URL(p.url()).hostname === 'localhost', p.url());
  await ctx.close();

  // ---- A equipe vê a resposta ----
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'amanda@teste.local', 'senha123', '/planee');
  await p.locator(`[data-aviso="${idAviso}"]`).waitFor({ timeout: 8000 });
  const resp = (await p.locator(`[data-aviso="${idAviso}"]`).textContent()) || '';
  ok('equipe vê a resposta da Planee e o estado', resp.includes('Resolvido') && resp.includes('Resposta da Planee') && resp.includes('Corrigimos o horário'), resp.slice(0, 200));
  await p.goto(GERAL + '/ir?empresa=clinica-outra&para=' + encodeURIComponent('/crm?cartao=00000000-0000-4000-8000-000000000001'));
  ok('/ir recusa empresa de que a pessoa não faz parte', !p.url().includes('cartao='), p.url());
  await ctx.close();

  // ---- Novidades e manutenção ----
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'planee@teste.local', 'senha123', '/interno');
  await p.getByRole('tab', { name: 'Novidades e manutenção' }).click();
  await p.fill('#nov-titulo', 'Nova tela Planee');
  await p.fill('#nov-texto', 'Agora a equipe avisa a Planee direto pela Inbox.');
  await p.getByRole('button', { name: 'Publicar' }).click();
  await p.getByText('Publicado.').waitFor({ timeout: 8000 }).catch(() => {});
  await p.selectOption('#nov-tipo', 'manutencao');
  await p.selectOption('#nov-empresa', 'teste');
  await p.fill('#nov-fim', campoLocal(2 * 3600000));
  await p.fill('#nov-titulo', 'Troca do servidor');
  await p.fill('#nov-texto', 'O painel pode ficar lento por alguns minutos.');
  await p.getByRole('button', { name: 'Publicar' }).click();
  await p.locator('[data-novidade]', { hasText: 'Troca do servidor' }).waitFor({ timeout: 8000 }).catch(() => {});
  ok('novidade (todas) e manutenção (só teste) gravadas',
    sql(`select string_agg(tipo || ':' || coalesce(empresa_id,'todas'), ',' order by tipo) from novidades`) === 'manutencao:teste,novidade:todas');
  await ctx.close();

  [ctx, p] = await novo();
  await entrar(p, GERAL, 'amanda@teste.local', 'senha123', '/crm');
  const faixas = p.locator('[aria-label="Avisos da Planee"]');
  await faixas.waitFor({ timeout: 8000 }).catch(() => {});
  const fx = (await faixas.textContent().catch(() => '')) || '';
  ok('faixa no topo: manutenção da empresa e novidade', fx.includes('Manutenção em andamento: Troca do servidor') && fx.includes('Novidade: Nova tela Planee'), fx.slice(0, 200));
  await p.getByRole('button', { name: 'Fechar a novidade Nova tela Planee' }).click();
  await p.reload(); await p.waitForTimeout(1500);
  const fx2 = (await p.locator('[aria-label="Avisos da Planee"]').textContent().catch(() => '')) || '';
  ok('novidade fechada não volta; manutenção continua', !fx2.includes('Nova tela Planee') && fx2.includes('Troca do servidor'), fx2.slice(0, 200));
  await ctx.close();

  [ctx, p] = await novo();
  await entrar(p, OUTRA, 'admin2@teste.local', 'senhaforte1', '/planee');
  await p.getByText('Nova tela Planee').first().waitFor({ timeout: 8000 }).catch(() => {});
  const outraTela = (await p.textContent('main')) || '';
  ok('outra empresa vê a novidade de todos, não a manutenção da teste', outraTela.includes('Nova tela Planee') && !outraTela.includes('Troca do servidor'), outraTela.slice(0, 200));
  await ctx.close();

  // ---- Integrações, vigia e saúde ----
  sql(`insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, status, erro, enviada_em)
       select '${NUM}', '${BIA}', 'wamid.FALHA' || n, 'saida', 'api', 'text', 'teste', 'falhou', '{"code":131049,"title":"Teste fictício"}', now() - n * interval '1 minute'
         from generate_series(1, 6) n`);
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'planee@teste.local', 'senha123', '/interno');
  await p.getByRole('tab', { name: 'Integrações' }).click();
  await p.selectOption('#int-empresa', 'teste');
  await p.fill('#int-sistema', 'feegow');
  await p.fill('#int-rotulo', 'Feegow');
  const validade = diaSp(10);
  await p.fill('#int-validade', validade);
  await p.getByRole('button', { name: 'Salvar integração' }).click();
  await p.locator('[data-integracao="teste:feegow"]').waitFor({ timeout: 8000 }).catch(() => {});
  ok('integração salva com validade e prazo', ((await p.locator('[data-integracao="teste:feegow"]').textContent().catch(() => '')) || '').includes('vence em 10 dias'));
  await p.getByRole('button', { name: 'Verificar agora' }).click();
  await p.getByText('Verificação feita').waitFor({ timeout: 15000 }).catch(() => {});
  const tok = sql(`select estado || '|' || titulo || '|' || chave from avisos where tipo = 'token_vencendo'`);
  const br = `${validade.slice(8, 10)}/${validade.slice(5, 7)}/${validade.slice(0, 4)}`;
  ok('vigia: token a 10 dias vira aviso', tok === `aberto|Token da integração Feegow vence em 10 dias (${br})|token:teste:feegow:${validade}`, tok);
  const falha = sql(`select count(*) || '|' || min(titulo) from avisos where tipo = 'envios_falhando'`);
  ok('vigia: envios falhando na última hora vira aviso', /^1\|6 de \d+ envios falharam na última hora \(número id ••0001\) · erro da Meta 131049$/.test(falha), falha);
  // Os comprovantes suspeitos criados pela API no crm-completo.js: um aviso por pagamento (mesmo marcado suspeito de novo).
  const susp = sql(`select count(*) from pagamentos where analise = 'suspeito' and alerta_atendimento_id is not null`);
  const avs = sql(`select count(*) || '|' || count(*) filter (where ref->>'alvo' = 'cartao' and ref->>'alvo_id' is not null) from avisos where tipo = 'comprovante_suspeito'`);
  ok('comprovante suspeito da API vira aviso, um por pagamento', Number(susp) > 0 && avs === `${susp}|${susp}`, `${susp} suspeitos, avisos ${avs}`);
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  ok('rodar de novo não duplica', sql(`select count(*) from avisos where origem = 'sistema' and tipo in ('token_vencendo','envios_falhando')`) === '2');
  sql(`update avisos set estado = 'resolvido', lembrado_em = now() - interval '3 days' where tipo = 'token_vencendo'`);
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  ok('3 dias depois, sem renovar: o lembrete volta a abrir', sql(`select estado || '|' || (lembrado_em > now() - interval '1 minute') from avisos where tipo = 'token_vencendo'`) === 'aberto|true');
  // Fila parada (09/10): 5 pedidos aguardando além do prazo vermelho. Em horário comercial vira aviso; fora dele, não.
  const ids = sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por, aberto_em)
     select '00000000-0000-4000-8000-000000000001', 'outros', 'Fila parada fictícia ' || n, 'IA', now() - interval '3 hours'
       from generate_series(1, 5) n returning id`).split('\n');
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  const sp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const hora = Number(sp.find((x) => x.type === 'hour').value); const dom = sp.find((x) => x.type === 'weekday').value === 'Sun';
  const comercial = !dom && hora >= 8 && hora < 20;
  const filaAv = sql(`select count(*) || '|' || coalesce(min(titulo), '') from avisos where tipo = 'fila_parada' and estado <> 'resolvido'`);
  ok(`vigia: fila parada ${comercial ? 'vira aviso em horário comercial' : 'não avisa fora do horário comercial'}`,
    comercial ? /^1\|\d+ pedidos esperando a equipe além do prazo/.test(filaAv) : filaAv.startsWith('0|'), filaAv);
  sql(`update atendimentos set arquivado = true where id in (${ids.map((i) => `'${i}'`).join(',')})`);
  // Prazo vermelho de 30 dias: nada fica atrasado e o aviso fecha sozinho. Depois volta o prazo de antes.
  const prazoAntes = sql(`select coalesce(valor::text, '') from crm_config where chave = 'prazos_atendimento'`);
  sql(`insert into crm_config (chave, valor) values ('prazos_atendimento', '{"aguardando":{"amarelo":15,"vermelho":43200},"pendente":{"amarelo":1440,"vermelho":2880}}')
       on conflict (chave) do update set valor = excluded.valor`);
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  ok('vigia: fila zerada fecha o aviso sozinho', sql(`select count(*) from avisos where tipo = 'fila_parada' and estado <> 'resolvido'`) === '0');
  if (prazoAntes) sql(`update crm_config set valor = '${prazoAntes}'::jsonb where chave = 'prazos_atendimento'`);
  else sql(`delete from crm_config where chave = 'prazos_atendimento'`);
  await p.getByRole('tab', { name: 'Saúde dos clientes' }).click();
  const linhaTeste = p.locator('tr[data-empresa="teste"]');
  await linhaTeste.waitFor({ timeout: 8000 });
  const lt = (await linhaTeste.textContent()) || '';
  ok('saúde: uma linha por cliente, com problema e motivos', (await p.locator('tr[data-empresa="clinica-outra"]').count()) === 1
    && (await linhaTeste.locator('[data-nivel="problema"]').count()) === 1 && lt.includes('Token Feegow vence em 10 dias') && lt.includes('envios falharam'), lt.slice(0, 220));
  await linhaTeste.click();
  const ds = p.locator('[role=dialog]');
  await ds.getByText('Números de WhatsApp').waitFor({ timeout: 8000 }).catch(() => {});
  const dsT = (await ds.textContent()) || '';
  ok('saúde: detalhe da empresa com números, falhas e integrações', dsT.includes('••0001') && dsT.includes('erro 131049') && dsT.includes('Feegow: token até'), dsT.slice(0, 220));
  ok('saúde não mostra telefone de paciente', !dsT.includes(BIA));
  await p.keyboard.press('Escape');
  // Data nova: o lembrete antigo fecha sozinho.
  await p.getByRole('tab', { name: 'Integrações' }).click();
  await p.locator('[data-integracao="teste:feegow"]').getByRole('button', { name: 'Editar' }).click();
  await p.fill('#int-validade', diaSp(200));
  await p.getByRole('button', { name: 'Salvar integração' }).click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  ok('token renovado: aviso resolvido pelo sistema', sql(`select estado || '|' || respondido_por from avisos where tipo = 'token_vencendo'`) === 'resolvido|Sistema');
  // A manutenção arquivada some da faixa.
  await p.getByRole('tab', { name: 'Novidades e manutenção' }).click();
  await p.locator('[data-novidade]', { hasText: 'Troca do servidor' }).getByRole('button', { name: 'Arquivar' }).click();
  await p.waitForTimeout(1200);
  await ctx.close();
  [ctx, p] = await novo();
  await entrar(p, GERAL, 'amanda@teste.local', 'senha123', '/crm');
  await p.waitForTimeout(1500);
  ok('manutenção arquivada some da faixa', !(((await p.textContent('main')) || '').includes('Troca do servidor')));
  // Ações da Planee recusadas para a equipe (o servidor confere, não só a tela).
  const r403 = await ler(p, 'saude');
  ok('equipe não lê a saúde dos clientes', r403.startsWith('403'), r403.slice(0, 80));
  await ctx.close();

  sql(`delete from wa_mensagens where wamid like 'wamid.FALHA%'`);
  ok('sem erro de página', erros.length === 0, erros.join(' | ').slice(0, 300));
  console.log(res.join('\n')); await b.close();
  const falhas = res.filter((l) => l.startsWith('FALHA')).length; console.log(`\n${res.length - falhas} de ${res.length} passaram`); if (falhas) process.exit(1);
})().catch((e) => { console.log(res.join('\n')); console.error('ERRO', e.message); process.exit(1); });
