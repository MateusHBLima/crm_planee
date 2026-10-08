'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import type { EventoHistorico, Historico as THistorico, Pagamento, Servico } from '@/lib/painel/servicos';
import { conferirPagamento, mudarAutomaticas, registrarPagamento } from '@/lib/painel/acoes';
import { carregarHistorico, carregarServico } from '@/lib/painel/leitura-cliente';
import { Campo, Janela } from './Formularios';
import type { criarFormatos } from './util';
import c from './crm.module.css';

// Histórico do paciente (linha do tempo), agendamentos e comprovantes (migração 013).
// Na ficha do contato aparece inteiro; no detalhe do cartão, os 8 mais recentes.

type Fmt = ReturnType<typeof criarFormatos>;
const reais = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const FORMA: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto', dinheiro: 'Dinheiro', outro: 'Outro' };
const SITUACAO: Record<string, string> = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou' };
const ROTULO_TIPO: Record<EventoHistorico['tipo'], string> = { atendimento: 'Atendimento', nota: 'Nota', servico: 'Agendamento', pagamento: 'Pagamento', automatica: 'Mensagem automática' };

export function HistoricoPaciente({ contatoId, fmt, podeConferir, compacto = false, onAbrirAtendimento, onErro }: {
  contatoId: string; fmt: Fmt; podeConferir: boolean; compacto?: boolean;
  onAbrirAtendimento?: (id: string) => void; onErro: (t: string) => void;
}) {
  const [h, setH] = useState<THistorico | null>(null);
  const [tudo, setTudo] = useState(!compacto);
  const [servico, setServico] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<string | null>(null);
  const [novoPag, setNovoPag] = useState(false);

  const recarregar = useCallback(() => {
    carregarHistorico(contatoId).then((r) => (r.ok ? setH(r.dados) : onErro(r.erro)));
  }, [contatoId, onErro]);
  useEffect(() => { setH(null); recarregar(); }, [recarregar]);

  if (!h) return <p className={c.detMeta}>Carregando o histórico…</p>;
  const pendentes = h.pagamentos.filter((p) => !p.conferido_em);
  const suspeitos = pendentes.filter((p) => p.analise === 'suspeito');
  const vis = tudo ? h.eventos : h.eventos.slice(0, 8);
  const pagAberto = pagamento ? h.pagamentos.find((p) => p.id === pagamento) ?? null : null;

  const abrir = (e: EventoHistorico) => {
    if (!e.ref) return;
    if (e.ref.tipo === 'servico') setServico(e.ref.id);
    else if (e.ref.tipo === 'pagamento') setPagamento(e.ref.id);
    else onAbrirAtendimento?.(e.ref.id);
  };

  return (
    <section className={c.blocoHistorico} aria-label="Histórico do paciente">
      <div className={c.cabecaHistorico}>
        <h3 className={c.rotuloSec}>Histórico do paciente</h3>
        {h.podePagamentos && (suspeitos.length > 0 || pendentes.length > 0) && (
          <span className={c.resumoPag}>
            {suspeitos.length > 0 && <span className={c.seloPag} data-estado="suspeito">{suspeitos.length} suspeito{suspeitos.length > 1 ? 's' : ''}</span>}
            {pendentes.length - suspeitos.length > 0 && <span className={c.seloPag} data-estado="pendente">{pendentes.length - suspeitos.length} a conferir</span>}
          </span>
        )}
        {h.podePagamentos && h.instalado && podeConferir && !compacto && (
          <button type="button" className={c.acaoSec} onClick={() => setNovoPag(true)}>Registrar pagamento</button>
        )}
      </div>
      {h.automaticas && (
        <Automaticas a={h.automaticas} compacto={compacto} fmt={fmt}
          onMudar={async (parar, motivo) => {
            const r = await mudarAutomaticas(contatoId, parar, motivo);
            if (r.ok) setH(r.dados); else onErro(r.erro);
            return r.ok;
          }} />
      )}
      {!vis.length ? <p className={c.detMeta}>Nada registrado ainda.</p> : (
        <ol className={c.linhaTempo}>
          {vis.map((e, i) => (
            <li key={i} className={c.evLinha} data-tipo={e.tipo} data-destaque={e.destaque}>
              <span className={c.evQuando}>{fmt.quando(e.quando)}</span>
              <span className={c.evCorpo}>
                <span className={c.evTipo}>{ROTULO_TIPO[e.tipo]}{e.quem ? ` · ${e.quem}` : ''}</span>
                {e.ref && (e.ref.tipo !== 'atendimento' || onAbrirAtendimento)
                  ? <button type="button" className={c.evLink} onClick={() => abrir(e)}>{e.texto}</button>
                  : <span className={c.evTexto}>{e.texto}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!tudo && h.eventos.length > vis.length && (
        <button type="button" className={c.linkBotao} onClick={() => setTudo(true)}>Ver o histórico inteiro ({h.eventos.length})</button>
      )}
      {h.podePagamentos && !h.instalado && <p className={c.detMeta}>Agendamentos e comprovantes ainda não foram instalados nesta empresa.</p>}

      {servico && (
        <DetalheServico id={servico} contatoId={contatoId} fmt={fmt} podeConferir={podeConferir} onFechar={() => setServico(null)} onErro={onErro}
          onMudou={(d) => setH(d)} />
      )}
      {pagAberto && (
        <Janela titulo="Comprovante" onFechar={() => setPagamento(null)}>
          <CartaoPagamento p={pagAberto} fmt={fmt} podeConferir={podeConferir} contatoId={contatoId}
            onMudou={(d) => setH(d)} onErro={onErro} />
        </Janela>
      )}
      {novoPag && (
        <NovoPagamento contatoId={contatoId} servicos={h.servicos} onFechar={() => setNovoPag(false)}
          onPronto={(d) => { setH(d); setNovoPag(false); }} />
      )}
    </section>
  );
}

function DetalheServico({ id, contatoId, fmt, podeConferir, onFechar, onErro, onMudou }: {
  id: string; contatoId: string; fmt: Fmt; podeConferir: boolean; onFechar: () => void; onErro: (t: string) => void; onMudou: (d: THistorico) => void;
}) {
  const [d, setD] = useState<{ servico: Servico; pagamentos: Pagamento[] } | null>(null);
  const carregar = useCallback(() => {
    carregarServico(id).then((r) => (r.ok ? setD(r.dados) : onErro(r.erro)));
  }, [id, onErro]);
  useEffect(() => { carregar(); }, [carregar]);
  const s = d?.servico;
  const extras = s ? Object.entries(s.detalhes ?? {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object') : [];
  return (
    <Janela titulo={s ? `${s.tipo}${s.inicio ? ' · ' + fmt.quando(s.inicio) : ''}` : 'Agendamento'} onFechar={onFechar}>
      {!s ? <p className={c.detMeta}>Carregando…</p> : (
        <>
          <div className={c.detLinhas} data-servico={s.id}>
            <div className={c.detLinha}><span className={c.metaRot}>Situação</span><span className={c.seloPag} data-estado={s.situacao}>{SITUACAO[s.situacao] ?? s.situacao}</span></div>
            {s.inicio && <div className={c.detLinha}><span className={c.metaRot}>Quando</span><span>{fmt.quando(s.inicio)}</span></div>}
            {s.profissional && <div className={c.detLinha}><span className={c.metaRot}>Profissional</span><span>{s.profissional}</span></div>}
            {s.local && <div className={c.detLinha}><span className={c.metaRot}>Local</span><span>{s.local}</span></div>}
            {s.valor !== null && <div className={c.detLinha}><span className={c.metaRot}>Valor</span><span>{reais(s.valor)}</span></div>}
            {s.codigo_externo && <div className={c.detLinha}><span className={c.metaRot}>{s.sistema === 'feegow' ? 'ID Feegow' : `Código${s.sistema ? ' ' + s.sistema : ''}`}</span><span className={c.mono} data-codigo>{s.codigo_externo}</span></div>}
            {s.descricao && <div className={c.detLinha}><span className={c.metaRot}>Detalhe</span><span>{s.descricao}</span></div>}
            {extras.map(([k, v]) => <div key={k} className={c.detLinha}><span className={c.metaRot}>{k.replace(/_/g, ' ')}</span><span>{String(v)}</span></div>)}
            <div className={c.detLinha}><span className={c.metaRot}>Registrado</span><span>{fmt.quando(s.criado_em)}{s.criado_por ? ` · ${s.criado_por}` : ''}</span></div>
          </div>
          <h3 className={c.rotuloSec}>Pagamentos deste agendamento</h3>
          {!d.pagamentos.length ? <p className={c.detMeta}>Nenhum comprovante ainda.</p> : d.pagamentos.map((p) => (
            <CartaoPagamento key={p.id} p={p} fmt={fmt} podeConferir={podeConferir} onErro={onErro} contatoId={contatoId}
              onMudou={(h) => { carregar(); onMudou(h); }} />
          ))}
        </>
      )}
    </Janela>
  );
}

// O que estava escrito no comprovante, lido pela IA (migração 014).
function DadosComprovante({ k, fmt }: { k: NonNullable<Pagamento['comprovante']>; fmt: Fmt }) {
  const doc = (d: string) => (d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d);
  const linhas: [string, string][] = [];
  if (k.pagador) linhas.push(['Pagador', k.pagador + (k.banco ? ` · ${k.banco}` : '')]);
  else if (k.banco) linhas.push(['Banco', k.banco]);
  if (k.recebedor || k.recebedor_documento) linhas.push(['Recebedor', [k.recebedor, k.recebedor_documento && doc(k.recebedor_documento)].filter(Boolean).join(' · ')]);
  if (k.emitido_em) linhas.push(['No comprovante', fmt.quando(k.emitido_em)]);
  if (k.id_pix) linhas.push(['ID Pix', k.id_pix]);
  return (
    <div className={c.detLinhas} data-comprovante>
      {linhas.map(([r, v]) => (
        <div key={r} className={c.detLinha}><span className={c.metaRot}>{r}</span><span className={r === 'ID Pix' ? c.mono : undefined} style={r === 'ID Pix' ? { wordBreak: 'break-all' } : undefined}>{v}</span></div>
      ))}
    </div>
  );
}

function CartaoPagamento({ p, fmt, podeConferir, contatoId, onMudou, onErro }: {
  p: Pagamento; fmt: Fmt; podeConferir: boolean; contatoId: string; onMudou: (d: THistorico) => void; onErro: (t: string) => void;
}) {
  const [salvando, iniciar] = useTransition();
  const estado = p.conferido_em ? 'conferido' : p.analise === 'suspeito' ? 'suspeito' : 'pendente';
  const conferir = (sim: boolean) => iniciar(async () => {
    const r = await conferirPagamento(contatoId, p.id, sim);
    if (!r.ok) { onErro(r.erro); return; }
    onMudou(r.dados);
  });
  return (
    <article className={c.cartaoPag} data-estado={estado} data-pagamento={p.id}>
      <div className={c.cartaoPagTopo}>
        <strong>{p.valor !== null ? reais(p.valor) : 'Valor não informado'}</strong>
        <span className={c.seloPag} data-estado={estado}>
          {estado === 'conferido' ? 'Conferido' : estado === 'suspeito' ? 'Suspeito' : 'A conferir'}
        </span>
      </div>
      <p className={c.detMeta}>
        {p.pago_em ? `Pago em ${fmt.quando(p.pago_em)}` : 'Data do pagamento não informada'}
        {p.forma ? ` · ${FORMA[p.forma] ?? p.forma}` : ''}{p.descricao ? ` · ${p.descricao}` : ''}
      </p>
      {p.comprovante && <DadosComprovante k={p.comprovante} fmt={fmt} />}
      {p.analise === 'suspeito' && (
        <ul className={c.motivos} data-motivos>{(p.analise_motivos.length ? p.analise_motivos : ['A análise não informou o motivo.']).map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {p.analise === 'ok' && <p className={c.detMeta}>Análise da IA: sem sinais de problema.</p>}
      <p className={c.detMeta}>
        Recebido {fmt.quando(p.criado_em)}{p.criado_por ? ` · ${p.criado_por}` : ''}
        {p.conferido_em ? ` · Conferido por ${p.conferido_por ?? 'equipe'} em ${fmt.quando(p.conferido_em)}` : ''}
      </p>
      <div className={c.acoes}>
        {p.tem_arquivo && (
          <a className={c.acaoSec + ' ' + c.linkAcao} href={`/api/painel/pagamentos/${p.id}/arquivo`} target="_blank" rel="noopener noreferrer">Ver comprovante</a>
        )}
        {podeConferir && (p.conferido_em
          ? <button type="button" className={c.acaoSec} disabled={salvando} onClick={() => conferir(false)}>Desfazer conferência</button>
          : <button type="button" className={c.acaoPri} disabled={salvando} onClick={() => conferir(true)}>{salvando ? 'Salvando…' : 'Conferir'}</button>)}
      </div>
    </article>
  );
}

function NovoPagamento({ contatoId, servicos, onFechar, onPronto }: {
  contatoId: string; servicos: Servico[]; onFechar: () => void; onPronto: (d: THistorico) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  return (
    <Janela titulo="Registrar pagamento" onFechar={onFechar}>
      <form className={c.formJanela} onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        iniciar(async () => {
          setErro(null);
          const r = await registrarPagamento(contatoId, form);
          if (!r.ok) { setErro(r.erro); return; }
          onPronto(r.dados);
        });
      }}>
        <Campo id="pg-servico" rotulo="Agendamento">
          <select id="pg-servico" name="servico_id" defaultValue="">
            <option value="">Sem agendamento (só no paciente)</option>
            {servicos.map((s) => <option key={s.id} value={s.id}>{s.tipo}{s.inicio ? ' · ' + new Date(s.inicio).toLocaleDateString('pt-BR') : ''}{s.codigo_externo ? ' · ' + s.codigo_externo : ''}</option>)}
          </select>
        </Campo>
        <Campo id="pg-valor" rotulo="Valor (R$)"><input id="pg-valor" name="valor" inputMode="decimal" placeholder="200,00" /></Campo>
        <Campo id="pg-data" rotulo="Data do pagamento"><input id="pg-data" name="pago_em" type="date" /></Campo>
        <Campo id="pg-forma" rotulo="Forma">
          <select id="pg-forma" name="forma" defaultValue="pix">
            {Object.entries(FORMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo id="pg-descricao" rotulo="A que se refere"><input id="pg-descricao" name="descricao" maxLength={300} placeholder="Sinal da consulta de 14/10" /></Campo>
        <Campo id="pg-arquivo" rotulo="Comprovante (PDF, JPG ou PNG, até 10 MB)">
          <input id="pg-arquivo" name="arquivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
        </Campo>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}>
          <button type="button" className={c.acaoSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Registrar'}</button>
        </div>
      </form>
    </Janela>
  );
}

// Mensagens automáticas da Sara (aniversário, lembretes, follow-up): o selo do momento e, na ficha, o botão para
// parar ou voltar a enviar. Parar vale para todos os cadastros do mesmo telefone.
function Automaticas({ a, compacto, fmt, onMudar }: {
  a: NonNullable<THistorico['automaticas']>; compacto: boolean; fmt: Fmt; onMudar: (parar: boolean, motivo?: string) => Promise<boolean>;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, iniciar] = useTransition();
  const mudar = (parar: boolean) => iniciar(async () => { if (await onMudar(parar, parar ? motivo.trim() || undefined : undefined)) { setPedindo(false); setMotivo(''); } });
  return (
    <div className={c.blocoAuto} aria-label="Mensagens automáticas">
      <div className={c.linhaAuto}>
        {a.recusa
          ? <span className={c.seloAuto} data-selo="parou">Não recebe mensagens automáticas desde {fmt.quando(a.recusa.desde)}{a.recusa.motivo ? ` · ${a.recusa.motivo}` : ''}{a.recusa.por ? ` · ${a.recusa.por}` : ''}</span>
          : <span className={c.seloAuto} data-selo="ok">Recebe mensagens automáticas</span>}
        {a.selo && a.selo.tipo !== 'parou' && <span className={c.seloAuto} data-selo={a.selo.tipo}>{a.selo.texto}</span>}
        {!compacto && a.podeMudar && !pedindo && (
          a.recusa
            ? <button type="button" className={c.acaoSec} disabled={enviando} onClick={() => mudar(false)}>{enviando ? 'Salvando…' : 'Voltar a enviar'}</button>
            : <button type="button" className={c.acaoSec} onClick={() => setPedindo(true)}>Parar mensagens automáticas</button>
        )}
      </div>
      {pedindo && (
        <form className={c.linhaAuto} onSubmit={(e) => { e.preventDefault(); mudar(true); }}>
          <label className={c.campo} htmlFor="auto-motivo" style={{ flex: '1 1 220px' }}>
            <span>Motivo (opcional)</span>
            <input id="auto-motivo" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pediu pelo WhatsApp para não receber" />
          </label>
          <button type="button" className={c.acaoSec} onClick={() => setPedindo(false)}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Parar'}</button>
        </form>
      )}
    </div>
  );
}
