// Funil automático e follow-ups no CRM (migração 023, 12/10): follow-up e retomada enviados movem a oportunidade
// para "Follow up"; o paciente respondeu → volta; dias sem resposta → "Perdido"; /funil com so_avancar; tipo
// "retomada" aceito; o último follow-up aparece no cartão do quadro e do funil, e a mensagem automática ganha o nome
// do tipo na conversa da Inbox. Roda pelo rodar.sh depois do automaticas.js (usa o número da Inbox). Dados fictícios.
const { chromium } = require('playwright');
const crypto = require('crypto');
const { execSync } = require('child_process');
const sql = (q) => execSync('psql -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL"', { input: q, env: process.env }).toString().trim();
const B = process.env.BASE_URL || 'http://localhost:3100';
const lancar = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const res = []; const ok = (n, c, extra = '') => res.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (extra ? ' — ' + extra : ''));
async function entrar(p, email, destino) {
  await p.goto(B + destino); await p.fill('#email', email); await p.fill('#senha', 'senha123');
  await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(700);
  if (p.url().includes('/entrar/verificacao')) { await p.fill('#codigo', '123456'); await Promise.all([p.waitForLoadState('networkidle'), p.click('button[type=submit]')]); await p.waitForTimeout(800); }
}
const NUM = '100000000000001';
const ANA = '5547900004001', CAIO = '5547900004002', DORA = '5547900004003', EVA = '5547900004004', FABIO = '5547900004005', GUTO = '5547900004006';
const etapaDe = (tel) => sql(`select o.etapa_id || '|' || coalesce(o.etapa_antes_followup, '-') from oportunidades o join contatos c on c.id = o.contato_id
                               where right(c.telefone, 8) = right('${tel}', 8) and not o.arquivado order by o.atualizado_em desc limit 1`);

