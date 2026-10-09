'use client';

import { useEffect, useState } from 'react';
import type { ListaConversas } from '@/lib/painel/inbox';
import { carregarConversas } from '@/lib/painel/leitura-cliente';
import { buscarUmaVez, lembrado } from '@/lib/painel/memoria-cliente';
import { Esqueleto, ErroDaTela } from '@/components/Esqueleto';
import { Inbox, type PropsInbox } from './Inbox';

// A Inbox abre sem esperar o banco (09/10): a última lista guardada nesta aba (se houver) ou o esqueleto, e a lista
// atual chega pela leitura GET. A própria Inbox atualiza a lista a cada 10 s.
export function InboxTela({ empresaId, ...props }: Omit<PropsInbox, 'inicial' | 'empresaId'> & { empresaId: string }) {
  const [lista, setLista] = useState<ListaConversas | null>(() => lembrado<ListaConversas>(`${empresaId}:conversas`) ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [daMemoria] = useState(() => lista !== null);
  useEffect(() => {
    let vivo = true;
    const tentar = async (vez: number) => {
      const r = await buscarUmaVez(`${empresaId}:conversas`, () => carregarConversas());
      if (!vivo) return;
      if (r.ok) { setLista(r.dados); return; }
      if (r.sair) { window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`; return; }
      setErro(r.erro);
      if (vez < 5) window.setTimeout(() => { if (vivo) tentar(vez + 1); }, 4000);
    };
    // Com a lista da memória, a própria Inbox busca a atual (key muda quando a lista nova chega).
    if (!daMemoria) tentar(1);
    return () => { vivo = false; };
  }, [daMemoria]);
  if (!lista) return erro ? <ErroDaTela titulo="Inbox" texto={erro} /> : <Esqueleto titulo="Inbox" />;
  return <Inbox {...props} empresaId={empresaId} inicial={lista} />;
}
