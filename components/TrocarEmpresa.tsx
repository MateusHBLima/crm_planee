'use client';

import { useTransition } from 'react';
import { trocarEmpresa } from '@/lib/painel/acoes-gestao';
import g from './gestao/gestao.module.css';

// Seletor de empresa no endereço geral (adm, link de teste). No domínio de uma empresa ela é fixa.
// O master tem também a "Planee — visão geral", fora de qualquer empresa.
// Depois de trocar, volta ao início: ele abre a primeira tela que a pessoa tem naquela empresa.
export function TrocarEmpresa({ atual, empresas, master }: { atual: string | null; empresas: { id: string; nome: string }[]; master: boolean }) {
  const [ocupado, iniciar] = useTransition();
  return (
    <label className={g.seletorEmpresa}>
      {master ? 'Ver empresa' : 'Empresa'}
      <select id="trocar-empresa" value={atual ?? ''} disabled={ocupado}
        onChange={(e) => {
          const id = e.target.value;
          iniciar(async () => { const r = await trocarEmpresa(id); if (r.ok) window.location.assign('/'); });
        }}>
        {master && <option value="">Planee — visão geral</option>}
        {master && empresas.length > 0 && <option disabled>──────────</option>}
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
      </select>
    </label>
  );
}
