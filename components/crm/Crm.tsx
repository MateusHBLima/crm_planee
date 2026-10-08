'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { Etapa, Quadro as TQuadro } from '@/lib/painel/crm';
import { arquivarAtendimento, assumirAtendimento, moverAtendimento, mudarAssunto, type Resposta } from '@/lib/painel/acoes';
import { carregarQuadro } from '@/lib/painel/leitura-cliente';
import { lembrar } from '@/lib/painel/memoria-cliente';
import { Icone } from '@/components/Icone';
import { Quadro } from './Quadro';
import { Detalhe } from './Detalhe';
import { Comercial } from './Comercial';
import { Contatos } from './Contatos';
import { NovoAtendimento } from './Formularios';
import { useAvisos } from './avisos';
import { atraso, criarFormatos, ha } from './util';
import c from './crm.module.css';

type Aba = 'atendimento' | 'comercial' | 'contatos';
export type Origem = 'todos' | 'real' | 'sombra';
const ATUALIZA_MS = 15000;

export type PropsCrm = {
  inicial: TQuadro; podeArquivar: boolean; podeEditar: boolean; podeConfig: boolean; podeConferir?: boolean; mascarado: boolean; nome: string;
  memoria?: string;   // chave da memória da tela (lib/painel/memoria-cliente.ts): voltar ao CRM mostra o último quadro na hora
};

// Cartão alterado na tela antes da resposta do servidor (09/10): o clique aparece na hora; se o servidor recusar,
// o quadro volta a ser o do banco e o aviso explica.
const agoraIso = () => new Date().toISOString();

