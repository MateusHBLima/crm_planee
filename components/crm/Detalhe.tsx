'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { Cartao, Etapa, Evento, Quadro as TQuadro } from '@/lib/painel/crm';
import { anotarAtendimento, carregarDetalhe } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { Acoes, EtapaPill } from './Quadro';
import { cpfBonito, ha, linkWhatsApp, telefoneBonito, type criarFormatos } from './util';
import c from './crm.module.css';

type Fmt = ReturnType<typeof criarFormatos>;

export function Detalhe({ cartao: k, quadro, fmt, podeArquivar, podeEditar, ocupado, onFechar, onAssumir, onMover, onAssunto, onArquivar, onErro }: {
  cartao: Cartao; quadro: TQuadro; fmt: Fmt; podeArquivar: boolean; podeEditar: boolean; nome: string; ocupado: boolean;
  onFechar: () => void; onAssumir: (id: string) => void; onMover: (id: string, e: Etapa) => void;
  onAssunto: (id: string, t: string) => void; onArquivar: (id: string) => void; onErro: (t: string) => void;
}) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [nota, setNota] = useState('');
  const [confirmarArquivo, setConfirmarArquivo] = useState(false);
  const [salvando, iniciar] = useTransition();
  const painel = useRef<HTMLElement>(null);

  // Recarrega o histórico quando o cartão muda (etapa, responsável ou notas).
  const assinatura = `${k.etapa}|${k.responsavel}|${k.notas}|${k.topico_id}`;
  useEffect(() => {
    let vivo = true;
    carregarDetalhe(k.id).then((r) => {
      if (!vivo) return;
      if (r.ok) setEventos(r.dados.eventos);
      else onErro(r.erro);
    });
    return () => { vivo = false; };
  }, [k.id, assinatura, onErro]);

  useEffect(() => {
    painel.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  const salvarNota = () => iniciar(async () => {
    const r = await anotarAtendimento(k.id, nota);
    if (!r.ok) { onErro(r.erro); return; }
    setEventos(r.dados.eventos);
    setNota('');
  });

  const wa = linkWhatsApp(k.telefone);
  const copiar = async (t: string) => { try { await navigator.clipboard.writeText(t); } catch { /* sem permissão: o texto continua selecionável */ } };

  return (
    <div className={c.fundoDetalhe} onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <aside ref={painel} tabIndex={-1} className={c.detalhe} aria-label={`Atendimento de ${k.nome || 'contato sem nome'}`}>
        <header className={c.detTopo}>
          <div className={c.detTitulo}>
            <EtapaPill etapa={k.etapa} nome={quadro.etapas[k.etapa]} />
            <h2>{k.nome || 'Contato sem nome'}</h2>
          </div>
          <button type="button" className={c.fechar} onClick={onFechar} aria-label="Fechar"><Icone nome="fechar" tamanho={18} /></button>
        </header>

        <div className={c.detCorpo}>
          {k.sombra && <p className={c.detSombra}>Cartão da Sara nova no modo sombra: ela não respondeu o paciente. Serve para conferir o que ela teria feito.</p>}

          <section className={c.detBloco}>
            <h3 className={c.rotuloSec}>Contato</h3>
            <div className={c.detLinhas}>
              {k.telefone && (
                <div className={c.detLinha}>
                  <span className={c.metaRot}>Telefone</span>
                  <span className={c.mono}>{telefoneBonito(k.telefone)}</span>
                  <button type="button" className={c.linkBotao} onClick={() => copiar(k.telefone ?? '')}>Copiar</button>
                  {wa && <a className={c.linkBotao} href={wa} target="_blank" rel="noreferrer"><Icone nome="conversa" tamanho={13} /> Abrir no WhatsApp</a>}
                </div>
              )}
              {k.documento && <div className={c.detLinha}><span className={c.metaRot}>CPF</span><span className={c.mono}>{cpfBonito(k.documento)}</span></div>}
              {k.lead && <div className={c.detLinha}><span className={c.metaRot}>Funil</span><span>Ligado a uma oportunidade</span></div>}
            </div>
          </section>

          <section className={c.detBloco}>
            <h3 className={c.rotuloSec}>O que foi pedido</h3>
            <p className={c.detResumo}>{k.resumo || 'Sem resumo.'}</p>
            <p className={c.detMeta}>
              Aberto {fmt.quando(k.aberto_em)}{k.aberto_por ? ` por ${k.aberto_por}` : ''}
              {k.etapa !== 'finalizado' ? ` · ${ha(k.aberto_em)}` : k.finalizado_em ? ` · finalizado ${fmt.quando(k.finalizado_em)}` : ''}
              {k.responsavel ? ` · responsável ${k.responsavel}` : ''}
            </p>
          </section>

          <section className={c.detBloco}>
            <h3 className={c.rotuloSec}>Andamento</h3>
            {podeEditar && <Acoes k={k} quadro={quadro} ocupado={ocupado} onAssumir={onAssumir} onMover={onMover} />}
            <div className={c.detCampos}>
              <label className={c.campo}>
                <span>Etapa</span>
                <select id="det-etapa" value={k.etapa} disabled={ocupado || !podeEditar} onChange={(e) => onMover(k.id, e.target.value as Etapa)}>
                  {(Object.keys(quadro.etapas) as Etapa[]).map((e) => <option key={e} value={e}>{quadro.etapas[e]}</option>)}
                </select>
              </label>
              <label className={c.campo}>
                <span>Assunto</span>
                <select id="det-assunto" value={k.topico_id ?? ''} disabled={ocupado || !podeEditar} onChange={(e) => onAssunto(k.id, e.target.value)}>
                  {!k.topico_id && <option value="">Sem assunto</option>}
                  {quadro.topicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className={c.detBloco}>
            <h3 className={c.rotuloSec}>Histórico e notas</h3>
            {eventos === null ? <p className={c.detMeta}>Carregando…</p> : (
              <ol className={c.historico}>
                {eventos.map((ev, i) => (
                  <li key={i} className={ev.tipo === 'nota' ? c.evNota : c.evAcao}>
                    <span className={c.evQuando}>{fmt.quando(ev.quando)}</span>
                    <span className={c.evTexto}>{ev.tipo === 'nota' ? <><strong>{ev.quem || 'Nota'}:</strong> {ev.texto}</> : <>{ev.texto}{ev.quem ? ` · ${ev.quem}` : ''}</>}</span>
                  </li>
                ))}
              </ol>
            )}
            {podeEditar && <form className={c.formNota} onSubmit={(e) => { e.preventDefault(); if (nota.trim()) salvarNota(); }}>
              <label className={c.visivelLeitor} htmlFor="nova-nota">Nova nota interna</label>
              <textarea id="nova-nota" value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={4000}
                placeholder="Nota interna (o paciente não vê)" />
              <button type="submit" className={c.acaoPri} disabled={salvando || !nota.trim()}>{salvando ? 'Salvando…' : 'Salvar nota'}</button>
            </form>}
          </section>

          {podeArquivar && (
            <section className={c.detBloco}>
              {!confirmarArquivo ? (
                <button type="button" className={c.botaoPerigo} onClick={() => setConfirmarArquivo(true)} disabled={ocupado}>
                  <Icone nome="arquivo" tamanho={15} /> Arquivar atendimento
                </button>
              ) : (
                <div className={c.confirmar}>
                  <span>Arquivar tira o cartão do quadro. Ele continua guardado no banco.</span>
                  <div className={c.acoes}>
                    <button type="button" className={c.acaoSec} onClick={() => setConfirmarArquivo(false)}>Cancelar</button>
                    <button type="button" className={c.botaoPerigoCheio} onClick={() => onArquivar(k.id)} disabled={ocupado}>Arquivar</button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
