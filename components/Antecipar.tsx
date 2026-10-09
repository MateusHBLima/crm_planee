'use client';

import { useEffect } from 'react';
import { carregarConversas, carregarQuadro } from '@/lib/painel/leitura-cliente';
import { buscarUmaVez, lembrado } from '@/lib/painel/memoria-cliente';

// Leitura antecipada das telas principais (09/10): logo depois que a tela atual abre, busca em segundo plano a lista
// da Inbox e o quadro do CRM (só os que a pessoa pode ver e que ainda não estão na memória da aba). Trocar de tela
// pelo menu passa a mostrar os dados na hora. Uma leitura de cada por página carregada.
export function Antecipar({ empresaId, telas }: { empresaId: string; telas: string[] }) {
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.hidden) return;
      if (telas.includes('inbox') && !lembrado(`${empresaId}:conversas`)) void buscarUmaVez(`${empresaId}:conversas`, () => carregarConversas());
      if (telas.includes('crm') && !lembrado(`${empresaId}:quadro`)) void buscarUmaVez(`${empresaId}:quadro`, () => carregarQuadro());
    }, 1200);
    return () => window.clearTimeout(t);
  }, [empresaId, telas]);
  return null;
}