export function Crm({ inicial, podeArquivar, podeEditar, podeConfig, podeConferir = false, mascarado, nome, memoria }: PropsCrm) {
  const [quadro, setQuadro] = useState(inicial);
  useEffect(() => { if (memoria) lembrar(memoria, quadro); }, [memoria, quadro]);
  // Ações em andamento: cartões com clique pendente (só eles ficam travados) e a versão local do quadro.
  // Uma atualização automática que saiu antes de um clique não sobrescreve o clique quando volta.
  const [pendentes, setPendentes] = useState<ReadonlySet<string>>(() => new Set());
  const versao = useRef(0);
  const emVoo = useRef(0);
  const [aba, setAba] = useState<Aba>('atendimento');
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState<Origem>('todos');
  const [verFinal, setVerFinal] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [falhouAtualizar, setFalhouAtualizar] = useState(false);
  const [novo, setNovo] = useState(false);
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
      carregarQuadro().then((q) => { if (q.ok) setQuadro(q.dados); }).catch(() => undefined);
      return null;
    }
    if (sucesso) setAviso({ tipo: 'ok', texto: sucesso });
    return r.dados;
  }, []);

  // Atualiza sozinho enquanto a aba do navegador está visível; com os avisos ligados, também escondida
  // (o navegador espaça os pedidos da aba escondida, mas o aviso de cartão novo chega).
  const avisosRef = useRef(false);
  avisosRef.current = avisos.ligado;
  useEffect(() => {
    let parado = false;
    const tick = async () => {
      if (parado || ocupadoRef.current || emVoo.current > 0 || (document.hidden && !avisosRef.current)) return;
      const v = versao.current;
      const r = await carregarQuadro();
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
    assumir: (id: string) => executar(id,
      mudarCartao(id, (k) => ({ ...k, etapa: 'em_atendimento', responsavel: nome, assumido_em: k.assumido_em ?? agoraIso(), finalizado_em: null })),
      () => assumirAtendimento(id), 'Você assumiu o atendimento.'),
    mover: (id: string, etapa: Etapa) => {
      const de = quadro.cartoes.find((k) => k.id === id)?.etapa;
      executar(id, (q) => {
        const n = mudarCartao(id, (k) => ({
          ...k, etapa, responsavel: etapa !== 'aguardando' && !k.responsavel ? nome : k.responsavel,
          assumido_em: etapa !== 'aguardando' ? (k.assumido_em ?? agoraIso()) : k.assumido_em,
          finalizado_em: etapa === 'finalizado' ? agoraIso() : null,
        }))(q);
        return etapa === 'finalizado' && de !== 'finalizado' ? { ...n, finalizadosHoje: n.finalizadosHoje + 1 } : n;
      }, () => moverAtendimento(id, etapa, de), `Movido para ${quadro.etapas[etapa]}.`);
    },
    assunto: (id: string, topico: string) => executar(id, mudarCartao(id, (k) => ({ ...k, topico_id: topico })), () => mudarAssunto(id, topico), 'Assunto alterado.'),
    arquivar: (id: string) => {
      setAberto(null);
      executar(id, (q) => ({ ...q, cartoes: q.cartoes.filter((k) => k.id !== id) }), () => arquivarAtendimento(id), 'Atendimento arquivado.');
    },
    recarregar: () => iniciar(async () => { const d = tratar(await carregarQuadro()); if (d) { versao.current++; setQuadro(d); setFalhouAtualizar(false); } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [quadro.etapas, quadro.cartoes, tratar, executar, nome]);

  const temSombra = quadro.cartoes.some((k) => k.sombra);
  // Topo do quadro: quem espera há mais tempo e quantos passaram do prazo (sem os cartões sombra, que ninguém atende).
  const reais = quadro.cartoes.filter((k) => !k.sombra && (k.etapa === 'aguardando' || k.etapa === 'pendente'));
  const maisAntigo = reais.filter((k) => k.etapa === 'aguardando').sort((a, b) => a.aberto_em.localeCompare(b.aberto_em))[0];
  const niveis = reais.map((k) => atraso(k, quadro.prazos, agora));
  const vermelhos = niveis.filter((n) => n === 'vermelho').length;
  const amarelos = niveis.filter((n) => n === 'amarelo').length;
  const contagem = (e: Etapa) => quadro.cartoes.filter((k) => k.etapa === e && (origem === 'todos' || (origem === 'sombra') === k.sombra)).length;
  const cartaoAberto = aberto ? quadro.cartoes.find((k) => k.id === aberto) ?? null : null;
  const fechar = useCallback(() => setAberto(null), []);
  const avisarErro = useCallback((t: string) => setAviso({ tipo: 'erro', texto: t }), []);
  const avisarOk = useCallback((t: string) => setAviso({ tipo: 'ok', texto: t }), []);

  return (
    <div className={c.tela}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>CRM</h1>
          <p className={c.sub}>
            {falhouAtualizar ? <span className={c.subErro}>Sem conexão com o banco agora. Tentando de novo.</span> : <>Atualizado às {fmt.hora(quadro.lidoEm)}</>}
            <button type="button" className={c.linkBotao} onClick={acoes.recarregar} disabled={ocupado}>
              <Icone nome="atualizar" tamanho={13} /> Atualizar
            </button>
          </p>
        </div>
        <div className={c.segmentado} role="tablist" aria-label="Partes do CRM">
          {(['atendimento', 'comercial', 'contatos'] as Aba[]).map((a) => (
            <button key={a} type="button" role="tab" aria-selected={aba === a} className={c.segItem} onClick={() => setAba(a)}>
              {a === 'atendimento' ? 'Atendimento' : a === 'comercial' ? 'Comercial' : 'Contatos'}
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
            <div className={c.resumo}>
              {(['aguardando', 'em_atendimento', 'pendente'] as Etapa[]).map((e) => (
                <span key={e} className={c.resumoItem}>
                  <span className={c.chip} data-etapa={e}><Icone nome={e} tamanho={12} /></span>
                  {quadro.etapas[e]} <strong>{contagem(e)}</strong>
                </span>
              ))}
            </div>
            {agora !== null && (
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
            {temSombra && (
              <div className={c.segmentadoPeq} role="group" aria-label="Origem dos cartões">
                {([['todos', 'Todos'], ['real', 'Sem sombra'], ['sombra', 'Só sombra']] as [Origem, string][]).map(([v, t]) => (
                  <button key={v} type="button" aria-pressed={origem === v} className={c.segItem} onClick={() => setOrigem(v)}>{t}</button>
                ))}
              </div>
            )}
            <button type="button" className={c.botaoSec} aria-pressed={verFinal} onClick={() => setVerFinal((v) => !v)}>
              {verFinal ? 'Ocultar' : 'Mostrar'} finalizados hoje · {quadro.finalizadosHoje}
            </button>
            {avisos.suportado && (
              <button type="button" id="avisos-crm" className={c.botaoSec} aria-pressed={avisos.ligado} onClick={avisos.alternar}
                title="Som e notificação quando chega atendimento novo em aguardando">
                {avisos.ligado ? 'Avisos ligados' : 'Ligar avisos'}
              </button>
            )}
            {podeEditar && (
              <button type="button" className={c.botaoNovo} onClick={() => setNovo(true)}><Icone nome="nota" tamanho={14} /> Novo atendimento</button>
            )}
          </div>
          <Quadro quadro={quadro} busca={busca} origem={origem} verFinal={verFinal} fmt={fmt} agora={agora} ocupado={ocupado} pendentes={pendentes} podeEditar={podeEditar} podeConfig={podeConfig}
            onAbrir={setAberto} onAssumir={acoes.assumir} onMover={acoes.mover} />
        </>
      )}
      {aba === 'comercial' && <Comercial busca={busca} fuso={quadro.fuso} podeEditar={podeEditar} podeArquivar={podeArquivar} onAviso={avisarOk} />}
      {aba === 'contatos' && (
        <Contatos busca={busca} quadro={quadro} podeEditar={podeEditar} podeConferir={podeConferir} mascarado={mascarado} onQuadro={setQuadro} onAviso={avisarOk} onErro={avisarErro}
          onAbrir={(id) => { setAba('atendimento'); setAberto(id); }} />
      )}
      {novo && (
        <NovoAtendimento quadro={quadro} onFechar={() => setNovo(false)}
          onPronto={(q) => { setQuadro(q); setNovo(false); avisarOk('Atendimento aberto.'); }} />
      )}

      {cartaoAberto && (
        <Detalhe key={cartaoAberto.id} cartao={cartaoAberto} quadro={quadro} fmt={fmt} podeArquivar={podeArquivar} podeEditar={podeEditar} podeConferir={podeConferir} nome={nome} ocupado={ocupado || pendentes.has(cartaoAberto.id)}
          onFechar={fechar} onAssumir={acoes.assumir} onMover={acoes.mover} onAssunto={acoes.assunto}
          onArquivar={acoes.arquivar} onErro={avisarErro} />
      )}
    </div>
  );
}
