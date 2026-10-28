'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { Etapa, Quadro as TQuadro } from '@/lib/painel/crm';
import { arquivarAtendimento, finalizarAtendimentos, moverAtendimento, mudarAssunto, passarAtendimento, salvarMeusAvisos, type Resposta } from '@/lib/painel/acoes';
import type { Intervalo } from '@/lib/periodo';
import { FiltroData } from '@/components/FiltroData';
import { carregarQuadro } from '@/lib/painel/leitura-cliente';
import { lembrar } from '@/lib/painel/memoria-cliente';
import { Icone } from '@/components/Icone';
import { Quadro, filtrar, selecionavel, type Fase } from './Quadro';
import { Detalhe } from './Detalhe';
import { Comercial } from './Comercial';
import { Contatos } from './Contatos';
import { NovoAtendimento } from './Formularios';
import { DiasSemIa } from './DiasSemIa';
import { useAvisos } from './avisos';
import { atraso, criarFormatos, ha } from './util';
import c from './crm.module.css';

type Aba = 'atendimento' | 'comercial' | 'contatos';
const NOME_ABA: Record<Aba, string> = { atendimento: 'Atendimento', comercial: 'Comercial', contatos: 'Contatos' };
export type Origem = 'todos' | 'real' | 'sombra';
const ATUALIZA_MS = 15000;

export type PropsCrm = {
  inicial: TQuadro; podeArquivar: boolean; podeEditar: boolean; podeConfig: boolean; podeConferir?: boolean; mascarado: boolean; nome: string;
  memoria?: string;   // chave da memória da tela (lib/painel/memoria-cliente.ts): voltar ao CRM mostra o último quadro na hora
};

// Cartão alterado na tela antes da resposta do servidor (09/10): o clique aparece na hora; se o servidor recusar,
// o quadro volta a ser o do banco e o aviso explica.
const agoraIso = () => new Date().toISOString();

// Celular (28/10): até 760 px o CRM mostra uma coluna por vez, escolhida nas abas de assunto, e os filtros ficam
// atrás de "Filtros". Antes o topo ocupava 2/3 da tela e o quadro rolava de lado e para baixo ao mesmo tempo.
function useCelular() {
  const [celular, setCelular] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 760px)');
    const ver = () => setCelular(m.matches);
    ver(); m.addEventListener('change', ver);
    return () => m.removeEventListener('change', ver);
  }, []);
  return celular;
}

const chavePeriodo = (p: Intervalo | null | undefined) => (p ? `${p.de}|${p.ate}` : '');

