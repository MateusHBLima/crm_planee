'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import type { Cartao, Quadro as TQuadro } from '@/lib/painel/crm';
import { anotarNoContato, carregarAtendimentosDoContato, carregarContatos, carregarNotasDoContato } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { EtapaPill } from './Quadro';
import { FormContato, NovoAtendimento } from './Formularios';
import { HistoricoPaciente } from './Historico';
import { casaBusca, cpfBonito, criarFormatos, linkWhatsApp, telefoneBonito } from './util';
import c from './crm.module.css';

type Contato = { id: string; nome: string | null; telefone: string | null; documento: string | null; abertos: number; total: number; ultimo: string | null };
type Nota = { id: string; texto: string; autor: string | null; criado_em: string };

export function Contatos({ busca, quadro, podeEditar, podeConferir, mascarado, onAbrir, onQuadro, onAviso, onErro }: {
  busca: string; quadro: TQuadro; podeEditar: boolean; podeConferir: boolean; mascarado: boolean;
  onAbrir: (atendimentoId: string) => void; onQuadro: (q: TQuadro) => void; onAviso: (t: string) => void; onErro: (t: string) => void;
}) {
  const [lista, setLista] = useState<Contato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [atends, setAtends] = useState<Cartao[] | null>(null);
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [nota, setNota] = useState('');
  const [form, setForm] = useState<null | 'novo' | 'editar' | 'atendimento'>(null);
  const [salvando, iniciar] = useTransition();
  const fmt = useMemo(() => criarFormatos(quadro.fuso), [quadro.fuso]);

  useEffect(() => { carregarContatos().then((r) => (r.ok ? setLista(r.dados) : setErro(r.erro))); }, []);
  useEffect(() => {
    if (!sel) return;
    setAtends(null); setNotas(null); setNota('');
    carregarAtendimentosDoContato(sel).then((r) => (r.ok ? setAtends(r.dados) : onErro(r.erro)));
    carregarNotasDoContato(sel).then((r) => (r.ok ? setNotas(r.dados) : onErro(r.erro)));
  }, [sel, onErro]);

  if (erro) return <div className={c.vazioTela}>{erro}</div>;
  if (!lista) return <div className={c.vazioTela}>Carregando os contatos…</div>;
  const vis = lista.filter((k) => casaBusca(busca, [k.nome, k.telefone, k.documento]));
  const atual = lista.find((k) => k.id === sel) ?? null;
  const topNome = Object.fromEntries(quadro.topicos.map((t) => [t.id, t.nome]));

  const salvarNota = () => iniciar(async () => {
    if (!sel) return;
    const r = await anotarNoContato(sel, nota);
    if (!r.ok) { onErro(r.erro); return; }
    setNotas(r.dados); setNota('');
  });

  return (
    <>
      {podeEditar && (
        <div className={c.barra}>
          <p className={c.nota}>{lista.length} contato{lista.length === 1 ? '' : 's'}</p>
          <button type="button" className={c.botaoNovo} onClick={() => setForm('novo')}><Icone nome="pessoa" tamanho={14} /> Novo contato</button>
        </div>
      )}
      <div className={c.contatos}>
        <section className={c.listaContatos} aria-label="Lista de contatos">
          {!vis.length && <div className={c.nadaAberto}>{lista.length ? 'Nenhum contato com essa busca' : 'Nenhum contato ainda'}</div>}
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
          {!atual ? <div className={c.nadaAberto}>Escolha um contato para ver a ficha.</div> : (
            <>
              <div className={c.cabecaFicha}>
                <h2 className={c.fichaNome}>{atual.nome || 'Contato sem nome'}</h2>
                {podeEditar && <>
                  <button type="button" className={c.acaoSec} onClick={() => setForm('editar')}>Editar</button>
                  <button type="button" className={c.acaoPri} onClick={() => setForm('atendimento')}>Novo atendimento</button>
                </>}
              </div>
              <div className={c.detLinhas}>
                <div className={c.detLinha}><span className={c.metaRot}>Telefone</span><span className={c.mono}>{telefoneBonito(atual.telefone)}</span>
                  {linkWhatsApp(atual.telefone) && <a className={c.linkBotao} href={linkWhatsApp(atual.telefone)!} target="_blank" rel="noreferrer"><Icone nome="conversa" tamanho={13} /> Abrir no WhatsApp</a>}</div>
                {atual.documento && <div className={c.detLinha}><span className={c.metaRot}>CPF</span><span className={c.mono}>{cpfBonito(atual.documento)}</span></div>}
              </div>
              <HistoricoPaciente key={atual.id} contatoId={atual.id} fmt={fmt} podeConferir={podeConferir} onAbrirAtendimento={onAbrir} onErro={onErro} />
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
              <h3 className={c.rotuloSec}>Notas do contato</h3>
              {notas === null ? <p className={c.detMeta}>Carregando…</p> : !notas.length ? <p className={c.detMeta}>Nenhuma nota.</p> : (
                <ol className={c.historico}>
                  {notas.map((n) => (
                    <li key={n.id} className={c.evNota}>
                      <span className={c.evQuando}>{fmt.quando(n.criado_em)}</span>
                      <span className={c.evTexto}><strong>{n.autor || 'Nota'}:</strong> {n.texto}</span>
                    </li>
                  ))}
                </ol>
              )}
              {podeEditar && (
                <form className={c.formNota} onSubmit={(e) => { e.preventDefault(); if (nota.trim()) salvarNota(); }}>
                  <label className={c.visivelLeitor} htmlFor="nota-contato">Nova nota do contato</label>
                  <textarea id="nota-contato" value={nota} onChange={(e) => setNota(e.target.value)} rows={3} maxLength={4000}
                    placeholder="Nota sobre a pessoa (o paciente não vê). A IA lê estas notas." />
                  <button type="submit" className={c.acaoPri} disabled={salvando || !nota.trim()}>{salvando ? 'Salvando…' : 'Salvar nota'}</button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
      {(form === 'novo' || (form === 'editar' && atual)) && (
        <FormContato contato={form === 'editar' ? atual : null} esconderDocumento={mascarado} onFechar={() => setForm(null)}
          onPronto={(d) => { setLista(d.lista); setSel(d.id); setForm(null); onAviso(form === 'novo' ? 'Contato criado.' : 'Contato salvo.'); }} />
      )}
      {form === 'atendimento' && atual && (
        <NovoAtendimento quadro={quadro} telefone={atual.telefone ?? ''} nome={atual.nome ?? ''} onFechar={() => setForm(null)}
          onPronto={(q) => {
            onQuadro(q); setForm(null); onAviso('Atendimento aberto.');
            carregarAtendimentosDoContato(atual.id).then((r) => { if (r.ok) setAtends(r.dados); });
          }} />
      )}
    </>
  );
}
