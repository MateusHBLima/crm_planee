'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Novidade } from '@/lib/painel/planee';
import { carregarFaixa } from '@/lib/painel/leitura-cliente';
import { Icone } from '@/components/Icone';
import s from './planee.module.css';

// Faixa no topo das telas da empresa: manutenção (sempre visível enquanto durar) e novidades recentes (a pessoa
// fecha e ela não volta neste navegador). Carrega depois da tela, sem atrasar o primeiro desenho.
const CHAVE = 'pp_novidades_vistas';
const vistas = (): string[] => { try { return JSON.parse(localStorage.getItem(CHAVE) ?? '[]'); } catch { return []; } };

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Faixa({ largo }: { largo?: boolean }) {
  const [dados, setDados] = useState<{ manutencoes: Novidade[]; novidades: Novidade[] } | null>(null);
  const [fechadas, setFechadas] = useState<string[]>([]);
  useEffect(() => {
    setFechadas(vistas());
    carregarFaixa().then((r) => { if (r.ok) setDados(r.dados); }).catch(() => undefined);
  }, []);
  if (!dados) return null;
  const novidades = dados.novidades.filter((n) => !fechadas.includes(n.id));
  if (!dados.manutencoes.length && !novidades.length) return null;
  const fechar = (id: string) => {
    const l = [...fechadas, id].slice(-50);
    setFechadas(l);
    try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch { /* navegador sem armazenamento: só some agora */ }
  };
  return (
    <div className={`${s.faixas} ${largo ? s.faixaLarga : ''}`} aria-label="Avisos da Planee">
      {dados.manutencoes.map((n) => {
        const futura = new Date(n.inicio).getTime() > Date.now();
        return (
          <div key={n.id} className={s.faixa} data-tipo="manutencao" role="status">
            <span className={s.faixaTexto}>
              <strong>{futura ? 'Manutenção programada' : 'Manutenção em andamento'}: {n.titulo}</strong>
              {' '}({futura ? `a partir de ${quando(n.inicio)}` : 'desde ' + quando(n.inicio)}{n.fim ? `, até ${quando(n.fim)}` : ''}). {n.texto}
            </span>
          </div>
        );
      })}
      {novidades.map((n) => (
        <div key={n.id} className={s.faixa} data-tipo="novidade">
          <span className={s.faixaTexto}><strong>Novidade: {n.titulo}</strong></span>
          <Link href="/planee">Ver</Link>
          <button type="button" aria-label={`Fechar a novidade ${n.titulo}`} onClick={() => fechar(n.id)}><Icone nome="fechar" tamanho={14} /></button>
        </div>
      ))}
    </div>
  );
}
