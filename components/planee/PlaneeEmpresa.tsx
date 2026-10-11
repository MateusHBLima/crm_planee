'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MeuAviso } from '@/lib/painel/avisos';
import type { Novidade } from '@/lib/painel/planee';
import { carregarPlaneeDaEmpresa } from '@/lib/painel/leitura-cliente';
import { AvisarPlanee } from './AvisarPlanee';
import s from './planee.module.css';

const ESTADO: Record<string, string> = { aberto: 'Aberto', em_analise: 'Em análise', resolvido: 'Resolvido' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

// Tela "Planee" da empresa: os avisos que a equipe mandou (com a resposta da Planee), novidades e manutenções.
export function PlaneeEmpresa({ empresa, semAcesso = false }: { empresa: string; semAcesso?: boolean }) {
  const [dados, setDados] = useState<{ avisos: MeuAviso[]; novidades: Novidade[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const carregar = useCallback(() => {
    carregarPlaneeDaEmpresa().then((r) => {
      if (r.ok) { setDados(r.dados); setErro(null); }
      else if (r.sair) window.location.href = '/entrar?motivo=sessao&volta=/planee';
      else setErro(r.erro);
    });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (!ok) return; const t = window.setTimeout(() => setOk(null), 3500); return () => window.clearTimeout(t); }, [ok]);

  return (
    <div className={s.tela}>
      <header className={s.topo}>
        <div className={s.titulos}>
          <p className={s.rotulo}>{empresa}</p>
          <h1 className={s.titulo}>Planee</h1>
          <p className={s.sub}>
            Avise a Planee quando a Sara errar ou algo não funcionar. Na Inbox, use o menu ⋯ da mensagem para o aviso ir junto com a conversa.
            A resposta da Planee aparece aqui.
          </p>
        </div>
        <button type="button" className={s.botao} onClick={() => setNovo(true)}>Novo aviso</button>
      </header>

      {semAcesso && (
        <div className={s.vazio} role="status" data-sem-acesso>
          Seu acesso ao painel da {empresa} foi criado. O admin vai liberar as telas que você vai usar; quando ele liberar,
          elas aparecem no menu (se não aparecerem, recarregue a página).
        </div>
      )}

      {erro && <div className={s.vazio} role="alert">{erro}</div>}
      {!dados && !erro && <div className={s.vazio}>Carregando…</div>}

      {dados && (
        <>
          <section className={s.secao} aria-labelledby="t-avisos">
            <h2 id="t-avisos" className={s.secaoTitulo}>Seus avisos</h2>
            {!dados.avisos.length ? <div className={s.vazio}>Nenhum aviso enviado ainda.</div> : (
              <ul className={s.lista}>
                {dados.avisos.map((a) => (
                  <li key={a.id} className={s.item} data-aviso={a.id}>
                    <div className={s.itemLinha}>
                      <span className={s.selo} data-estado={a.estado}>{ESTADO[a.estado]}</span>
                      <span className={s.itemTitulo}>{a.titulo}</span>
                      <span className={s.espaco} />
                      <span className={s.itemMeta}>{a.criado_por ? `${a.criado_por} · ` : ''}{dataHora(a.criado_em)}</span>
                    </div>
                    {a.comentario && <p className={s.comentario}>{a.comentario}</p>}
                    {a.resposta && (
                      <div className={s.resposta}>
                        <strong>Resposta da Planee{a.respondido_por ? ` · ${a.respondido_por}` : ''}{a.respondido_em ? ` · ${dataHora(a.respondido_em)}` : ''}</strong>
                        <p>{a.resposta}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={s.secao} aria-labelledby="t-novidades">
            <h2 id="t-novidades" className={s.secaoTitulo}>Novidades e manutenção</h2>
            {!dados.novidades.length ? <div className={s.vazio}>Nada novo por enquanto.</div> : (
              <ul className={s.lista}>
                {dados.novidades.map((n) => (
                  <li key={n.id} className={s.item}>
                    <div className={s.itemLinha}>
                      <span className={s.selo} data-tipo={n.tipo}>{n.tipo === 'manutencao' ? 'Manutenção' : 'Novidade'}</span>
                      <span className={s.itemTitulo}>{n.titulo}</span>
                      <span className={s.espaco} />
                      <span className={s.itemMeta}>{dataHora(n.inicio)}{n.fim ? ` até ${dataHora(n.fim)}` : ''}</span>
                    </div>
                    <p className={s.comentario}>{n.texto}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {novo && <AvisarPlanee onFechar={() => setNovo(false)} onPronto={() => { setNovo(false); setOk('Aviso enviado para a Planee.'); carregar(); }} />}
      {ok && <div className={s.toast} data-tipo="ok" role="status">{ok}</div>}
    </div>
  );
}
