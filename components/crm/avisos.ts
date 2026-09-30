'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Quadro } from '@/lib/painel/crm';

// Avisos de atendimento novo em "aguardando": som curto, notificação do navegador (com a aba escondida)
// e contagem no título da aba. A escolha fica só neste navegador (localStorage, com try/catch).

const CHAVE = 'pp_avisos_crm';

function lerPreferencia(): boolean {
  try { return window.localStorage.getItem(CHAVE) === '1'; } catch { return false; }
}
function gravarPreferencia(v: boolean) {
  try { window.localStorage.setItem(CHAVE, v ? '1' : '0'); } catch { /* navegador sem armazenamento: vale só nesta visita */ }
}

function tocar(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    for (const [inicio, freq] of [[0, 880], [0.18, 1175]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + inicio);
      g.gain.exponentialRampToValueAtTime(0.18, t + inicio + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + inicio + 0.16);
      osc.connect(g).connect(ctx.destination);
      osc.start(t + inicio); osc.stop(t + inicio + 0.17);
    }
  } catch { /* sem som: a notificação e o título continuam */ }
}

export function useAvisos(quadro: Quadro) {
  const [ligado, setLigado] = useState(false);
  const [suportado, setSuportado] = useState(false);
  const vistos = useRef<Set<string> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const novosEscondido = useRef(0);
  const tituloBase = useRef('');

  useEffect(() => {
    setSuportado(typeof window !== 'undefined' && ('AudioContext' in window || 'Notification' in window));
    setLigado(lerPreferencia());
    tituloBase.current = document.title.replace(/^\(\d+\)\s*/, '');
    const vis = () => { if (!document.hidden) { novosEscondido.current = 0; document.title = tituloBase.current; } };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); document.title = tituloBase.current; };
  }, []);

  // Compara com os cartões já vistos. A primeira leitura só registra (não avisa o que já estava lá).
  useEffect(() => {
    const aguardando = quadro.cartoes.filter((k) => k.etapa === 'aguardando' && !k.sombra).map((k) => k.id);
    if (!vistos.current) { vistos.current = new Set(aguardando); return; }
    const novos = aguardando.filter((id) => !vistos.current!.has(id));
    for (const id of aguardando) vistos.current.add(id);
    if (!novos.length || !ligado) return;
    tocar(audio.current);
    if (document.hidden) {
      novosEscondido.current += novos.length;
      document.title = `(${novosEscondido.current}) ${tituloBase.current}`;
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const k = quadro.cartoes.find((x) => x.id === novos[0]);
          new Notification(novos.length === 1 ? 'Atendimento novo aguardando' : `${novos.length} atendimentos novos aguardando`, {
            body: k ? `${k.nome || 'Contato sem nome'}: ${k.resumo.slice(0, 120)}` : undefined, tag: 'painel-crm',
          });
        }
      } catch { /* notificação bloqueada: o som e o título bastam */ }
    }
  }, [quadro, ligado]);

  const alternar = useCallback(() => {
    const v = !ligado;
    setLigado(v);
    gravarPreferencia(v);
    if (!v) return;
    // O navegador só libera som e notificação depois de um clique: aproveitamos este.
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audio.current) audio.current = new Ctx();
      void audio.current?.resume();
      tocar(audio.current);
    } catch { /* sem som */ }
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* sem notificação */ }
  }, [ligado]);

  // Preferência salva como ligada: o som volta no primeiro clique em qualquer lugar da página.
  useEffect(() => {
    if (!ligado || audio.current) return;
    const primeiro = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx && !audio.current) audio.current = new Ctx();
        void audio.current?.resume();
      } catch { /* sem som */ }
    };
    document.addEventListener('pointerdown', primeiro, { once: true });
    return () => document.removeEventListener('pointerdown', primeiro);
  }, [ligado]);

  return { ligado, suportado, alternar };
}
