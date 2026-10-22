'use client';

import { useEffect, useState } from 'react';
import { carregarComprovantes } from '@/lib/painel/leitura-cliente';

// Contador do menu (22/10): quantos comprovantes esperam conferência, em todas as telas. Lê só o total a cada minuto
// (com a aba visível); a tela Comprovantes avisa na hora quando o total muda (evento abaixo). Zero: o contador some.

const EVENTO = 'painel:comprovantes-total';
const ATUALIZA_MS = 60_000;

export function avisarTotalComprovantes(total: number) {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: total }));
}

export function ContadorComprovantes({ classe }: { classe?: string }) {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      const r = await carregarComprovantes(true);
      if (vivo && r.ok) setTotal(r.dados.total);
    };
    const t0 = window.setTimeout(() => void ler(), 800);
    const t = window.setInterval(() => { if (!document.hidden) void ler(); }, ATUALIZA_MS);
    const ouvir = (e: Event) => setTotal(Number((e as CustomEvent).detail) || 0);
    window.addEventListener(EVENTO, ouvir);
    return () => { vivo = false; window.clearTimeout(t0); window.clearInterval(t); window.removeEventListener(EVENTO, ouvir); };
  }, []);
  if (!total) return null;
  return <span className={classe} data-contador-comprovantes={total} aria-label={`${total} a conferir`}>{total > 99 ? '99+' : total}</span>;
}
