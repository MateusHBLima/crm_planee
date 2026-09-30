'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { trocarEmpresa } from '@/lib/painel/acoes-gestao';
import g from './gestao/gestao.module.css';

// Escolha da empresa no endereço geral (adm, link de teste). No domínio de uma empresa ela é fixa.
export function TrocarEmpresa({ atual, empresas }: { atual: string | null; empresas: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  return (
    <label className={g.seletorEmpresa}>
      Empresa
      <select id="trocar-empresa" value={atual ?? ''} disabled={ocupado}
        onChange={(e) => { const id = e.target.value; iniciar(async () => { const r = await trocarEmpresa(id); if (r.ok) router.refresh(); }); }}>
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
      </select>
    </label>
  );
}
