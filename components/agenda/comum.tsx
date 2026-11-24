'use client';

import { useEffect } from 'react';
import c from './propria.module.css';

// ---- Datas no fuso da empresa ----
export type Partes = { dia: string; hora: number; minuto: number; dow: number };
export function partes(iso: string | number | Date, fuso: string): Partes {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), minuto: Number(p.minute), dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// Data e hora locais da empresa -> ISO (acerta o fuso pela diferença no próprio dia).
export function isoDe(dia: string, hora: string, fuso: string): string {
  const palpite = Date.parse(`${dia}T${hora}:00Z`);
  const p = partes(palpite, fuso);
  const comoLocal = Date.parse(`${p.dia}T${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}:00Z`);
  return new Date(palpite - (comoLocal - palpite)).toISOString();
}

export function Painel({ titulo, onFechar, largo, children }: { titulo: string; onFechar: () => void; largo?: boolean; children: React.ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onFechar]);
  return (
    <>
      <div className={c.fundo} onClick={onFechar} />
      <aside className={`${c.painel} ${largo ? c.painelLargo : ''}`} role="dialog" aria-label={titulo}>
        <div className={c.painelTopo}><h2>{titulo}</h2><button type="button" className={c.fechar} onClick={onFechar} aria-label="Fechar">✕</button></div>
        <div className={c.painelCorpo}>{children}</div>
      </aside>
    </>
  );
}
