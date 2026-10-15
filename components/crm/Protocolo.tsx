'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { marcarProtocolo } from '@/lib/painel/acoes';
import { carregarContatos, carregarProtocoloDoContato, carregarProtocolos } from '@/lib/painel/leitura-cliente';
import type { Alvo, ProtocoloContato, ProtocoloDoContato, Protocolos as TProtocolos } from '@/lib/painel/protocolo';
import { SITUACOES, nomeSituacao, type Situacao } from '@/lib/protocolo-nomes';
import { Icone } from '@/components/Icone';
import { Janela, Campo } from './Formularios';
import { casaBusca, telefoneBonito } from './util';
import c from './crm.module.css';

// Acompanhamento de protocolo (14/10, pedido da Letícia): a tela "Protocolos" do menu (15/10) e o bloco "Protocolo" da
// ficha do contato. A equipe marca à mão a situação (em análise, em protocolo, em acompanhamento, encerrado) e uma
// observação; o painel guarda desde quando e quem marcou. A IA também pode marcar pela API.

export type { ProtocoloDoContato };
type Salvo = { lista: TProtocolos; contato: ProtocoloContato };

const diaBonito = (iso: string | null, fuso: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// Bloco com os botões da situação e a observação. Clicar numa situação grava na hora (mantém a observação).
// alvo: { id } do contato, ou { telefone, nome } da conversa da Inbox (o primeiro clique cria o contato se faltar).
export function BlocoProtocolo({ alvo, atual, fuso, podeEditar, onSalvo, onErro }: {
  alvo: Alvo; atual: ProtocoloDoContato; fuso: string; podeEditar: boolean;
  onSalvo: (d: Salvo, texto: string) => void; onErro: (t: string) => void;
}) {
  const chave = alvo.id ?? alvo.telefone ?? '';
  const contatoId = chave.replace(/[^0-9a-z-]/gi, '');
  const [obs, setObs] = useState(atual?.obs ?? '');
  const [salvando, iniciar] = useTransition();
  useEffect(() => { setObs(atual?.obs ?? ''); }, [atual?.obs, chave]);
  const gravar = (situacao: Situacao | null, novaObs: string | undefined, texto: string) => iniciar(async () => {
    const r = await marcarProtocolo(alvo, situacao, novaObs);
    if (!r.ok) { if (r.sair) { window.location.href = '/entrar?motivo=sessao'; return; } onErro(r.erro); return; }
    onSalvo(r.dados, texto);
  });
  const sit = atual?.situacao ?? null;
  return (
    <div className={c.detBloco} data-protocolo={sit ?? 'nenhum'}>
      <div className={`${c.segmentadoPeq} ${c.fases}`} role="group" aria-label="Situação do protocolo">
        {SITUACOES.map((s) => (
          <button key={s.id} type="button" className={c.segItem} aria-pressed={sit === s.id} data-situacao={s.id}
            disabled={!podeEditar || salvando || sit === s.id}
            onClick={() => gravar(s.id, obs.trim() !== (atual?.obs ?? '') ? obs : undefined, `Protocolo: ${s.nome}.`)}>
            {s.nome}
          </button>
        ))}
      </div>
      <p className={c.detMeta} data-protocolo-desde>
        {sit ? <>{nomeSituacao(sit)} desde {diaBonito(atual?.desde ?? null, fuso)}{atual?.por ? ` · por ${atual.por}` : ''}</> : 'Fora de protocolo.'}
      </p>
      {podeEditar && sit ? (
        <form className={c.formNota} onSubmit={(e) => { e.preventDefault(); gravar(sit as Situacao, obs, 'Observação do protocolo salva.'); }}>
          <label className={c.visivelLeitor} htmlFor={`obs-protocolo-${contatoId}`}>Observação do protocolo</label>
          <textarea id={`obs-protocolo-${contatoId}`} value={obs} onChange={(e) => setObs(e.target.value)} rows={2} maxLength={500}
            placeholder="Observação do protocolo (ex.: começou o injetável em 10/10, volta em 30 dias)" />
          <div className={c.acoes}>
            <button type="submit" className={c.acaoPri} disabled={salvando || obs.trim() === (atual?.obs ?? '')}>{salvando ? 'Salvando…' : 'Salvar observação'}</button>
            <button type="button" className={c.acaoSec} disabled={salvando} data-tirar-protocolo
              onClick={() => gravar(null, undefined, 'Pessoa tirada do protocolo.')}>Tirar do protocolo</button>
          </div>
        </form>
      ) : atual?.obs ? <p className={c.detResumo}>{atual.obs}</p> : null}
    </div>
  );
}

type Filtro = 'ativos' | Situacao;

// Lista de protocolos: todo mundo que está em protocolo, com filtro por situação. "Ativos" = tudo menos encerrado.
export function Protocolos({ busca, fuso, podeEditar, onAviso, onErro }: {
  busca: string; fuso: string; podeEditar: boolean; onAviso: (t: string) => void; onErro: (t: string) => void;
}) {
  const [dados, setDados] = useState<TProtocolos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('ativos');
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  useEffect(() => {
    void carregarProtocolos().then((r) => {
      if (r.ok) setDados(r.dados);
      else if (r.sair) window.location.href = '/entrar?motivo=sessao';
      else setErro(r.erro);
    });
  }, []);

  const salvo = (d: Salvo, texto: string) => { setDados(d.lista); onAviso(texto); };
  if (erro) return <div className={c.vazioTela}>{erro}</div>;
  if (!dados) return <div className={c.vazioTela}>Carregando os protocolos…</div>;
  if (!dados.instalado) return <div className={c.vazioTela} data-protocolo-sem-migracao>O acompanhamento de protocolo ainda não foi instalado no banco desta empresa (migração 025).</div>;

  const conta = (f: Filtro) => dados.lista.filter((x) => (f === 'ativos' ? x.situacao !== 'encerrado' : x.situacao === f)).length;
  const vis = dados.lista
    .filter((x) => (filtro === 'ativos' ? x.situacao !== 'encerrado' : x.situacao === filtro))
    .filter((x) => casaBusca(busca, [x.nome, x.telefone, x.obs]));

  return (
    <>
      <div className={c.barra}>
        <div className={`${c.segmentadoPeq} ${c.fases}`} role="group" aria-label="Filtrar por situação" data-filtro-protocolo>
          <button type="button" className={c.segItem} aria-pressed={filtro === 'ativos'} onClick={() => setFiltro('ativos')}>
            <span className={c.faseItem}>Ativos <strong>{conta('ativos')}</strong></span>
          </button>
          {SITUACOES.map((s) => (
            <button key={s.id} type="button" className={c.segItem} aria-pressed={filtro === s.id} data-filtro={s.id}
              onClick={() => setFiltro((f) => (f === s.id ? 'ativos' : s.id))}>
              <span className={c.faseItem}>{s.nome} <strong>{conta(s.id)}</strong></span>
            </button>
          ))}
        </div>
        {podeEditar && (
          <button type="button" className={c.botaoNovo} onClick={() => setNovo(true)} data-novo-protocolo><Icone nome="pessoa" tamanho={14} /> Colocar em protocolo</button>
        )}
      </div>
      <section className={c.listaProtocolo} aria-label="Pessoas em protocolo">
        {!vis.length && <div className={c.nadaAberto}>{dados.lista.length ? 'Ninguém nesta situação' : 'Ninguém em protocolo ainda. Marque pela ficha do contato ou em "Colocar em protocolo".'}</div>}
        {vis.map((x) => (
          <article key={x.id} className={c.itemProtocolo} data-linha-protocolo={x.id}>
            <button type="button" className={c.itemProtocoloTopo} aria-expanded={aberto === x.id} onClick={() => setAberto((a) => (a === x.id ? null : x.id))}>
              <span className={c.avatarPeq} aria-hidden="true">{(x.nome || '#').trim().slice(0, 1).toUpperCase()}</span>
              <span className={c.itemContatoTexto}>
                <span className={c.itemContatoNome}>{x.nome || 'Contato sem nome'}</span>
                <span className={c.mono + ' ' + c.detMeta}>{telefoneBonito(x.telefone)}</span>
              </span>
              <span className={c.seloProtocolo} data-situacao={x.situacao}>{nomeSituacao(x.situacao)}</span>
              <span className={c.detMeta}>desde {diaBonito(x.desde, fuso)}</span>
            </button>
            {x.obs && aberto !== x.id && <p className={c.obsProtocolo}>{x.obs}</p>}
            {aberto === x.id && (
              <div className={c.itemProtocoloCorpo}>
                <BlocoProtocolo alvo={{ id: x.id }} atual={x} fuso={fuso} podeEditar={podeEditar} onSalvo={salvo} onErro={onErro} />
                {x.telefone && <a className={c.linkBotao} href={`/inbox?tel=${String(x.telefone).replace(/\D/g, '')}`}><Icone nome="conversa" tamanho={13} /> Abrir a conversa na Inbox</a>}
                {x.abertos > 0 && <p className={c.detMeta}>{x.abertos} atendimento{x.abertos > 1 ? 's' : ''} em aberto no quadro.</p>}
              </div>
            )}
          </article>
        ))}
      </section>
      {novo && <NovoProtocolo ja={new Set(dados.lista.map((x) => x.id))} onFechar={() => setNovo(false)}
        onPronto={(d, texto) => { setNovo(false); salvo(d, texto); }} />}
    </>
  );
}

type ContatoCurto = { id: string; nome: string | null; telefone: string | null };

// Escolhe um contato do CRM e a situação. Quem já está em protocolo aparece marcado (muda pela lista).
function NovoProtocolo({ ja, onFechar, onPronto }: { ja: Set<string>; onFechar: () => void; onPronto: (d: Salvo, texto: string) => void }) {
  const [contatos, setContatos] = useState<ContatoCurto[] | null>(null);
  const [q, setQ] = useState('');
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('em_analise');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  useEffect(() => { void carregarContatos().then((r) => (r.ok ? setContatos(r.dados) : setErro(r.erro))); }, []);
  const achados = useMemo(() => (contatos ?? []).filter((k) => q.trim().length >= 2 && casaBusca(q, [k.nome, k.telefone])).slice(0, 20), [contatos, q]);
  const nomeEscolhido = contatos?.find((k) => k.id === escolhido);
  const salvar = () => iniciar(async () => {
    if (!escolhido) { setErro('Escolha o contato.'); return; }
    const r = await marcarProtocolo({ id: escolhido }, situacao, obs);
    if (!r.ok) { if (r.sair) { window.location.href = '/entrar?motivo=sessao'; return; } setErro(r.erro); return; }
    onPronto(r.dados, `${nomeEscolhido?.nome || 'Contato'}: ${nomeSituacao(situacao)}.`);
  });
  return (
    <Janela titulo="Colocar em protocolo" onFechar={onFechar}>
      <form className={c.formJanela} aria-label="Colocar em protocolo" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        <Campo id="prot-busca" rotulo="Contato" dica="Nome ou telefone (2 letras ou mais).">
          <input id="prot-busca" type="search" autoComplete="off" value={q} onChange={(e) => { setQ(e.target.value); setEscolhido(null); }} />
        </Campo>
        {!contatos && !erro && <p className={c.notaJanela}>Carregando os contatos…</p>}
        {achados.length > 0 && !escolhido && (
          <ul className={c.listaDias} aria-label="Contatos encontrados">
            {achados.map((k) => (
              <li key={k.id}>
                <span><strong>{k.nome || 'Contato sem nome'}</strong> · <span className={c.mono}>{telefoneBonito(k.telefone)}</span>{ja.has(k.id) ? <small> · já em protocolo</small> : null}</span>
                <button type="button" className={c.acaoSec} data-escolher-contato={k.id} onClick={() => { setEscolhido(k.id); setQ(k.nome || telefoneBonito(k.telefone)); }}>Escolher</button>
              </li>
            ))}
          </ul>
        )}
        <Campo id="prot-situacao" rotulo="Situação">
          <select id="prot-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as Situacao)}>
            {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Campo>
        <Campo id="prot-obs" rotulo="Observação" dica="Opcional, até 500 caracteres.">
          <textarea id="prot-obs" rows={3} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
        </Campo>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}><button type="submit" className={c.acaoPri} disabled={salvando || !escolhido}>{salvando ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Janela>
  );
}


// Tela própria "Protocolos" no menu (15/10, pedido do Mateus): título, busca e a lista. Mesma permissão do CRM
// (crm.ver para ver, crm.editar para marcar). Os avisos de sucesso e erro aparecem no topo, como no CRM.
export function ProtocolosTela({ fuso, podeEditar }: { fuso: string; podeEditar: boolean }) {
  const [busca, setBusca] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  useEffect(() => {
    if (!aviso || aviso.tipo !== 'ok') return;
    const t = window.setTimeout(() => setAviso(null), 3500);
    return () => window.clearTimeout(t);
  }, [aviso]);
  return (
    <div className={c.tela}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>Acompanhamento de protocolo</h1>
          <p className={c.sub}>Quem está em análise, em protocolo, em acompanhamento ou encerrado com o Doutor.</p>
        </div>
        <label className={c.busca}>
          <span className={c.visivelLeitor}>Buscar</span>
          <Icone nome="busca" tamanho={16} />
          <input id="busca-protocolo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone ou observação" />
        </label>
      </header>
      <div className={c.aviso} role="status" aria-live="polite">
        {aviso && (
          <span className={aviso.tipo === 'erro' ? c.avisoErro : c.avisoOk}>
            {aviso.texto}
            <button type="button" aria-label="Fechar aviso" onClick={() => setAviso(null)}><Icone nome="fechar" tamanho={13} /></button>
          </span>
        )}
      </div>
      <Protocolos busca={busca} fuso={fuso} podeEditar={podeEditar}
        onAviso={(texto) => setAviso({ tipo: 'ok', texto })} onErro={(texto) => setAviso({ tipo: 'erro', texto })} />
    </div>
  );
}

// Protocolo de um contato só, para o cartão do CRM e a conversa da Inbox (15/10): carrega a situação e mostra os botões.
// Na Inbox, o número sem contato no CRM ganha o contato no primeiro clique (com o nome da conversa).
export function ProtocoloRapido({ alvo, fuso, podeEditar, onAviso, onErro }: {
  alvo: Alvo; fuso: string; podeEditar: boolean; onAviso: (t: string) => void; onErro: (t: string) => void;
}) {
  const [dados, setDados] = useState<ProtocoloContato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const chave = `${alvo.id ?? ''}|${alvo.telefone ?? ''}`;
  useEffect(() => {
    let vivo = true;
    setDados(null); setErro(null);
    void carregarProtocoloDoContato(alvo).then((r) => {
      if (!vivo) return;
      if (r.ok) setDados(r.dados);
      else if (r.sair) window.location.href = '/entrar?motivo=sessao';
      else setErro(r.erro);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  if (erro) return <p className={c.detMeta} role="alert">{erro}</p>;
  if (!dados) return <p className={c.detMeta}>Carregando o protocolo…</p>;
  const alvoAtual: Alvo = dados.contatoId ? { id: dados.contatoId } : { telefone: alvo.telefone, nome: alvo.nome };
  return (
    <div data-protocolo-rapido>
      {!dados.contatoId && <p className={c.detMeta}>Este número ainda não tem contato no CRM: escolher uma situação cria o contato.</p>}
      <BlocoProtocolo alvo={alvoAtual} atual={dados.protocolo} fuso={fuso} podeEditar={podeEditar} onErro={onErro}
        onSalvo={(d, texto) => { setDados(d.contato); onAviso(texto); }} />
    </div>
  );
}
