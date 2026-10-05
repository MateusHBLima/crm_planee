'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { Etapa, Quadro as TQuadro } from '@/lib/painel/crm';
import {
  arquivarAtendimento, assumirAtendimento, carregarQuadro, moverAtendimento, mudarAssunto, type Resposta,
} from '@/lib/painel/acoes';
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

export function Crm({ inicial, podeArquivar, podeEditar, podeConfig, mascarado, nome }: {
  inicial: TQuadro; podeArquivar: boolean; podeEditar: boolean; podeConfig: boolean; mascarado: boolean; nome: string;
}) {
  const [quadro, setQuadro] = useState(inicial);
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
      if (parado || ocupadoRef.current || (document.hidden && !avisosRef.current)) return;
      const r = await carregarQuadro();
      if (parado) return;
      if (r.ok) { setQuadro(r.dados); setFalhouAtualizar(false); }
      else if (r.sair) window.location.href = '/entrar?motivo=sessao';
      else setFalhouAtualizar(true);
    };
    const id = window.setInterval(tick, ATUALIZA_MS);
    const vis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { parado = true; window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);

  useEffect(() => {
    if (!aviso || aviso.tipo !== 'ok') return;
    const t = window.setTimeout(() => setAviso(null), 3500);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const acoes = useMemo(() => ({
    assumir: (id: string) => iniciar(async () => { const d = tratar(await assumirAtendimento(id), `Você assumiu o atendimento.`); if (d) setQuadro(d); }),
    mover: (id: string, etapa: Etapa) => iniciar(async () => {
      const de = quadro.cartoes.find((k) => k.id === id)?.etapa;
      const d = tratar(await moverAtendimento(id, etapa, de), `Movido para ${quadro.etapas[etapa]}.`); if (d) setQuadro(d);
    }),
    assunto: (id: string, topico: string) => iniciar(async () => { const d = tratar(await mudarAssunto(id, topico), 'Assunto alterado.'); if (d) setQuadro(d); }),
    arquivar: (id: string) => iniciar(async () => { const d = tratar(await arquivarAtendimento(id), 'Atendimento arquivado.'); if (d) { setQuadro(d); setAberto(null); } }),
    recarregar: () => iniciar(async () => { const d = tratar(await carregarQuadro()); if (d) { setQuadro(d); setFalhouAtualizar(false); } }),
  }), [quadro.etapas, quadro.cartoes, tratar]);

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
          <Quadro quadro={quadro} busca={busca} origem={origem} verFinal={verFinal} fmt={fmt} agora={agora} ocupado={ocupado} podeEditar={podeEditar} podeConfig={podeConfig}
            onAbrir={setAberto} onAssumir={acoes.assumir} onMover={acoes.mover} />
        </>
      )}
      {aba === 'comercial' && <Comercial busca={busca} fuso={quadro.fuso} podeEditar={podeEditar} podeArquivar={podeArquivar} onAviso={avisarOk} />}
      {aba === 'contatos' && (
        <Contatos busca={busca} quadro={quadro} podeEditar={podeEditar} mascarado={mascarado} onQuadro={setQuadro} onAviso={avisarOk} onErro={avisarErro}
          onAbrir={(id) => { setAba('atendimento'); setAberto(id); }} />
      )}
      {novo && (
        <NovoAtendimento quadro={quadro} onFechar={() => setNovo(false)}
          onPronto={(q) => { setQuadro(q); setNovo(false); avisarOk('Atendimento aberto.'); }} />
      )}

      {cartaoAberto && (
        <Detalhe key={cartaoAberto.id} cartao={cartaoAberto} quadro={quadro} fmt={fmt} podeArquivar={podeArquivar} podeEditar={podeEditar} nome={nome} ocupado={ocupado}
          onFechar={fechar} onAssumir={acoes.assumir} onMover={acoes.mover} onAssunto={acoes.assunto}
          onArquivar={acoes.arquivar} onErro={avisarErro} />
      )}
    </div>
  );
}