export function Crm({ inicial, podeArquivar, podeEditar, podeConfig, podeConferir = false, mascarado, nome, memoria }: PropsCrm) {
  const [quadro, setQuadroBruto] = useState(inicial);
  // Filtro de data (11/10): null = quadro de agora. Com um período, o quadro mostra os cartões abertos nele (todas as
  // etapas). Resposta do servidor de outro período (ex.: uma ação devolve o quadro de agora) é trocada pela certa.
  const [periodo, setPeriodo] = useState<Intervalo | null>(null);
  const periodoRef = useRef<Intervalo | null>(null);
  periodoRef.current = periodo;
  const setQuadro = useCallback((d: TQuadro | ((q: TQuadro) => TQuadro)) => {
    if (typeof d === 'function') { setQuadroBruto(d); return; }
    if (chavePeriodo(d.periodo) === chavePeriodo(periodoRef.current)) { setQuadroBruto(d); return; }
    const pedido = periodoRef.current;
    void carregarQuadro(pedido).then((r) => { if (r.ok && chavePeriodo(pedido) === chavePeriodo(periodoRef.current)) setQuadroBruto(r.dados); });
  }, []);
  useEffect(() => { if (memoria && !quadro.periodo) lembrar(memoria, quadro); }, [memoria, quadro]);
  // Ações em andamento: cartões com clique pendente (só eles ficam travados) e a versão local do quadro.
  // Uma atualização automática que saiu antes de um clique não sobrescreve o clique quando volta.
  const [pendentes, setPendentes] = useState<ReadonlySet<string>>(() => new Set());
  const versao = useRef(0);
  const emVoo = useRef(0);
  const [aba, setAba] = useState<Aba>('atendimento');
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState<Origem>('todos');
  const [verFinal, setVerFinal] = useState(false);
  const [fase, setFase] = useState<Fase>('todas');
  // Ver uma coluna (assunto) por vez (15/10). null = todas as colunas.
  const [coluna, setColuna] = useState<string | null>(null);
  const celular = useCelular();
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  // Finalizar em massa (15/10): modo Selecionar, os escolhidos e a confirmação.
  const [selecionando, setSelecionando] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmarMassa, setConfirmarMassa] = useState(false);
  const [finalizandoMassa, setFinalizandoMassa] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [passarAberto, setPassarAberto] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [falhouAtualizar, setFalhouAtualizar] = useState(false);
  const [novo, setNovo] = useState(false);
  const [diasIa, setDiasIa] = useState(false);
  const avisos = useAvisos(quadro);
  const [ocupado, iniciar] = useTransition();
  const ocupadoRef = useRef(false);
  ocupadoRef.current = ocupado;
  const fmt = useMemo(() => criarFormatos(quadro.fuso), [quadro.fuso]);
  // Relógio da tela: as cores de atraso mudam sozinhas, mesmo sem cartão novo. Só no navegador (sem diferença
  // entre o desenho do servidor e o do navegador).
  const [agora, setAgora] = useState<number | null>(null);
  useEffect(() => {
    setAgora(Date.now());
    const t = window.setInterval(() => setAgora(Date.now()), 20000);
    return () => window.clearInterval(t);
  }, []);

  const tratar = useCallback(<T,>(r: Resposta<T>, sucesso?: string): T | null => {
    if (!r.ok) {
      if (r.sair) { window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`; return null; }
      setAviso({ tipo: 'erro', texto: r.erro });
      // O erro costuma ser "outra pessoa já mexeu": traz o quadro atual em vez de esperar a próxima atualização (U4).
      carregarQuadro(periodoRef.current).then((q) => { if (q.ok) setQuadro(q.dados); }).catch(() => undefined);
      return null;
    }
    if (sucesso) setAviso({ tipo: 'ok', texto: sucesso });
    return r.dados;
  }, [setQuadro]);

  // Atualiza sozinho enquanto a aba do navegador está visível; com os avisos ligados, também escondida
  // (o navegador espaça os pedidos da aba escondida, mas o aviso de cartão novo chega).
  const avisosRef = useRef(false);
  avisosRef.current = avisos.ligado;
  useEffect(() => {
    let parado = false;
    const tick = async () => {
      if (parado || ocupadoRef.current || emVoo.current > 0 || (document.hidden && !avisosRef.current)) return;
      const v = versao.current;
      const r = await carregarQuadro(periodoRef.current);
      if (parado) return;
      if (r.ok) { if (v === versao.current && emVoo.current === 0) setQuadro(r.dados); setFalhouAtualizar(false); }
      else if (r.sair) window.location.href = '/entrar?motivo=sessao';
      else setFalhouAtualizar(true);
    };
    const id = window.setInterval(tick, ATUALIZA_MS);
    const vis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', vis);
    // Quadro vindo da memória (voltou ao CRM): mostra na hora e já busca o atual.
    if (Date.now() - new Date(inicial.lidoEm).getTime() > 3000) tick();
    return () => { parado = true; window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Link direto para um cartão (/crm?cartao=<id>): o Interno Planee abre o aviso de comprovante no cartão certo.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('cartao');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setAberto(id);
  }, []);

  useEffect(() => {
    if (!aviso || aviso.tipo !== 'ok') return;
    const t = window.setTimeout(() => setAviso(null), 3500);
    return () => window.clearTimeout(t);
  }, [aviso]);

  // Clique com resposta na hora: aplica no quadro da tela, manda ao servidor e, quando não há outro clique em voo,
  // troca pelo quadro que o servidor devolveu (o do banco). Erro: tratar() avisa e recarrega o quadro.
  const executar = useCallback((id: string, local: (q: TQuadro) => TQuadro, chamada: () => Promise<Resposta<TQuadro>>, sucesso: string, depois?: () => void) => {
    versao.current++; emVoo.current++;
    setQuadro((q) => local(q));
    setPendentes((p) => new Set(p).add(id));
    void (async () => {
      let r: Resposta<TQuadro>;
      try { r = await chamada(); } catch { r = { ok: false, erro: 'Sem conexão com o painel agora. Tente de novo.' }; }
      emVoo.current--;
      setPendentes((p) => { const n = new Set(p); n.delete(id); return n; });
      const d = tratar(r, sucesso);
      if (d) { if (emVoo.current === 0) { versao.current++; setQuadro(d); } depois?.(); }
    })();
  }, [tratar]);

  const mudarCartao = (id: string, f: (k: TQuadro['cartoes'][number]) => TQuadro['cartoes'][number]) =>
    (q: TQuadro): TQuadro => ({ ...q, cartoes: q.cartoes.map((k) => (k.id === id ? f(k) : k)) });

  const acoes = useMemo(() => ({
    mover: (id: string, etapa: Etapa) => {
      const de = quadro.cartoes.find((k) => k.id === id)?.etapa;
      executar(id, (q) => {
        const n = mudarCartao(id, (k) => ({
          ...k, etapa, responsavel: etapa !== 'aguardando' && !k.responsavel ? nome : k.responsavel,
          assumido_em: etapa !== 'aguardando' ? (k.assumido_em ?? agoraIso()) : k.assumido_em,
          finalizado_em: etapa === 'finalizado' ? agoraIso() : null,
          // Finalizado sai dos filtros "Esperando a equipe" e "Equipe já respondeu" na hora.
          ...(etapa === 'finalizado' ? { esperandoEquipe: false, respondidoEquipe: false } : {}),
        }))(q);
        return etapa === 'finalizado' && de !== 'finalizado' ? { ...n, finalizadosHoje: n.finalizadosHoje + 1 } : n;
      }, () => moverAtendimento(id, etapa, de), `Movido para ${quadro.etapas[etapa]}.`);
    },
    assunto: (id: string, topico: string) => executar(id, mudarCartao(id, (k) => ({ ...k, topico_id: topico })), () => mudarAssunto(id, topico), 'Assunto alterado.'),
    // "Passar para…" (11/10): outro assunto e, se escolhida, outra pessoa; o cartão volta para "aguardando".
    passar: (id: string, dados: { topico: string; pessoa: { id: string; nome: string } | null; recado: string }) => {
      const t = quadro.topicos.find((x) => x.id === dados.topico)?.nome ?? 'outro assunto';
      setAberto(null); setPassarAberto(false);
      executar(id, mudarCartao(id, (k) => ({ ...k, topico_id: dados.topico, etapa: 'aguardando', responsavel: dados.pessoa?.nome ?? null, assumido_em: null, finalizado_em: null })),
        async () => { const r = await passarAtendimento(id, { topico: dados.topico, pessoa: dados.pessoa?.id ?? null, recado: dados.recado }); return r.ok ? { ok: true as const, dados: r.dados.quadro } : r; },
        `Passado para ${t}${dados.pessoa ? ` · ${dados.pessoa.nome}` : ''}.`);
    },
    arquivar: (id: string) => {
      setAberto(null);
      executar(id, (q) => ({ ...q, cartoes: q.cartoes.filter((k) => k.id !== id) }), () => arquivarAtendimento(id), 'Atendimento arquivado.');
    },
    recarregar: () => iniciar(async () => { const d = tratar(await carregarQuadro(periodoRef.current)); if (d) { versao.current++; setQuadro(d); setFalhouAtualizar(false); } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [quadro.etapas, quadro.cartoes, quadro.topicos, tratar, executar, nome]);

  // Trocar o período: busca na hora (o quadro fica com o anterior até chegar).
  const mudarPeriodo = useCallback((p: Intervalo | null) => {
    setPeriodo(p); periodoRef.current = p; versao.current++;
    iniciar(async () => { const d = tratar(await carregarQuadro(p)); if (d && chavePeriodo(d.periodo) === chavePeriodo(periodoRef.current)) { versao.current++; setQuadroBruto(d); } });
  }, [tratar]);

  const temSombra = quadro.cartoes.some((k) => k.sombra);
  // Topo do quadro: quem espera há mais tempo e quantos passaram do prazo (sem os cartões sombra, que ninguém atende).
  const reais = quadro.cartoes.filter((k) => !k.sombra && (k.etapa === 'aguardando' || k.etapa === 'pendente'));
  const maisAntigo = reais.filter((k) => k.etapa === 'aguardando').sort((a, b) => a.aberto_em.localeCompare(b.aberto_em))[0];
  const niveis = reais.map((k) => atraso(k, quadro.prazos, agora));
  const vermelhos = niveis.filter((n) => n === 'vermelho').length;
  const amarelos = niveis.filter((n) => n === 'amarelo').length;
  const verFinalEfetivo = verFinal || Boolean(quadro.periodo);
  const contagem = (e: Etapa) => quadro.cartoes.filter((k) => k.etapa === e && (origem === 'todos' || (origem === 'sombra') === k.sombra)).length;
  const esperando = quadro.cartoes.filter((k) => k.esperandoEquipe && (origem === 'todos' || (origem === 'sombra') === k.sombra)).length;
  const respondidos = quadro.cartoes.filter((k) => k.respondidoEquipe && (origem === 'todos' || (origem === 'sombra') === k.sombra)).length;
  const cartaoAberto = aberto ? quadro.cartoes.find((k) => k.id === aberto) ?? null : null;
  // O que está na tela agora (busca, origem, fase, coluna e período): "Selecionar todos" marca só isso.
  const colunaValida = coluna && quadro.topicos.some((t) => t.id === coluna) ? coluna : null;
  const marcaveis = filtrar(quadro.cartoes, busca, origem, verFinalEfetivo, fase)
    .filter((k) => selecionavel(k) && (!colunaValida || k.topico_id === colunaValida));
  const escolhidos = marcaveis.filter((k) => selecionados.has(k.id));
  // Abas de assunto do celular: quantos cartões cada coluna tem com os filtros de agora (sem finalizados escondidos).
  const naTela = filtrar(quadro.cartoes, busca, origem, verFinalEfetivo, fase);
  const idsTopicos = new Set(quadro.topicos.map((t) => t.id));
  const abasColunas = [
    ...quadro.topicos.map((t) => ({ id: t.id, nome: t.nome, n: naTela.filter((k) => k.topico_id === t.id).length })),
    ...(naTela.some((k) => !k.topico_id || !idsTopicos.has(k.topico_id)) ? [{ id: '__sem', nome: 'Sem assunto', n: naTela.filter((k) => !k.topico_id || !idsTopicos.has(k.topico_id)).length }] : []),
  ];
  const colunaCelular = (coluna && abasColunas.some((a) => a.id === coluna) ? coluna : null) ?? abasColunas.find((a) => a.n > 0)?.id ?? abasColunas[0]?.id ?? null;
  const filtrosLigados = (fase === 'esperando' || fase === 'respondido' ? 1 : 0) + (origem !== 'todos' ? 1 : 0) + (quadro.periodo ? 1 : 0) + (selecionando ? 1 : 0);
  const sairDaSelecao = () => { setSelecionando(false); setSelecionados(new Set()); setConfirmarMassa(false); };
  const alternarSelecao = (id: string) => {
    setConfirmarMassa(false);
    setSelecionados((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const finalizarEscolhidos = async () => {
    const ids = escolhidos.map((k) => k.id);
    if (!ids.length) return;
    setFinalizandoMassa(true);
    versao.current++; emVoo.current++;
    let r: Awaited<ReturnType<typeof finalizarAtendimentos>>;
    try { r = await finalizarAtendimentos(ids); } catch { r = { ok: false, erro: 'Sem conexão com o painel agora. Tente de novo.' }; }
    emVoo.current--;
    setFinalizandoMassa(false);
    const d = tratar(r);
    if (!d) return;
    versao.current++; setQuadro(d.quadro);
    sairDaSelecao();
    avisarOk(d.n === 1 ? '1 atendimento finalizado.' : `${d.n} atendimentos finalizados.`);
  };
  const fechar = useCallback(() => { setAberto(null); setPassarAberto(false); }, []);
  const avisarErro = useCallback((t: string) => setAviso({ tipo: 'erro', texto: t }), []);
  const avisarOk = useCallback((t: string) => setAviso({ tipo: 'ok', texto: t }), []);

  return (
    <div className={c.tela} data-detalhe={cartaoAberto ? 'true' : undefined}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>CRM</h1>
          <p className={c.sub}>
            {falhouAtualizar ? <span className={c.subErro}>Sem conexão com o banco agora. Tentando de novo.</span> : <>Atualizado às {fmt.hora(quadro.lidoEm)}</>}
            <button type="button" className={c.linkBotao} onClick={acoes.recarregar} disabled={ocupado}>
              <Icone nome="atualizar" tamanho={13} /> Atualizar
            </button>
          </p>
          {agora !== null && aba === 'atendimento' && (
            <div className={c.fila} aria-live="polite" data-fila>
              {maisAntigo
                ? <span className={c.filaItem} data-atraso={atraso(maisAntigo, quadro.prazos, agora)}>
                    Mais antigo aguardando: <strong>{ha(maisAntigo.aberto_em)}</strong>
                  </span>
                : <span className={c.filaItem}>Ninguém aguardando</span>}
              {vermelhos > 0 && <span className={c.filaItem} data-atraso="vermelho" data-contagem="vermelho"><strong>{vermelhos}</strong> {vermelhos === 1 ? 'atrasado' : 'atrasados'}</span>}
              {amarelos > 0 && <span className={c.filaItem} data-atraso="amarelo" data-contagem="amarelo"><strong>{amarelos}</strong> em atenção</span>}
            </div>
          )}
        </div>
        <div className={c.segmentado} role="tablist" aria-label="Partes do CRM">
          {(['atendimento', 'comercial', 'contatos'] as Aba[]).map((a) => (
            <button key={a} type="button" role="tab" aria-selected={aba === a} className={c.segItem} data-aba={a} onClick={() => setAba(a)}>
              {NOME_ABA[a]}
            </button>
          ))}
        </div>
        <label className={c.busca}>
          <span className={c.visivelLeitor}>Buscar</span>
          <Icone nome="busca" tamanho={16} />
          <input id="busca-crm" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone ou final do CPF" />
        </label>
      </header>

      <div className={c.aviso} role="status" aria-live="polite">
        {aviso && (
          <span className={aviso.tipo === 'erro' ? c.avisoErro : c.avisoOk}>
            {aviso.texto}
            <button type="button" aria-label="Fechar aviso" onClick={() => setAviso(null)}><Icone nome="fechar" tamanho={13} /></button>
          </span>
        )}
      </div>

      {aba === 'atendimento' && (
        <>
          <div className={c.barra}>
            {/* Filtro por fase (13/10): clicar numa fase mostra só os cartões dela; clicar de novo (ou em Todas) volta. */}
            <div className={`${c.segmentadoPeq} ${c.fases}`} role="group" aria-label="Filtrar por fase" data-fases>
              <button type="button" aria-pressed={fase === 'todas'} className={c.segItem} onClick={() => setFase('todas')}>Todas</button>
              {(['aguardando', 'em_atendimento', 'pendente', 'finalizado'] as Etapa[]).map((e) => (
                <button key={e} type="button" aria-pressed={fase === e} className={c.segItem} data-fase={e} onClick={() => setFase((f) => (f === e ? 'todas' : e))}>
                  <span className={c.faseItem}>
                    <span className={c.chip} data-etapa={e}><Icone nome={e} tamanho={12} /></span>
                    {quadro.etapas[e]} <strong>{contagem(e)}</strong>
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className={c.botaoFiltros} aria-expanded={filtrosAbertos} aria-controls="filtros-crm" data-filtros-celular
              onClick={() => setFiltrosAbertos((x) => !x)}>
              <Icone nome="filtro" tamanho={14} /> Filtros{filtrosLigados ? ` (${filtrosLigados})` : ''}
            </button>
            <div id="filtros-crm" className={c.barraExtra} data-aberto={filtrosAbertos ? 'true' : 'false'}>
            {/* "Ver" (15/10): os dois filtros de resposta da equipe saíram dos botões de fase para um seletor. */}
            <label className={c.filtroColuna}>
              <span className={c.visivelLeitor}>Ver</span>
              <select id="ver-crm" data-filtro-ver value={fase === 'esperando' || fase === 'respondido' ? fase : ''}
                onChange={(e) => setFase((e.target.value as Fase) || 'todas')}>
                <option value="">Todos os cartões</option>
                <option value="esperando">Esperando a equipe ({esperando})</option>
                <option value="respondido">Equipe já respondeu, falta finalizar ({respondidos})</option>
              </select>
            </label>
            {/* Filtro de coluna (15/10): escolhe um assunto e o quadro mostra só a coluna dele. */}
            <label className={`${c.filtroColuna} ${c.filtroAssunto}`}>
              <span className={c.visivelLeitor}>Coluna</span>
              <select id="coluna-crm" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value || null)} data-filtro-coluna>
                <option value="">Todas as colunas</option>
                {quadro.topicos.map((t) => {
                  const n = quadro.cartoes.filter((k) => k.topico_id === t.id && k.etapa !== 'finalizado' && (origem === 'todos' || (origem === 'sombra') === k.sombra)).length;
                  return <option key={t.id} value={t.id}>{t.nome}{n ? ` (${n})` : ''}</option>;
                })}
              </select>
            </label>
            {temSombra && (
              <div className={c.segmentadoPeq} role="group" aria-label="Origem dos cartões">
                {([['todos', 'Todos'], ['real', 'Sem sombra'], ['sombra', 'Só sombra']] as [Origem, string][]).map(([v, t]) => (
                  <button key={v} type="button" aria-pressed={origem === v} className={c.segItem} onClick={() => setOrigem(v)}>{t}</button>
                ))}
              </div>
            )}
            <FiltroData id="periodo-crm" valor={periodo} onMudar={mudarPeriodo} hoje={quadro.hoje ?? new Date().toISOString().slice(0, 10)} vazio="Abertos agora" rotulo="Período do quadro" />
            {podeEditar && (
              <button type="button" className={c.botaoSec} aria-pressed={selecionando} data-selecionar
                onClick={() => (selecionando ? sairDaSelecao() : setSelecionando(true))}
                title="Marcar vários cartões e finalizar de uma vez (dá para filtrar por dia no Período)">
                {selecionando ? 'Sair da seleção' : 'Selecionar'}
              </button>
            )}
            {/* Menu "Mais" (15/10): o que se usa de vez em quando sai da barra. */}
            <MenuMaisCrm>
              {(fechar) => (
                <>
                  {!quadro.periodo && fase === 'todas' && (
                    <button type="button" aria-pressed={verFinal} onClick={() => setVerFinal((v) => !v)}>
                      {verFinal ? 'Ocultar' : 'Mostrar'} finalizados hoje · {quadro.finalizadosHoje}
                    </button>
                  )}
                  {avisos.suportado && (
                    <button type="button" id="avisos-crm" aria-pressed={avisos.ligado} onClick={avisos.alternar}
                      title="Som e notificação quando chega atendimento novo em aguardando">
                      {avisos.ligado ? 'Avisos ligados' : 'Ligar avisos'}
                    </button>
                  )}
                  {quadro.eu?.escolhe && (
                    <MeusAssuntos quadro={quadro} onSalvo={(assuntos) => { setQuadroBruto((q) => ({ ...q, eu: { ...q.eu, assuntos } })); avisarOk('Avisos salvos.'); }} onErro={avisarErro} />
                  )}
                  {podeEditar && (
                    <button type="button" data-dias-sem-ia onClick={() => { fechar(); setDiasIa(true); }} title="Fechar dias da agenda para a IA não marcar">Dias sem IA</button>
                  )}
                </>
              )}
            </MenuMaisCrm>
            </div>
            {podeEditar && (
              <button type="button" className={c.botaoNovo} onClick={() => setNovo(true)}><Icone nome="nota" tamanho={14} /> Novo atendimento</button>
            )}
          </div>
          {selecionando && (
            <div className={c.barraSelecao} role="group" aria-label="Finalizar em massa" data-barra-selecao>
              <span><strong>{escolhidos.length}</strong> {escolhidos.length === 1 ? 'selecionado' : 'selecionados'} de {marcaveis.length} em aberto na tela</span>
              <button type="button" className={c.acaoSec} disabled={!marcaveis.length || finalizandoMassa} data-selecionar-todos
                onClick={() => { setConfirmarMassa(false); setSelecionados(new Set(marcaveis.map((k) => k.id))); }}>Selecionar todos da tela</button>
              <button type="button" className={c.acaoSec} disabled={!escolhidos.length || finalizandoMassa}
                onClick={() => { setConfirmarMassa(false); setSelecionados(new Set()); }}>Limpar</button>
              {!confirmarMassa ? (
                <button type="button" className={c.acaoPri} disabled={!escolhidos.length || finalizandoMassa} data-finalizar-selecionados
                  onClick={() => setConfirmarMassa(true)}>Finalizar selecionados</button>
              ) : (
                <>
                  <span>Finalizar {escolhidos.length} {escolhidos.length === 1 ? 'atendimento' : 'atendimentos'}?</span>
                  <button type="button" className={c.acaoPri} disabled={finalizandoMassa} data-confirmar-massa onClick={finalizarEscolhidos}>
                    {finalizandoMassa ? 'Finalizando…' : 'Confirmar'}
                  </button>
                  <button type="button" className={c.acaoSec} disabled={finalizandoMassa} onClick={() => setConfirmarMassa(false)}>Voltar</button>
                </>
              )}
              <small className={c.detMeta}>Dica: escolha o dia em Período para pegar só os cartões daquele dia.</small>
            </div>
          )}
          {quadro.periodo && <p className={c.nota} data-nota-periodo>Atendimentos abertos neste período, em todas as etapas{quadro.cartoes.length >= 1000 ? ' (os 1.000 primeiros)' : ''}.</p>}
          {celular && abasColunas.length > 1 && (
            <div className={c.abasColunas} role="tablist" aria-label="Assuntos" data-colunas-celular>
              {abasColunas.map((a) => (
                <button key={a.id} type="button" role="tab" aria-selected={a.id === colunaCelular} className={c.abaColuna} data-coluna={a.id}
                  onClick={() => setColuna(a.id)}>
                  {a.nome} <strong>{a.n}</strong>
                </button>
              ))}
            </div>
          )}
          <Quadro quadro={quadro} busca={busca} origem={origem} verFinal={verFinalEfetivo} fase={fase} coluna={celular ? colunaCelular : colunaValida} selecao={selecionando ? { ids: selecionados, alternar: alternarSelecao } : undefined} fmt={fmt} agora={agora} ocupado={ocupado} pendentes={pendentes} podeEditar={podeEditar} podeConfig={podeConfig}
            onAbrir={(id) => { setPassarAberto(false); setAberto(id); }} onMover={acoes.mover}
            onPassar={podeEditar ? (id) => { setAberto(id); setPassarAberto(true); } : undefined} />
        </>
      )}
      {aba === 'comercial' && <Comercial busca={busca} fuso={quadro.fuso} podeEditar={podeEditar} podeArquivar={podeArquivar} onAviso={avisarOk} />}
      {aba === 'contatos' && (
        <Contatos busca={busca} quadro={quadro} podeEditar={podeEditar} podeConferir={podeConferir} mascarado={mascarado} onQuadro={setQuadro} onAviso={avisarOk} onErro={avisarErro}
          onAbrir={(id) => { setAba('atendimento'); setAberto(id); }} />
      )}
      {diasIa && <DiasSemIa onFechar={() => setDiasIa(false)} onSalvo={avisarOk} />}
      {novo && (
        <NovoAtendimento quadro={quadro} onFechar={() => setNovo(false)}
          onPronto={(q) => { setQuadro(q); setNovo(false); avisarOk('Atendimento aberto.'); }} />
      )}

      {cartaoAberto && (
        <Detalhe key={cartaoAberto.id} cartao={cartaoAberto} quadro={quadro} fmt={fmt} podeArquivar={podeArquivar} podeEditar={podeEditar} podeConferir={podeConferir} nome={nome} ocupado={ocupado || pendentes.has(cartaoAberto.id)}
          onFechar={fechar} onMover={acoes.mover} onAssunto={acoes.assunto}
          onArquivar={acoes.arquivar} onErro={avisarErro} onAviso={avisarOk} passarAberto={passarAberto} onPassar={acoes.passar} />
      )}
    </div>
  );
}

// De quais assuntos a pessoa recebe aviso (11/10). Fica no banco central (vale em qualquer computador); o admin também
// muda em Equipe. Nenhum marcado = nenhum aviso de cartão novo (cartão passado para a pessoa avisa sempre).
function MeusAssuntos({ quadro, onSalvo, onErro }: { quadro: TQuadro; onSalvo: (a: string[] | null) => void; onErro: (t: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [marcados, setMarcados] = useState<string[] | null>(quadro.eu.assuntos);
  const [salvando, iniciar] = useTransition();
  const caixa = useRef<HTMLDivElement>(null);
  // Com a barra quebrando linha, o botão pode ficar à esquerda: alinhado à direita, o painel ficaria sob o menu lateral.
  const painel = useRef<HTMLDivElement>(null);
  const [aEsquerda, setAEsquerda] = useState(false);
  useLayoutEffect(() => {
    if (!aberto) { setAEsquerda(false); return; }
    const p = painel.current; if (!p || getComputedStyle(p).position !== 'absolute') return;
    const limite = caixa.current?.closest('main')?.getBoundingClientRect().left ?? 0;
    if (p.getBoundingClientRect().left < limite) setAEsquerda(true);
  }, [aberto]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  const atuais = quadro.eu.assuntos;
  const nomeAtual = !atuais ? 'todos os assuntos' : !atuais.length ? 'nenhum assunto'
    : atuais.length === 1 ? (quadro.topicos.find((t) => t.id === atuais[0])?.nome ?? '1 assunto') : `${atuais.length} assuntos`;
  const todos = marcados === null;
  const marcar = (id: string, sim: boolean) => {
    const base = marcados ?? quadro.topicos.map((t) => t.id);
    setMarcados(sim ? [...new Set([...base, id])] : base.filter((x) => x !== id));
  };
  const salvar = () => iniciar(async () => {
    // Todos marcados = "todos" (assunto novo também avisa).
    const lista = marcados && quadro.topicos.every((t) => marcados.includes(t.id)) ? null : marcados;
    const r = await salvarMeusAvisos(lista);
    if (!r.ok) { onErro(r.erro); return; }
    setAberto(false); onSalvo(r.dados);
  });
  return (
    <div className={c.meusAvisos} ref={caixa}>
      <button type="button" id="meus-assuntos" className={c.botaoSec} aria-expanded={aberto} onClick={() => { setMarcados(quadro.eu.assuntos); setAberto((a) => !a); }}
        title="De quais assuntos você recebe aviso de cartão novo">
        <Icone nome="sino" tamanho={13} /> Avisar: {nomeAtual}
      </button>
      {aberto && (
        <div className={c.meusAvisosPainel} role="dialog" aria-label="Avisos por assunto" ref={painel} data-lado={aEsquerda ? 'esquerda' : undefined}>
          <p className={c.meusAvisosTitulo}>Me avisar de cartão novo em:</p>
          <label className={c.meusAvisosLinha}>
            <input type="checkbox" checked={todos} onChange={(e) => setMarcados(e.target.checked ? null : [])} /> <strong>Todos os assuntos</strong>
          </label>
          {quadro.topicos.map((t) => (
            <label key={t.id} className={c.meusAvisosLinha}>
              <input type="checkbox" data-assunto={t.id} checked={todos || marcados!.includes(t.id)} onChange={(e) => marcar(t.id, e.target.checked)} /> {t.nome}
            </label>
          ))}
          <p className={c.meusAvisosDica}>Cartão passado para você avisa sempre.</p>
          <div className={c.acoes}>
            <button type="button" className={c.acaoSec} onClick={() => setAberto(false)}>Cancelar</button>
            <button type="button" className={c.acaoPri} disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Menu "Mais" da barra do quadro (15/10). Fica aberto enquanto a pessoa mexe nele (ligar avisos, escolher assuntos);
// fecha no clique fora, com Esc ou quando um item pede (Dias sem IA abre a janela).
function MenuMaisCrm({ children }: { children: (fechar: () => void) => React.ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return (
    <div className={c.menuMais} ref={caixa}>
      <button type="button" className={c.botaoSec} aria-haspopup="menu" aria-expanded={aberto} data-menu-crm onClick={() => setAberto((x) => !x)}>Mais ▾</button>
      {aberto && <div className={c.menuMaisLista} role="menu">{children(() => setAberto(false))}</div>}
    </div>
  );
}
