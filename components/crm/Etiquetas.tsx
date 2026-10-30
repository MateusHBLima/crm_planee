'use client';

import { useState } from 'react';
import type { Cartao, Quadro as TQuadro } from '@/lib/painel/crm';
import { corDaEtiqueta, type Etiqueta } from '@/lib/etiquetas';
import { Icone } from '@/components/Icone';
import c from './crm.module.css';

// Etiquetas do cartão (migração 032, 30/10). Com pelo menos uma etiqueta cadastrada na empresa, o cartão troca
// Finalizar/Passar pelo botão "Etiqueta": abre as etiquetas com as cores e clicar numa põe ou tira (e, se ela tiver
// coluna de destino, o cartão vai para lá). Empresa sem etiqueta não vê nada disto.

export const temEtiquetas = (q: TQuadro) => (q.etiquetas?.length ?? 0) > 0;

export function ChipsEtiquetas({ ids, etiquetas }: { ids: string[]; etiquetas: Etiqueta[] }) {
  const mapa = new Map((etiquetas ?? []).map((e) => [e.id, e]));
  const lista = ids.map((id) => mapa.get(id)).filter((e): e is Etiqueta => Boolean(e));
  if (!lista.length) return null;
  return (
    <div className={c.etiquetas} data-etiquetas>
      {lista.map((e) => {
        const cor = corDaEtiqueta(e.cor);
        return <span key={e.id} className={c.etiqueta} style={{ background: cor.fundo, color: cor.texto }} data-etiqueta={e.id}>{e.nome}</span>;
      })}
    </div>
  );
}

// Lista das etiquetas para escolher: as que aparecem no botão e as que o cartão já tem (para dar para tirar).
function Escolher({ k, etiquetas, ocupado, onEscolher }: { k: Cartao; etiquetas: Etiqueta[]; ocupado: boolean; onEscolher: (e: Etiqueta) => void }) {
  const lista = etiquetas.filter((e) => e.mostrar || (k.etiquetas ?? []).includes(e.id));
  return (
    <div className={c.escolherEtiquetas} role="group" aria-label="Etiquetas">
      {lista.map((e) => {
        const cor = corDaEtiqueta(e.cor);
        const tem = (k.etiquetas ?? []).includes(e.id);
        return (
          <button key={e.id} type="button" className={c.etiquetaBotao} style={{ background: cor.fundo, color: cor.texto }} disabled={ocupado}
            aria-pressed={tem} data-escolher-etiqueta={e.id} onClick={() => onEscolher(e)} title={tem ? 'Tirar a etiqueta' : 'Pôr a etiqueta'}>
            <span>{e.nome}</span>{tem && <Icone nome="finalizado" tamanho={13} />}
          </button>
        );
      })}
    </div>
  );
}

// No cartão do quadro: um botão que abre a lista; escolher fecha.
export function BotaoEtiqueta({ k, quadro, ocupado, onEtiqueta }: { k: Cartao; quadro: TQuadro; ocupado: boolean; onEtiqueta: (id: string, etiqueta: string) => void }) {
  const [aberto, setAberto] = useState(false);
  if (k.sombra) return null;
  return (
    <div className={c.acoesEtiqueta}>
      <button type="button" className={c.acaoSec} disabled={ocupado} aria-expanded={aberto} data-botao-etiqueta onClick={() => setAberto((x) => !x)}>
        <Icone nome="etiqueta" tamanho={13} /> Etiqueta
      </button>
      {aberto && <Escolher k={k} etiquetas={quadro.etiquetas} ocupado={ocupado} onEscolher={(e) => { setAberto(false); onEtiqueta(k.id, e.id); }} />}
    </div>
  );
}

// No detalhe do cartão: a lista fica sempre aberta.
export function EtiquetasDoDetalhe({ k, quadro, ocupado, podeEditar, onEtiqueta }: { k: Cartao; quadro: TQuadro; ocupado: boolean; podeEditar: boolean; onEtiqueta: (id: string, etiqueta: string) => void }) {
  if (!podeEditar || k.sombra) return <ChipsEtiquetas ids={k.etiquetas ?? []} etiquetas={quadro.etiquetas} />;
  return <Escolher k={k} etiquetas={quadro.etiquetas} ocupado={ocupado} onEscolher={(e) => onEtiqueta(k.id, e.id)} />;
}

// O que o clique faz, aplicado na tela antes da resposta do servidor (a mesma regra de lib/painel/crm.ts etiquetar).
export function aplicarEtiqueta(q: TQuadro, k: Cartao, etiqueta: string): { cartao: Cartao; tirou: boolean; foiPara: string | null } {
  const e = q.etiquetas.find((x) => x.id === etiqueta);
  const tirou = (k.etiquetas ?? []).includes(etiqueta);
  const etiquetas = tirou ? (k.etiquetas ?? []).filter((x) => x !== etiqueta) : [...(k.etiquetas ?? []), etiqueta];
  const destino = !tirou && e?.topico_destino && e.topico_destino !== k.topico_id
    && (!e.mover_de.length || (k.topico_id !== null && e.mover_de.includes(k.topico_id)))
    && q.topicos.some((t) => t.id === e.topico_destino) ? e.topico_destino : null;
  return { cartao: { ...k, etiquetas, topico_id: destino ?? k.topico_id }, tirou, foiPara: destino ? q.topicos.find((t) => t.id === destino)?.nome ?? null : null };
}
