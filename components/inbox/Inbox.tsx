'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConversaAberta, Conversa, ListaConversas, Mensagem } from '@/lib/painel/inbox';
import { abrirConversa, carregarConversas, enviarMensagem } from '@/lib/painel/acoes-inbox';
import type { Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { telefoneBonito } from '@/components/crm/util';
import c from './inbox.module.css';

// Inbox (fases 1.1 e 2.3): lista de conversas à esquerda e a conversa aberta à direita, com a caixa de resposta
// para quem tem inbox.responder. Atualiza a lista e a conversa aberta a cada 10 s, sem tirar a pessoa do ponto
// onde ela rolou. A resposta enviada aparece como "enviando…" até o receptor gravá-la no espelho.

const ATUALIZA_MS = 10000;
type Chave = { numero_id: string; wa_id: string };
type Aberta = Omit<ConversaAberta, 'fuso'>;
type Pendente = { chave: string; wamid: string; texto: string; em: string };
const FORA_DA_JANELA = 'Fora da janela de 24 h: a Meta só permite modelo aprovado. Responda pelo celular ou espere o paciente escrever.';
const chaveDe = (k: Chave) => k.numero_id + ':' + k.wa_id;

const AUTOR: Record<Mensagem['origem'], string> = { contato: '', api: 'Sara', celular: 'Equipe (celular)', historico: 'Histórico', painel: 'Painel' };
const MIDIA: Record<string, string> = {
  image: 'Foto', audio: 'Áudio', video: 'Vídeo', document: 'Documento', sticker: 'Figurinha', location: 'Localização', contacts: 'Contato',
};
const STATUS: Record<string, { marca: string; nome: string }> = {
  pendente: { marca: '…', nome: 'Pendente' }, enviada: { marca: '✓', nome: 'Enviada' }, entregue: { marca: '✓✓', nome: 'Entregue' },
  lida: { marca: '✓✓', nome: 'Lida' }, reproduzida: { marca: '✓✓', nome: 'Reproduzida' }, falhou: { marca: '!', nome: 'Não enviada' },
};

const mesma = (a: Chave | null, b: Chave | null) => Boolean(a && b && a.numero_id === b.numero_id && a.wa_id === b.wa_id);
const nomeDe = (k: Conversa) => k.nome || telefoneBonito(k.wa_id);
const iniciais = (k: Conversa) => (k.nome ? k.nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() : '#');

// Junta a página nova com o que já está na tela (páginas antigas carregadas ficam), na ordem da conversa.
function mesclar(atuais: Mensagem[], novas: Mensagem[]): Mensagem[] {
  const m = new Map(atuais.map((x) => [x.id, x]));
  for (const x of novas) m.set(x.id, x);
  return [...m.values()].sort((a, b) => a.em.localeCompare(b.em) || Number(a.id) - Number(b.id));
}

function criarDatas(fuso: string) {
  const chave = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' });
  const curto = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' });
  const longo = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hoje = () => chave.format(new Date());
  const ontem = () => chave.format(new Date(Date.now() - 86400000));
  return {
    dia: (iso: string) => chave.format(new Date(iso)),
    hora: (iso: string) => hora.format(new Date(iso)),
    // Lista: "14:02" hoje, "Ontem", "29/09" antes disso
    lista(iso: string | null) {
      if (!iso) return '';
      const k = chave.format(new Date(iso));
      return k === hoje() ? hora.format(new Date(iso)) : k === ontem() ? 'Ontem' : curto.format(new Date(iso));
    },
    // Separador da conversa: "Hoje", "Ontem", "segunda-feira, 29 de setembro de 2026"
    separador(iso: string) {
      const k = chave.format(new Date(iso));
      return k === hoje() ? 'Hoje' : k === ontem() ? 'Ontem' : longo.format(new Date(iso));
    },
  };
}

export function Inbox({ inicial, mascarado, podeResponder, nome }: { inicial: ListaConversas; mascarado: boolean; podeResponder: boolean; nome: string }) {
  const [lista, setLista] = useState(inicial);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<Chave | null>(null);
  const [dados, setDados] = useState<Aberta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falhouAtualizar, setFalhouAtualizar] = useState(false);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const datas = useMemo(() => criarDatas(lista.fuso), [lista.fuso]);

  const abertaRef = useRef<Chave | null>(null);
  abertaRef.current = aberta;
  const buscaRef = useRef('');
  buscaRef.current = busca;
  const rolagem = useRef<HTMLDivElement>(null);
  // O que fazer com a rolagem depois de desenhar as mensagens novas.
  const ajuste = useRef<{ tipo: 'fim' } | { tipo: 'manter'; altura: number; topo: number } | null>(null);

  const tratar = useCallback(<T,>(r: Resposta<T>): T | null => {
    if (!r.ok) {
      if (r.sair) { window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`; return null; }
      setAviso(r.erro);
      return null;
    }
    return r.dados;
  }, []);

  // A linha da lista volta do servidor com as não lidas já zeradas (ou não, para o master).
  const atualizarLinha = useCallback((k: Conversa) => {
    setLista((l) => ({ ...l, conversas: l.conversas.map((x) => (mesma(x, k) ? k : x)) }));
  }, []);

  const abrir = useCallback(async (k: Chave) => {
    setAberta(k); setDados(null); setCarregando(true); setAviso(null);
    const d = tratar(await abrirConversa(k.numero_id, k.wa_id));
    if (!mesma(abertaRef.current, k)) return;
    setCarregando(false);
    if (!d) return;
    ajuste.current = { tipo: 'fim' };
    setDados({ conversa: d.conversa, mensagens: d.mensagens, temMais: d.temMais });
    atualizarLinha(d.conversa);
  }, [tratar, atualizarLinha]);

  const carregarAntigas = useCallback(async () => {
    const k = abertaRef.current;
    if (!k || !dados?.mensagens.length) return;
    setCarregandoAntigas(true);
    const d = tratar(await abrirConversa(k.numero_id, k.wa_id, dados.mensagens[0].id));
    setCarregandoAntigas(false);
    if (!d || !mesma(abertaRef.current, k)) return;
    const el = rolagem.current;
    ajuste.current = el ? { tipo: 'manter', altura: el.scrollHeight, topo: el.scrollTop } : null;
    setDados((x) => (x ? { ...x, mensagens: mesclar(x.mensagens, d.mensagens), temMais: d.temMais } : x));
  }, [dados, tratar]);

  useLayoutEffect(() => {
    const el = rolagem.current; const a = ajuste.current;
    if (!el || !a) return;
    ajuste.current = null;
    if (a.tipo === 'fim') el.scrollTop = el.scrollHeight;
    else el.scrollTop = a.topo + (el.scrollHeight - a.altura);
  }, [dados, pendentes]);

  // Junta a página mais recente da conversa com a tela; só desce para o fim se a pessoa já estava perto dele.
  const aplicarAtualizacao = useCallback((d: Aberta) => {
    const el = rolagem.current;
    const pertoDoFim = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setDados((x) => {
      if (!x) return x;
      const mensagens = mesclar(x.mensagens, d.mensagens);
      if (pertoDoFim && mensagens.length !== x.mensagens.length) ajuste.current = { tipo: 'fim' };
      return { ...x, conversa: d.conversa, mensagens };
    });
  }, []);

  // A bolha "enviando…" sai quando a conversa já traz a mensagem com o mesmo wamid.
  useEffect(() => {
    if (!dados || !pendentes.length) return;
    const vistos = new Set(dados.mensagens.map((m) => m.wamid));
    if (pendentes.some((p) => vistos.has(p.wamid))) setPendentes((ps) => ps.filter((p) => !vistos.has(p.wamid)));
  }, [dados, pendentes]);

  const enviar = useCallback(async (texto: string): Promise<string | null> => {
    const k = abertaRef.current;
    if (!k) return 'Abra uma conversa antes de responder.';
    const r = await enviarMensagem(k.numero_id, k.wa_id, texto);
    if (!r.ok) {
      if (r.sair) { window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`; return null; }
      return r.erro;
    }
    ajuste.current = { tipo: 'fim' };
    setPendentes((ps) => [...ps, { chave: chaveDe(k), wamid: r.dados.wamid, texto: texto.trim(), em: new Date().toISOString() }]);
    // Traz a conversa na hora (o receptor costuma gravar antes desta resposta voltar).
    const conv = await abrirConversa(k.numero_id, k.wa_id);
    if (conv.ok && mesma(abertaRef.current, k)) aplicarAtualizacao(conv.dados);
    return null;
  }, [aplicarAtualizacao]);

  // Busca no servidor (nome ou dígitos do número), com uma pausa curta enquanto a pessoa digita.
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    const t = window.setTimeout(async () => {
      const r = await carregarConversas(busca);
      if (r.ok && buscaRef.current === busca) setLista(r.dados);
      else if (!r.ok) tratar(r);
    }, 300);
    return () => window.clearTimeout(t);
  }, [busca, tratar]);

  // Atualização automática da lista e da conversa aberta, só com a aba do navegador visível.
  useEffect(() => {
    let parado = false;
    const tick = async () => {
      if (parado || document.hidden) return;
      const k = abertaRef.current;
      const [l, conv] = await Promise.all([
        carregarConversas(buscaRef.current),
        k ? abrirConversa(k.numero_id, k.wa_id) : Promise.resolve(null),
      ]);
      if (parado) return;
      if (l.ok) { setLista(l.dados); setFalhouAtualizar(false); }
      else if (l.sair) { window.location.href = '/entrar?motivo=sessao'; return; }
      else setFalhouAtualizar(true);
      if (conv && conv.ok && mesma(abertaRef.current, k)) aplicarAtualizacao(conv.dados);
    };
    const id = window.setInterval(tick, ATUALIZA_MS);
    const vis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { parado = true; window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [aplicarAtualizacao]);

  const total = lista.conversas.length;
  const naoLidas = lista.conversas.reduce((s, k) => s + (k.nao_lidas > 0 ? 1 : 0), 0);
  const atual = dados?.conversa ?? (aberta ? lista.conversas.find((k) => mesma(k, aberta)) ?? null : null);
  const meusPendentes = aberta && dados ? pendentes.filter((p) => p.chave === chaveDe(aberta)) : [];

  return (
    <div className={c.tela} data-aberta={aberta ? 'true' : 'false'}>
      <section className={c.lista} aria-label="Conversas">
        <div className={c.listaTopo}>
          <div className={c.listaTitulo}>
            <h1 className={c.titulo}>Inbox</h1>
            <span className={c.contagem}>
              {total === 1 ? '1 conversa' : `${total} conversas`}{naoLidas ? ` · ${naoLidas} ${naoLidas === 1 ? 'não lida' : 'não lidas'}` : ''}
            </span>
          </div>
          <label className={c.busca}>
            <span className={c.visivelLeitor}>Buscar conversa</span>
            <Icone nome="busca" tamanho={16} />
            <input id="busca-inbox" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou número" />
          </label>
          {falhouAtualizar && <p className={c.subErro}>Sem conexão com o banco agora. Tentando de novo.</p>}
          {mascarado && <p className={c.notaMaster}>Visão da Planee: CPF mascarado, acesso registrado e as não lidas da clínica não mudam.</p>}
        </div>
        <ul className={c.itens}>
          {lista.conversas.map((k) => (
            <li key={k.numero_id + ':' + k.wa_id}>
              <button type="button" className={c.item} aria-current={mesma(k, aberta) ? 'true' : undefined} data-wa={k.wa_id} onClick={() => abrir(k)}>
                <span className={c.avatar} aria-hidden="true">{iniciais(k)}</span>
                <span className={c.itemTexto}>
                  <span className={c.itemLinha}>
                    <span className={k.nao_lidas ? c.itemNomeForte : c.itemNome}>{nomeDe(k)}</span>
                    <span className={c.itemHora}>{datas.lista(k.ultima_em)}</span>
                  </span>
                  <span className={c.itemLinha}>
                    <span className={c.previa}>{k.ultima_direcao === 'saida' ? 'Clínica: ' : ''}{k.ultima_resumo ?? ''}</span>
                    {k.janela_aberta && <span className={c.janela} title="Janela de 24 h aberta: o contato escreveu nas últimas 24 horas">24h</span>}
                    {k.nao_lidas > 0 && <span className={c.naoLidas} aria-label={`${k.nao_lidas} não lidas`}>{k.nao_lidas}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!total && (
          <div className={c.vazio}>
            {busca.trim() ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda. Quando o WhatsApp da empresa receber mensagens, elas aparecem aqui.'}
          </div>
        )}
      </section>

      <section className={c.conversa} aria-label={atual ? `Conversa com ${nomeDe(atual)}` : 'Conversa'}>
        {!aberta ? (
          <div className={c.semConversa}>
            <Icone nome="inbox" tamanho={36} />
            <span>Escolha uma conversa na lista</span>
          </div>
        ) : (
          <>
            <header className={c.cabeca}>
              <button type="button" className={c.voltar} onClick={() => { setAberta(null); setDados(null); }} aria-label="Voltar para a lista">
                <span aria-hidden="true">←</span> Voltar
              </button>
              {atual && (
                <>
                  <span className={c.avatarGrande} aria-hidden="true">{iniciais(atual)}</span>
                  <div className={c.cabecaTexto}>
                    <h2 className={c.cabecaNome}>{nomeDe(atual)}</h2>
                    <span className={c.cabecaLinha}>
                      <span className={c.mono}>{telefoneBonito(atual.wa_id)}</span>
                      <span className={c.pilula} data-aberta={atual.janela_aberta ? 'true' : 'false'}>
                        {atual.janela_aberta ? 'Janela de 24 h aberta' : 'Janela de 24 h fechada'}
                      </span>
                    </span>
                  </div>
                </>
              )}
            </header>
            <div className={c.mensagens} ref={rolagem}>
              {carregando && <p className={c.carregando}>Carregando a conversa…</p>}
              {dados?.temMais && (
                <button type="button" className={c.maisAntigas} onClick={carregarAntigas} disabled={carregandoAntigas}>
                  {carregandoAntigas ? 'Carregando…' : 'Carregar mais antigas'}
                </button>
              )}
              {dados && !dados.mensagens.length && <p className={c.carregando}>Nenhuma mensagem nesta conversa ainda.</p>}
              {dados?.mensagens.map((m, i) => {
                const novoDia = i === 0 || datas.dia(dados.mensagens[i - 1].em) !== datas.dia(m.em);
                return (
                  <div key={m.id} className={c.bloco}>
                    {novoDia && <div className={c.dia} role="separator"><span>{datas.separador(m.em)}</span></div>}
                    <Bolha m={m} hora={datas.hora(m.em)} nomeContato={atual ? nomeDe(atual) : 'Contato'} />
                  </div>
                );
              })}
              {meusPendentes.map((p) => (
                <div key={p.wamid} className={c.bloco}>
                  <div className={c.linha} data-direcao="saida" data-pendente="true">
                    <span className={c.autor} data-tipo="equipe">Painel · {nome}</span>
                    <div className={c.bolha} data-tipo="equipe" data-pendente="true"><p className={c.texto}>{p.texto}</p></div>
                    <span className={c.meta}><span className={c.mono}>{datas.hora(p.em)}</span><span className={c.marca}>enviando…</span></span>
                  </div>
                </div>
              ))}
            </div>
            {podeResponder && atual && (
              <Compositor key={chaveDe(aberta)} janelaAberta={atual.janela_aberta} onEnviar={enviar} />
            )}
          </>
        )}
        {!podeResponder && <footer className={c.rodape}>Somente leitura: sua conta não tem a permissão para responder pelo painel.</footer>}
      </section>

      <div className={c.aviso} role="status" aria-live="polite">
        {aviso && (
          <span className={c.avisoErro}>
            {aviso}
            <button type="button" aria-label="Fechar aviso" onClick={() => setAviso(null)}><Icone nome="fechar" tamanho={13} /></button>
          </span>
        )}
      </div>
    </div>
  );
}

// Caixa de resposta: Enter envia, Shift+Enter quebra a linha. Fora da janela de 24 h fica desligada, com o motivo.
function Compositor({ janelaAberta, onEnviar }: { janelaAberta: boolean; onEnviar: (texto: string) => Promise<string | null> }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mandar = async () => {
    if (enviando || !janelaAberta || !texto.trim()) return;
    setEnviando(true); setErro(null);
    const e = await onEnviar(texto);
    setEnviando(false);
    if (e) setErro(e); else setTexto('');
  };
  return (
    <footer className={c.compositor}>
      {!janelaAberta && <p className={c.foraJanela}>{FORA_DA_JANELA}</p>}
      <div className={c.caixa} data-desligada={janelaAberta ? undefined : 'true'}>
        <label htmlFor="resposta-inbox" className={c.visivelLeitor}>Resposta</label>
        <textarea id="resposta-inbox" value={texto} maxLength={4096} disabled={!janelaAberta || enviando}
          placeholder={janelaAberta ? 'Escreva a resposta. Enter envia; Shift+Enter quebra a linha.' : 'Resposta desligada fora da janela de 24 h'}
          onChange={(e) => { setTexto(e.target.value); if (erro) setErro(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); mandar(); } }} />
        <button type="button" className={c.enviar} onClick={mandar} disabled={!janelaAberta || enviando || !texto.trim()}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      {erro && <p className={c.erroEnvio} role="alert">{erro}</p>}
    </footer>
  );
}

function Bolha({ m, hora, nomeContato }: { m: Mensagem; hora: string; nomeContato: string }) {
  const tipoBolha = m.direcao === 'entrada' ? 'entrada' : m.origem === 'api' ? 'sara' : 'equipe';
  const autor = m.origem === 'painel' && m.por ? `Painel · ${m.por}` : AUTOR[m.origem] ?? '';
  const st = m.direcao === 'saida' && m.status ? STATUS[m.status] : undefined;
  const rotMidia = MIDIA[m.tipo];
  let conteudo: React.ReactNode;
  if (m.origem === 'api' && m.tipo === 'desconhecido') {
    conteudo = <p className={c.semTexto}>Mensagem da Sara (texto ainda não registrado)</p>;
  } else if (m.tipo === 'unsupported') {
    conteudo = <p className={c.semTexto}>Tipo de mensagem não suportado</p>;
  } else if (rotMidia) {
    const nomeArquivo = m.tipo === 'document' ? m.midia?.filename : null;
    const legenda = m.texto && m.texto !== nomeArquivo ? m.texto : null;
    conteudo = (
      <>
        <span className={c.midia} data-tipo={m.tipo}>{nomeArquivo ? `${rotMidia}: ${nomeArquivo}` : rotMidia}</span>
        {legenda && <p className={c.texto}>{legenda}</p>}
      </>
    );
  } else {
    conteudo = m.texto ? <p className={c.texto}>{m.texto}</p> : <p className={c.semTexto}>Mensagem sem texto</p>;
  }
  return (
    <div className={c.linha} data-direcao={m.direcao} data-id={m.id}>
      {autor && <span className={c.autor} data-tipo={tipoBolha}>{autor}</span>}
      <div className={c.bolha} data-tipo={tipoBolha} data-apagada={m.apagada ? 'true' : undefined}>
        {m.citada && (
          <blockquote className={c.citada}>
            {m.citada.encontrada ? (
              <>
                <span className={c.citadaAutor}>{m.citada.direcao === 'entrada' ? nomeContato : 'Clínica'}</span>
                <span className={c.citadaTexto}>{m.citada.texto || MIDIA[m.citada.tipo ?? ''] || 'Mensagem'}</span>
              </>
            ) : <span className={c.citadaTexto}>Mensagem citada não está no espelho</span>}
          </blockquote>
        )}
        {conteudo}
      </div>
      {m.reacoes.length > 0 && (
        <span className={c.reacoes}>
          {m.reacoes.map((r, i) => (
            <span key={i} title={r.daEmpresa ? 'Reação da clínica' : 'Reação do contato'}>{r.emoji}</span>
          ))}
        </span>
      )}
      <span className={c.meta}>
        <span className={c.mono}>{hora}</span>
        {m.editada && <span className={c.marca}>editada</span>}
        {m.apagada && <span className={c.marcaApagada}>apagada</span>}
        {st && <span className={c.status} data-status={m.status} title={st.nome} aria-label={st.nome}>{st.marca}</span>}
      </span>
    </div>
  );
}
