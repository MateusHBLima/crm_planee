'use client';

import { useEffect, useState } from 'react';
import type { Quadro as TQuadro } from '@/lib/painel/crm';
import { carregarQuadro } from '@/lib/painel/leitura-cliente';
import { buscarUmaVez, lembrado } from '@/lib/painel/memoria-cliente';
import { Esqueleto, ErroDaTela } from '@/components/Esqueleto';
import { Crm, type PropsCrm } from './Crm';

// A tela do CRM abre sem esperar o banco (09/10): mostra o último quadro guardado nesta aba (se houver) ou o
// esqueleto, e busca o quadro atual pela leitura GET. Antes, cada ida ao CRM esperava o quadro inteiro no servidor.
export function CrmTela({ empresaId, ...props }: Omit<PropsCrm, 'inicial' | 'memoria'> & { empresaId: string }) {
  const memoria = `${empresaId}:quadro`;
  const [quadro, setQuadro] = useState<TQuadro | null>(() => lembrado<TQuadro>(memoria) ?? null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (quadro) return;
    let vivo = true;
    const tentar = async (vez: number) => {
      const r = await buscarUmaVez(memoria, () => carregarQuadro());
      if (!vivo) return;
      if (r.ok) { setQuadro(r.dados); return; }
      if (r.sair) { window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`; return; }
      setErro(r.erro);
      if (vez < 5) window.setTimeout(() => { if (vivo) tentar(vez + 1); }, 4000);
    };
    tentar(1);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!quadro) return erro ? <ErroDaTela titulo="CRM" texto={erro} /> : <Esqueleto titulo="CRM" />;
  return <Crm {...props} inicial={quadro} memoria={memoria} />;
}
