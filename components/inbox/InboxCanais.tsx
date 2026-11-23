'use client';

import { useEffect, useState } from 'react';
import type { ContaRede } from '@/lib/painel/redes';
import { carregarContasRede } from '@/lib/painel/leitura-cliente';
import { InboxTela } from './InboxTela';
import { InboxRede, NOME_REDE } from './InboxRede';
import type { PropsInbox } from './Inbox';
import c from './inbox.module.css';

// Inbox com seletor de canal (23/11): WhatsApp ▾ Instagram... O seletor só aparece para quem tem redes.ver e quando
// a empresa tem conta de rede social conectada; a secretária (só inbox.ver) continua vendo a Inbox de sempre.
// A escolha fica guardada nesta aba (sessionStorage), por empresa.

const WHATS = 'whatsapp';
const lerEscolha = (k: string) => { try { return window.sessionStorage.getItem(k); } catch { return null; } };
const guardarEscolha = (k: string, v: string) => { try { window.sessionStorage.setItem(k, v); } catch { /* aba sem storage */ } };

type Props = Omit<PropsInbox, 'inicial' | 'empresaId' | 'seletor'> & {
  empresaId: string; verWhats: boolean; verRedes: boolean; podeResponderRedes: boolean;
};

export function InboxCanais({ empresaId, verWhats, verRedes, podeResponderRedes, ...props }: Props) {
  const memoria = `inbox:canal:${empresaId}`;
  const [contas, setContas] = useState<ContaRede[] | null>(verRedes ? null : []);
  const [canal, setCanal] = useState<string>(WHATS);

  useEffect(() => {
    if (!verRedes) return;
    let vivo = true;
    const carregar = async () => {
      const r = await carregarContasRede();
      if (!vivo || !r.ok) return;
      setContas(r.dados);
      setCanal((atual) => {
        const lembrado = atual === WHATS ? lerEscolha(memoria) : atual;
        if (lembrado && r.dados.some((x) => x.id === lembrado)) return lembrado;
        return verWhats ? WHATS : r.dados[0]?.id ?? WHATS;
      });
    };
    carregar();
    const i = window.setInterval(carregar, 30000);
    return () => { vivo = false; window.clearInterval(i); };
  }, [verRedes, verWhats, memoria]);

  const lista = contas ?? [];
  const escolher = (v: string) => { setCanal(v); guardarEscolha(memoria, v); };
  const seletor = lista.length ? (
    <select className={c.seletorCanal} value={canal} onChange={(e) => escolher(e.target.value)} aria-label="Canal da Inbox" data-seletor-canal>
      {verWhats && <option value={WHATS}>WhatsApp</option>}
      {lista.map((x) => (
        <option key={x.id} value={x.id}>
          {NOME_REDE[x.rede] ?? x.rede}{x.usuario ? ` · @${x.usuario}` : ''}{x.nao_lidas ? ` (${x.nao_lidas})` : ''}
        </option>
      ))}
    </select>
  ) : undefined;

  if (canal !== WHATS && lista.some((x) => x.id === canal)) {
    return <InboxRede key={canal} conta={canal} podeResponder={podeResponderRedes} seletor={seletor} mascarado={props.mascarado} />;
  }
  if (!verWhats) {
    // Só redes sociais: espera as contas; sem nenhuma conectada, avisa.
    return contas === null ? <div className={c.vazio}>Carregando…</div>
      : <div className={c.vazio}>Nenhuma rede social conectada nesta empresa ainda.</div>;
  }
  return <InboxTela empresaId={empresaId} {...props} seletor={seletor} />;
}
