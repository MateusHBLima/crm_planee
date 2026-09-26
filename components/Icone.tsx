import { ICONES } from '@/lib/telas';

export function Icone({ nome, tamanho = 18 }: { nome: string; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONES[nome] ?? ''} />
    </svg>
  );
}
