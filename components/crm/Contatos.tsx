'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Cartao, Quadro as TQuadro } from '@/lib/painel/crm';
import { carregarAtendimentosDoContato, carregarContatos } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { EtapaPill } from './Quadro';
import { casaBusca, cpfBonito, criarFormatos, linkWhatsApp, telefoneBonito } from './util';
import c from './crm.module.css';

type Contato = { id: string; nome: string | null; telefone: string | null; documento: string | null; abertos: number; total: number; ultimo: string | null };

export function Contatos({ busca, quadro, onAbrir }: { busca: string; quadro: TQuadro; onAbrir: (atendimentoId: string) => void }) {
  const [lista, setLista] = useState<Contato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [atends, setAtends] = useState<Cartao[] | null>(null);
  const fmt = useMemo(() => criarFormatos(quadro.fuso), [quadro.fuso]);

  useEffect(() => { carregarContatos().then((r) => (r.ok ? setLista(r.dados) : setErro(r.erro))); }, []);
  useEffect(() => {
    if (!sel) return;
    setAtends(null);
    carregarAtendimentosDoContato(sel).then((r) => (r.ok ? setAtends(r.dados) : setErro(r.erro)));
  }, [sel]);

  if (erro) return <div className={c.vazioTela}>{erro}</div>;
  if (!lista) return <div className={c.vazioTela}>Carregando os contatos…</div>;
  const vis = lista.filter((k) => casaBusca(busca, [k.nome, k.telefone, k.documento]));
  const atual = lista.find((k) => k.id === sel) ?? null;
  const topNome = Object.fromEntries(quadro.topicos.map((t) => [t.id, t.nome]));

  return (
    <div className={c.contatos}>
      <section className={c.listaContatos} aria-label="Lista de contatos">
        {!vis.length && <div className={c.nadaAberto}>Nenhum contato com essa busca</div>}
        {vis.map((k) => (
          <button key={k.id} type="button" className={c.itemContato} aria-current={k.id === sel ? 'true' : undefined} onClick={() => setSel(k.id)}>
            <span className={c.avatarPeq} aria-hidden="true">{(k.nome || '#').trim().slice(0, 1).toUpperCase()}</span>
            <span className={c.itemContatoTexto}>
              <span className={c.itemContatoNome}>{k.nome || 'Contato sem nome'}</span>
              <span className={c.mono + ' ' + c.detMeta}>{telefoneBonito(k.telefone)}</span>
            </span>
            <span className={c.detMeta}>{k.abertos ? `${k.abertos} aberto${k.abertos > 1 ? 's' : ''}` : k.total ? `${k.total} no histórico` : 'sem atendimento'}</span>
          </button>
        ))}
      </section>
      <section className={c.fichaContato} aria-label="Ficha do contato">
        {!atual ? <div className={c.nadaAberto}>Escolha um contato para ver os atendimentos dele.</div> : (
          <>
            <h2 className={c.fichaNome}>{atual.nome || 'Contato sem nome'}</h2>
            <div className={c.detLinhas}>
              <div className={c.detLinha}><span className={c.metaRot}>Telefone</span><span className={c.mono}>{telefoneBonito(atual.telefone)}</span>
                {linkWhatsApp(atual.telefone) && <a className={c.linkBotao} href={linkWhatsApp(atual.telefone)!} target="_blank" rel="noreferrer"><Icone nome="conversa" tamanho={13} /> Abrir no WhatsApp</a>}</div>
              {atual.documento && <div className={c.detLinha}><span className={c.metaRot}>CPF</span><span className={c.mono}>{cpfBonito(atual.documento)}</span></div>}
            </div>
            <h3 className={c.rotuloSec}>Atendimentos</h3>
            {atends === null ? <p className={c.detMeta}>Carregando…</p> : !atends.length ? <p className={c.detMeta}>Nenhum atendimento.</p> : (
              <ul className={c.listaAtend}>
                {atends.map((a) => (
                  <li key={a.id}>
                    <button type="button" className={c.itemAtend} onClick={() => onAbrir(a.id)} disabled={a.etapa === 'finalizado' && !quadro.cartoes.some((x) => x.id === a.id)}>
                      <EtapaPill etapa={a.etapa} nome={quadro.etapas[a.etapa]} />
                      <span className={c.itemAtendTexto}><strong>{a.topico_id ? topNome[a.topico_id] ?? 'Sem assunto' : 'Sem assunto'}</strong> · {a.resumo}</span>
                      <span className={c.detMeta}>{fmt.quando(a.aberto_em)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
