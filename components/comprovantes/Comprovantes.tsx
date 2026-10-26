'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import type { FilaComprovantes, ItemFila } from '@/lib/painel/servicos';
import { carregarComprovantes } from '@/lib/painel/leitura-cliente';
import { conferirNaFila, marcarBaixadoNaFila } from '@/lib/painel/acoes';
import { Esqueleto } from '@/components/Esqueleto';
import { nomeBonito, telefoneBonito } from '@/components/crm/util';
import { avisarTotalComprovantes } from './ContadorComprovantes';
import c from './comprovantes.module.css';

// Fila "Comprovantes a conferir" (22/10): todos os comprovantes que ainda não foram conferidos, do mais novo ao mais
// antigo. Quem confere marca "Conferido" (sai da fila) e, quando a empresa usa a Feegow, "Baixado na Feegow" (opcional).
// Atualiza a cada minuto. O contador do menu (ContadorComprovantes) mostra o total em todas as telas.

const ATUALIZA_MS = 60_000;
const reais = (v: number | null) => (v === null ? 'Valor não informado' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const FORMA: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto', dinheiro: 'Dinheiro', outro: 'Outro' };

export function Comprovantes({ fuso }: { fuso: string }) {
  const [fila, setFila] = useState<FilaComprovantes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const receber = useCallback((f: FilaComprovantes) => { setFila(f); setErro(null); avisarTotalComprovantes(f.total); }, []);
  const ler = useCallback(async () => {
    const r = await carregarComprovantes();
    if (r.ok) receber(r.dados);
    else if (r.sair) window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`;
    else setErro(r.erro);
  }, [receber]);

  useEffect(() => {
    void ler();
    const t = window.setInterval(() => { if (!document.hidden) void ler(); }, ATUALIZA_MS);
    return () => window.clearInterval(t);
  }, [ler]);

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 3500);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const fmt = useMemo(() => new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), [fuso]);
  const quando = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : '');

  if (!fila) return erro ? <div className={c.tela}><h1 className={c.titulo}>Comprovantes</h1><p className={`${c.aviso} ${c.avisoErro}`} role="alert">{erro}</p></div> : <Esqueleto titulo="Comprovantes" />;

  const props = { fila, quando, onFila: receber, onErro: setErro, onAviso: setAviso };
  return (
    <div className={c.tela}>
      <div className={c.topo}>
        <div>
          <h1 className={c.titulo}>Comprovantes a conferir</h1>
          <p className={c.sub}>
            {!fila.instalado ? 'Os comprovantes ainda não foram instalados no banco desta empresa.'
              : fila.total === 0 ? 'Nenhum comprovante esperando conferência.'
              : `${fila.total} comprovante${fila.total > 1 ? 's' : ''} esperando conferência${fila.total > fila.itens.length ? ` (mostrando os ${fila.itens.length} mais novos)` : ''}.`}
          </p>
        </div>
        <button type="button" className={c.botaoSec} onClick={() => void ler()}>Atualizar</button>
      </div>
      {erro && <p className={`${c.aviso} ${c.avisoErro}`} role="alert">{erro}</p>}
      {aviso && <p className={c.aviso} role="status">{aviso}</p>}
      {fila.itens.length > 0 && <ul className={c.lista} data-fila-comprovantes>{fila.itens.map((p) => <Item key={p.id} p={p} {...props} />)}</ul>}
      {fila.marca && fila.faltaBaixar.length > 0 && (
        <section className={c.secao} data-falta-baixar>
          <h2 className={c.secaoTitulo}>Conferidos, falta baixar na {fila.marca} <span>{fila.faltaBaixar.length} · últimos 14 dias</span></h2>
          <ul className={c.lista}>{fila.faltaBaixar.map((p) => <Item key={p.id} p={p} {...props} />)}</ul>
        </section>
      )}
    </div>
  );
}

function Item({ p, fila, quando, onFila, onErro, onAviso }: {
  p: ItemFila; fila: FilaComprovantes; quando: (iso: string | null) => string;
  onFila: (f: FilaComprovantes) => void; onErro: (t: string) => void; onAviso: (t: string) => void;
}) {
  const [salvando, iniciar] = useTransition();
  // A caixa muda na hora; se o servidor recusar, volta ao que está no banco.
  const [marcado, setMarcado] = useState(Boolean(p.baixado_em));
  useEffect(() => { setMarcado(Boolean(p.baixado_em)); }, [p.baixado_em]);
  const estado = p.conferido_em ? 'conferido' : p.analise === 'suspeito' ? 'suspeito' : 'pendente';
  const cartao = p.alerta_atendimento_id ?? p.atendimento_id;
  const agir = (fn: () => ReturnType<typeof conferirNaFila>, ok: string) => iniciar(async () => {
    const r = await fn();
    if (!r.ok) { onErro(r.erro); setMarcado(Boolean(p.baixado_em)); return; }
    onFila(r.dados); onAviso(ok);
  });
  return (
    <li className={c.item} data-estado={estado} data-comprovante={p.id}>
      <div className={c.itemTopo}>
        <strong className={c.valor}>{reais(p.valor)}</strong>
        <span className={c.selo} data-estado={estado}>{estado === 'conferido' ? 'Conferido' : estado === 'suspeito' ? 'Suspeito' : 'A conferir'}</span>
        {fila.marca && p.baixado_em && <span className={c.selo} data-estado="baixado">Baixado na {fila.marca}</span>}
      </div>
      <p className={c.nome}>{nomeBonito(p.contato_nome) || 'Sem nome'}{p.telefone ? <span> · {telefoneBonito(p.telefone)}</span> : null}</p>
      <p className={c.meta}>
        Recebido {quando(p.criado_em)}{p.criado_por ? ` · ${p.criado_por}` : ''}
        {p.pago_em ? ` · pago em ${quando(p.pago_em)}` : ''}{p.forma ? ` · ${FORMA[p.forma] ?? p.forma}` : ''}
        {p.servico ? ` · ${p.servico.tipo}${p.servico.inicio ? ` ${quando(p.servico.inicio)}` : ''}${p.servico.profissional ? ` · ${p.servico.profissional}` : ''}` : ''}
      </p>
      {p.comprovante && (p.comprovante.pagador || p.comprovante.banco) && (
        <p className={c.meta}>{[p.comprovante.pagador && `Pagador: ${p.comprovante.pagador}`, p.comprovante.banco && `Banco: ${p.comprovante.banco}`].filter(Boolean).join(' · ')}</p>
      )}
      {p.analise === 'suspeito' && (
        <ul className={c.motivos}>{(p.analise_motivos.length ? p.analise_motivos : ['A análise não informou o motivo.']).map((m, i) => <li key={i}>{m}</li>)}</ul>
      )}
      {p.conferido_em && <p className={c.meta}>Conferido por {p.conferido_por ?? 'equipe'} em {quando(p.conferido_em)}</p>}
      {fila.marca && p.baixado_em && <p className={c.meta}>Baixado na {fila.marca} por {p.baixado_por ?? 'equipe'} em {quando(p.baixado_em)}</p>}
      <div className={c.acoes}>
        {p.tem_arquivo && <a className={c.botaoSec} href={`/api/painel/pagamentos/${p.id}/arquivo`} target="_blank" rel="noopener noreferrer" data-ver-comprovante>Ver comprovante</a>}
        {p.mensagem_wamid && <Link className={c.botaoSec} href={`/inbox?msg=${encodeURIComponent(p.mensagem_wamid)}`} data-ver-conversa>Ver na conversa</Link>}
        {cartao && <Link className={c.botaoSec} href={`/crm?cartao=${cartao}`} data-abrir-cartao={cartao}>Abrir cartão</Link>}
        {fila.podeConferir && fila.marca && (
          <label className={c.marca}>
            <input type="checkbox" checked={marcado} disabled={salvando} data-baixado={p.id}
              onChange={(e) => { const sim = e.currentTarget.checked; setMarcado(sim); agir(() => marcarBaixadoNaFila(p.id, sim), sim ? `Marcado como baixado na ${fila.marca}.` : 'Marca de baixa retirada.'); }} />
            Baixado na {fila.marca}
          </label>
        )}
        {fila.podeConferir && (p.conferido_em
          ? <button type="button" className={c.botaoSec} disabled={salvando} onClick={() => agir(() => conferirNaFila(p.id, false), 'Conferência desfeita.')}>Desfazer conferência</button>
          : <button type="button" className={c.botaoPri} disabled={salvando} data-conferir={p.id} onClick={() => agir(() => conferirNaFila(p.id, true), 'Comprovante conferido.')}>{salvando ? 'Salvando…' : 'Conferido'}</button>)}
      </div>
    </li>
  );
}
