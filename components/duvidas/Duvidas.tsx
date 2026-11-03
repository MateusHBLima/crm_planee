'use client';

import { useEffect, useRef, useState } from 'react';
import type { Duvida } from '@/lib/painel/duvidas';
import { perguntarDuvida } from '@/lib/painel/acoes-duvidas';
import s from './duvidas.module.css';

const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

// Aba Dúvidas (módulo duvidas): a pessoa pergunta, o agente da empresa responde. Cada um vê só as suas perguntas.
// Enter envia; Shift+Enter quebra a linha.
export function Duvidas({ empresa, inicial, valores }: { empresa: string; inicial: Duvida[]; valores: boolean }) {
  const [lista, setLista] = useState<Duvida[]>(inicial);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }); }, [lista.length, enviando]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(t); setErro(null); setTexto('');
    const r = await perguntarDuvida(t);
    setEnviando(null);
    if (r.ok) setLista((l) => [...l, r.dados]);
    else if (r.sair) window.location.href = '/entrar?motivo=sessao&volta=/duvidas';
    else { setErro(r.erro); setTexto(t); }
  }

  return (
    <div className={s.tela}>
      <header>
        <p className={s.rotulo}>{empresa}</p>
        <h1 className={s.titulo}>Dúvidas</h1>
        <p className={s.sub}>
          Pergunte sobre os sistemas da {empresa}. As respostas vêm do agente da empresa e cada pessoa vê só as próprias perguntas.
          {!valores && ' Valores e preços não aparecem para o seu acesso.'}
        </p>
      </header>

      <div className={s.lista} data-duvidas-lista>
        {!lista.length && !enviando && <div className={s.vazio}>Nenhuma pergunta ainda. Escreva a primeira aqui embaixo.</div>}
        {lista.map((d) => (
          <div key={d.id} className={s.par} data-duvida={d.id}>
            <div className={s.pergunta} data-pergunta>
              <div className={s.texto}>{d.pergunta}</div>
              <div className={s.hora}>{hora(d.criado_em)}</div>
            </div>
            <div className={d.erro ? s.respostaErro : s.resposta} data-resposta data-erro={d.erro ?? undefined}>
              <div className={s.texto}>{d.resposta ?? 'Sem resposta.'}</div>
              {d.respondido_em && <div className={s.hora}>{hora(d.respondido_em)}</div>}
            </div>
          </div>
        ))}
        {enviando && (
          <div className={s.par}>
            <div className={s.pergunta}><div className={s.texto}>{enviando}</div></div>
            <div className={s.resposta} data-pensando><div className={s.pensando}>Procurando a resposta…</div></div>
          </div>
        )}
        <div ref={fim} />
      </div>

      <form className={s.envio} onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        {erro && <div className={s.erro} role="alert" data-duvida-erro>{erro}</div>}
        <div className={s.linha}>
          <textarea className={s.campo} data-duvida-texto value={texto} rows={2} maxLength={2000} placeholder="Escreva a sua dúvida. Enter envia; Shift+Enter quebra a linha."
            onChange={(e) => setTexto(e.target.value)} disabled={Boolean(enviando)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(); } }} />
          <button type="submit" className={s.botao} data-duvida-enviar disabled={!texto.trim() || Boolean(enviando)}>Enviar</button>
        </div>
      </form>
    </div>
  );
}
