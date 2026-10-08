'use client';

import { useState } from 'react';
import { criarAviso } from '@/lib/painel/acoes-planee';
import { Campo, Janela, useEnvio } from '@/components/crm/Formularios';
import c from '@/components/crm/crm.module.css';
import s from './planee.module.css';

// Tipos que a equipe escolhe (mesma lista de lib/painel/avisos.ts: TIPOS_EQUIPE).
export const TIPOS_AVISO: { id: string; nome: string; dica: string }[] = [
  { id: 'sara_errou', nome: 'A Sara errou', dica: 'Resposta errada, fora do tom, prometeu o que não devia.' },
  { id: 'info_errada', nome: 'Informação errada', dica: 'Preço, horário, endereço, convênio ou outra informação desatualizada.' },
  { id: 'problema_tecnico', nome: 'Problema técnico', dica: 'Mensagem que não chegou, tela com erro, algo travado.' },
  { id: 'sugestao', nome: 'Sugestão', dica: 'Algo que a Sara ou o painel poderiam fazer melhor.' },
  { id: 'outro', nome: 'Outro', dica: '' },
];

export type AlvoAviso = { numero_id: string; wa_id: string; wamid: string; trecho: string | null; autor: string };

// "Avisar a Planee": tipo + comentário. Vindo de uma mensagem da Inbox, o aviso fica ligado a ela (conversa e empresa).
export function AvisarPlanee({ alvo, onFechar, onPronto }: { alvo?: AlvoAviso | null; onFechar: () => void; onPronto: () => void }) {
  const [tipo, setTipo] = useState(alvo?.autor === 'Sara' ? 'sara_errou' : '');
  const [comentario, setComentario] = useState('');
  const { erro, enviando, enviar } = useEnvio<string>();
  const dica = TIPOS_AVISO.find((t) => t.id === tipo)?.dica;
  return (
    <Janela titulo="Avisar a Planee" onFechar={onFechar}>
      <form className={c.formJanela} onSubmit={(e) => {
        e.preventDefault();
        enviar(() => criarAviso({ tipo, comentario, numero_id: alvo?.numero_id, wa_id: alvo?.wa_id, wamid: alvo?.wamid, trecho: alvo?.trecho }), onPronto);
      }}>
        {alvo && (
          <div className={s.bloco}>
            <p className={s.blocoTitulo}>Mensagem ({alvo.autor})</p>
            <p className={s.trecho}>{alvo.trecho || 'Mensagem sem texto'}</p>
          </div>
        )}
        <Campo id="aviso-tipo" rotulo="O que aconteceu" dica={dica || undefined}>
          <select id="aviso-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} required>
            <option value="" disabled>Escolha</option>
            {TIPOS_AVISO.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        <Campo id="aviso-comentario" rotulo="Comentário" dica="Conte o que estava errado e o que devia ter acontecido. A Planee responde por aqui.">
          <textarea id="aviso-comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={2000} rows={5} required minLength={3} />
        </Campo>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}>
          <button type="button" className={c.acaoSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando || !tipo || comentario.trim().length < 3}>{enviando ? 'Enviando…' : 'Enviar para a Planee'}</button>
        </div>
      </form>
    </Janela>
  );
}