(async () => {
  const chave = 'teste-funil-' + crypto.randomBytes(8).toString('hex');
  sql(`insert into api_chaves (nome, hash, escopos) values ('Sara funil', '${crypto.createHash('sha256').update(chave).digest('hex')}', array['leitura','crm'])`);
  const api = (caminho, corpo) => fetch(B + caminho, {
    method: corpo === undefined ? 'GET' : 'POST', body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { authorization: 'Bearer ' + chave, 'content-type': 'application/json' },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const envio = (tel, tipo, extra = {}) => api('/api/v1/automaticas/envios', { telefone: tel, tipo, situacao: 'enviado', chave: `${tipo}:${tel}:${crypto.randomBytes(3).toString('hex')}`, ...extra });

  // ---- Sem regra configurada: o envio é registrado e o funil não anda ----
  sql(`delete from crm_config where chave = 'funil_automatico'`);
  await api('/api/v1/funil', { telefone: DORA, etapa_id: 'interesse', nome: 'Dora Funil Ficticia' });
  let r = await envio(DORA, 'followup_1h', { texto: 'Oi Dora, conseguiu ver os horários?' });
  ok('sem funil_automatico: registra e não move', r.status === 200 && r.json.funil === null && etapaDe(DORA) === 'interesse|-', `${JSON.stringify(r.json)} ${etapaDe(DORA)}`);

  // Etapa "Retomada" (12/10): fase própria, separada do follow-up quente das 24 h.
  sql(`insert into crm_etapas (id, ordem, nome, tipo, gatilho) values ('retomada', 5, 'Retomada', 'aberta', 'Retomada enviada') on conflict (id) do update set arquivado = false`);
  sql(`insert into crm_config (chave, valor) values ('funil_automatico', '{"followup":"followup","retomada":"retomada","de":["contato","interesse","oferecido"],"perdido":"perdido","dias_sem_resposta":7,"cancelada":"oferecido"}')
       on conflict (chave) do update set valor = excluded.valor`);

  // ---- /funil com so_avancar ----
  r = await api('/api/v1/funil', { telefone: ANA, etapa_id: 'interesse', nome: 'Ana Funil Ficticia', interesse: 'Consulta neurologia' });
  r = await api('/api/v1/funil', { telefone: ANA, etapa_id: 'oferecido', so_avancar: true });
  ok('horários enviados: so_avancar move para a frente', r.status === 200 && r.json.movida === true && etapaDe(ANA) === 'oferecido|-', JSON.stringify(r.json).slice(0, 160));
  r = await api('/api/v1/funil', { telefone: ANA, etapa_id: 'interesse', so_avancar: true });
  ok('so_avancar não puxa para trás', r.status === 200 && r.json.movida === false && etapaDe(ANA) === 'oferecido|-');

  // ---- Follow-up enviado → Follow up (guardando de onde saiu) ----
  r = await envio(ANA, 'followup_1h', { texto: 'Oi Ana! Ficou alguma dúvida sobre os horários?', wamid: 'wamid.FUNIL1', quando: new Date(Date.now() - 30 * 60_000).toISOString() });
  ok('follow-up enviado leva para Follow up', r.status === 200 && r.json.funil?.de === 'oferecido' && etapaDe(ANA) === 'followup|oferecido', `${JSON.stringify(r.json)} ${etapaDe(ANA)}`);
  ok('mudança automática fica na auditoria', sql(`select count(*) from painel_auditoria where recurso = 'oportunidades' and detalhe->>'por' = 'Funil automático' and detalhe->>'etapa_id' = 'followup'`) === '1');
  r = await envio(ANA, 'followup_3h', { texto: 'Ana, posso reservar um horário para você?', quando: new Date(Date.now() - 10 * 60_000).toISOString() });
  ok('segundo follow-up mantém a etapa de origem', r.json?.funil?.de === 'followup' && etapaDe(ANA) === 'followup|oferecido', etapaDe(ANA));
  r = await api('/api/v1/automaticas/envios', { telefone: CAIO, tipo: 'followup_1h', situacao: 'cancelado', motivo: 'respondeu', chave: 'followup_1h:CAIO-X' });
  await api('/api/v1/funil', { telefone: CAIO, etapa_id: 'interesse', nome: 'Caio Funil Ficticio' });
  r = await api('/api/v1/automaticas/envios', { telefone: CAIO, tipo: 'followup_1h', situacao: 'cancelado', motivo: 'respondeu', chave: 'followup_1h:CAIO-X' });
  ok('follow-up cancelado não move', r.json?.funil === null && etapaDe(CAIO) === 'interesse|-', etapaDe(CAIO));

  // ---- Retomada (tipo novo) há 8 dias, sem resposta → Perdido na rodada ----
  r = await envio(CAIO, 'retomada', { texto: 'Olá, Caio! Aqui é a Sara. Passando para retomar o agendamento.', quando: new Date(Date.now() - 8 * 86400_000).toISOString() });
  ok('retomada vai para a etapa Retomada (separada do follow-up)', r.status === 200 && r.json.funil?.de === 'interesse' && etapaDe(CAIO) === 'retomada|interesse', `${JSON.stringify(r.json)} ${etapaDe(CAIO)}`);
  // Eva parou antes do preço (etapa "contato"): a retomada também a alcança.
  await api('/api/v1/funil', { telefone: EVA, etapa_id: 'contato', nome: 'Eva Funil Ficticia' });
  r = await envio(EVA, 'retomada', { texto: 'Olá, Eva! Aqui é a Sara, do instituto.', quando: new Date(Date.now() - 9 * 86400_000).toISOString() });
  ok('"contato" em de: retomada também move quem parou antes do preço', r.json?.funil?.de === 'contato' && etapaDe(EVA) === 'retomada|contato', etapaDe(EVA));
  r = await api(`/api/v1/ficha?telefone=${CAIO}`);
  const ret = (r.json?.automaticas?.ultimos_envios || []).find((x) => x.tipo === 'retomada');
  ok('ficha mostra a retomada com nome', ret?.tipo_nome === 'Retomada', JSON.stringify(ret));

  // ---- Consulta cancelada: Fábio (sem outra marcada) volta de Confirmado para Oferecido; Guto tem outra futura e fica ----
  await api('/api/v1/funil', { telefone: FABIO, etapa_id: 'confirmado', nome: 'Fabio Funil Ficticio' });
  await api('/api/v1/funil', { telefone: GUTO, etapa_id: 'confirmado', nome: 'Guto Funil Ficticio' });
  const cont = (tel) => sql(`select id from contatos where right(telefone, 8) = right('${tel}', 8) order by criado_em limit 1`);
  sql(`insert into servicos (contato_id, tipo, inicio, situacao, sistema, codigo_externo, atualizado_em) values
         ('${cont(FABIO)}', 'Consulta', now() + interval '2 days', 'cancelado', 'feegow', 'FUNIL-F1', now() + interval '1 second'),
         ('${cont(GUTO)}', 'Consulta', now() + interval '2 days', 'cancelado', 'feegow', 'FUNIL-G1', now() + interval '1 second'),
         ('${cont(GUTO)}', 'Consulta', now() + interval '9 days', 'agendado', 'feegow', 'FUNIL-G2', now());`);

  // ---- Ana respondeu (Inbox) depois do follow-up ----
  sql(`insert into wa_contatos (numero_id, wa_id, nome_perfil) values ('${NUM}', '${ANA}', 'Ana Funil Ficticia') on conflict do nothing;
       insert into wa_conversas (numero_id, wa_id, ultima_em, ultima_resumo, ultima_direcao, ultima_entrada_em, nao_lidas)
       values ('${NUM}', '${ANA}', now(), 'Posso sim', 'entrada', now(), 1) on conflict (numero_id, wa_id) do update set ultima_entrada_em = now();
       insert into wa_mensagens (numero_id, wa_id, wamid, direcao, origem, tipo, texto, enviada_em) values
         ('${NUM}', '${ANA}', 'wamid.FUNIL1', 'saida', 'api', 'text', 'Sara: Oi Ana! Ficou alguma dúvida sobre os horários?', now() - interval '30 minutes'),
         ('${NUM}', '${ANA}', 'wamid.FUNIL2', 'saida', 'api', 'text', '*Sara:* Ana, posso reservar um horário para você?', now() - interval '10 minutes'),
         ('${NUM}', '${ANA}', 'wamid.FUNIL3', 'saida', 'api', 'text', 'Resposta normal da Sara', now() - interval '5 minutes'),
         ('${NUM}', '${ANA}', 'wamid.FUNIL4', 'entrada', 'contato', 'text', 'Posso sim', now());`);
  const contatoAna = sql(`select o.contato_id from oportunidades o join contatos c on c.id = o.contato_id where right(c.telefone, 8) = right('${ANA}', 8) and not o.arquivado limit 1`);
  sql(`insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('${contatoAna}', 'agenda', 'FUNIL-ANA quer remarcar', 'IA')`);

  // Tela antes da rodada: cartão do funil e do quadro mostram o último follow-up.
  const b = await lancar(); const erros = [];
  let ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); let p = await ctx.newPage();
  p.on('pageerror', (e) => erros.push(e.message));
  await entrar(p, 'gestor@teste.local', '/crm'); await p.waitForTimeout(800);
  const linha = await p.locator('article', { hasText: 'FUNIL-ANA' }).locator('[data-automatica]').textContent().catch(() => '');
  ok('cartão do quadro mostra o último follow-up', /Follow-up 3h/.test(linha || '') && /enviado/.test(linha || ''), linha);
  await p.click('role=tab[name="Comercial"]'); await p.waitForTimeout(1000);
  const selo = await p.locator('article', { hasText: 'Ana Funil Ficticia' }).locator('[data-automatica]').textContent().catch(() => '');
  const colFollow = await p.locator('section', { has: p.locator('article', { hasText: 'Ana Funil Ficticia' }) }).getAttribute('aria-label').catch(() => '');
  ok('cartão do funil mostra o follow-up e está em Follow up', /Follow-up 3h enviado/.test(selo || '') && /Follow up/i.test(colFollow || ''), `${selo} | ${colFollow}`);
  const seloCaio = await p.locator('article', { hasText: 'Caio Funil Ficticio' }).locator('[data-automatica]').count();
  ok('retomada de 8 dias também aparece no cartão (até 31 dias)', seloCaio === 1);
  await p.screenshot({ path: (process.env.SAIDA || __dirname + '/saida') + '/30_funil_followup.png', fullPage: true });

  // Inbox: as mensagens automáticas ganham o nome do tipo (pelo wamid e pelo texto).
  await p.goto(B + '/inbox'); await p.waitForTimeout(1000);
  await p.locator('section[aria-label="Conversas"] li', { hasText: 'Ana Funil Ficticia' }).click(); await p.waitForTimeout(1500);
  const corpo = await p.locator('main').textContent();
  ok('conversa marca o follow-up 1h (wamid) e o 3h (texto)', corpo.includes('Sara · Follow-up 1h') && corpo.includes('Sara · Follow-up 3h'), corpo.slice(0, 200));
  ok('mensagem comum da Sara não ganha selo', (corpo.match(/Sara · Follow-up/g) || []).length === 2);
  await ctx.close();

  // ---- Rodada (Verificar agora no Interno): Ana volta, Caio vai para Perdido ----
  ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); p = await ctx.newPage();
  await entrar(p, 'planee@teste.local', '/interno');
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(3000);
  const toast = (await p.locator('[role=status]').allTextContents()).join(' ');
  ok('respondeu ao follow-up: volta para a etapa de origem', etapaDe(ANA) === 'oferecido|-', etapaDe(ANA));
  ok('7 dias sem resposta: vai para Perdido', etapaDe(CAIO).startsWith('perdido|') && etapaDe(EVA).startsWith('perdido|'), `${etapaDe(CAIO)} ${etapaDe(EVA)}`);
  ok('Verificar agora conta o funil automático', /Funil automático: 4 oportunidades movidas/.test(toast), toast);
  ok('consulta cancelada sem outra marcada: Confirmado volta para Oferecido', etapaDe(FABIO) === 'oferecido|-', etapaDe(FABIO));
  ok('consulta cancelada com outra marcada: continua Confirmado', etapaDe(GUTO) === 'confirmado|-', etapaDe(GUTO));
  ok('rodada fica na auditoria com o motivo', sql(`select count(*) from painel_auditoria where detalhe->>'por' = 'Funil automático'
       and detalhe->>'motivo' in ('paciente respondeu ao follow-up', '7 dias sem resposta ao follow-up', 'consulta cancelada, sem outra marcada')`) === '4');
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  ok('rodar de novo não mexe em nada', etapaDe(ANA) === 'oferecido|-' && etapaDe(CAIO).startsWith('perdido|') && etapaDe(EVA).startsWith('perdido|'));

  // Caio respondeu depois de ir para Perdido (ex.: receptor fora do ar e a resposta chegou atrasada) → volta.
  sql(`insert into wa_conversas (numero_id, wa_id, ultima_em, ultima_resumo, ultima_direcao, ultima_entrada_em, nao_lidas)
       values ('${NUM}', '${CAIO}', now(), 'Oi, ainda quero', 'entrada', now(), 1) on conflict (numero_id, wa_id) do update set ultima_entrada_em = now()`);
  await p.getByRole('button', { name: 'Verificar agora' }).click(); await p.waitForTimeout(2500);
  ok('perdido pelo funil e respondeu: volta para a etapa de origem', etapaDe(CAIO) === 'interesse|-' && sql(`select count(*) from oportunidades o join contatos c on c.id = o.contato_id
       where right(c.telefone, 8) = '00004002' and not o.arquivado and o.perdido_auto_em is not null`) === '0', etapaDe(CAIO));

  // Eva continua em Perdido; a IA chama de novo pelo /funil (interesse, so_avancar) → reabre a mesma oportunidade.
  const opEva = sql(`select o.id from oportunidades o join contatos c on c.id = o.contato_id where right(c.telefone, 8) = '00004004' and not o.arquivado`);
  r = await api('/api/v1/funil', { telefone: EVA, etapa_id: 'interesse', so_avancar: true });
  ok('/funil reabre a oportunidade perdida pelo funil (sem criar outra)', r.status === 200 && r.json.reaberta === true && r.json.oportunidade?.id === opEva
    && sql(`select count(*) from oportunidades o join contatos c on c.id = o.contato_id where right(c.telefone, 8) = '00004004' and not o.arquivado`) === '1'
    && etapaDe(EVA) === 'interesse|-', `${JSON.stringify(r.json).slice(0, 160)} ${etapaDe(EVA)}`);
  r = await envio(EVA, 'retomada', { texto: 'Eva, posso te mostrar os horários?' });
  ok('retomada depois de reaberta volta para Retomada', etapaDe(EVA) === 'retomada|interesse', etapaDe(EVA));
  // Perdido marcado à mão pela equipe não reabre sozinho: o /funil cria outra.
  sql(`update oportunidades set perdido_auto_em = null, etapa_id = 'perdido' where id = '${opEva}'`);
  r = await api('/api/v1/funil', { telefone: EVA, etapa_id: 'interesse' });
  ok('perdido à mão não é reaberto (nasce outra oportunidade)', r.json?.criou === true && !r.json.reaberta, JSON.stringify(r.json).slice(0, 120));
  await ctx.close(); await b.close();
  ok('sem erro no navegador', erros.length === 0, erros.join(' | ').slice(0, 300));

  // Limpeza: tira os dados fictícios deste teste (o resto da suíte não depende deles).
  sql(`delete from crm_config where chave = 'funil_automatico';
       update atendimentos set arquivado = true where resumo like 'FUNIL-%';
       update oportunidades set arquivado = true where contato_id in (select id from contatos where right(telefone, 8) in ('00004001', '00004002', '00004003', '00004004', '00004005', '00004006'));
       update servicos set arquivado = true where codigo_externo like 'FUNIL-%';
       update crm_etapas set arquivado = true where id = 'retomada';
       delete from wa_mensagens where wa_id = '${ANA}'; delete from wa_conversas where wa_id in ('${ANA}', '${CAIO}'); delete from wa_contatos where wa_id = '${ANA}';`);

  console.log(res.join('\n'));
  const falhas = res.filter((x) => x.startsWith('FALHA')).length;
  console.log(`${res.length - falhas} de ${res.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log(res.join('\n')); console.log('ERRO', e.message); process.exit(1); });
