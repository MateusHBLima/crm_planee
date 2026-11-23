'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ConversaRede, ConversaRedeAberta, ListaRede, MensagemRede } from '@/lib/painel/redes';
import { abrirConversaRede, carregarConversasRede } from '@/lib/painel/leitura-cliente';
import { enviarNaRede } from '@/lib/painel/acoes-inbox';
import { Icone } from '@/components/Icone';
import c from './inbox.module.css';

// Inbox de uma conta de rede social (23/11): directs do Instagram (e das próximas redes com conversa). Mesma cara da
// Inbox do WhatsApp, sem mídia para enviar nem Assumir/Devolver. Atualiza a lista e a conversa aberta a cada 10 s.

const ATUALIZA_MS = 10000;
export const NOME_REDE: Record<string, string> = { instagram: 'Instagram', facebook: 'Messenger', tiktok: 'TikTok', youtube: 'YouTube' };
const MIDIA: Record<string, string> = { imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', arquivo: 'Arquivo', story: 'Story', outro: 'Mensagem' };
const FORA_DA_JANELA = 'Fora da janela de 24 h: a rede só deixa responder até 24 h depois da última mensagem da pessoa. Responda pelo app.';

const nomeDe = (k: ConversaRede) => k.nome || (k.usuario ? '@' + k.usuario : `Pessoa ${k.pessoa_id.slice(-4)}`);
const iniciais = (k: ConversaRede) => {
  const base = k.nome || k.usuario;
  return base ? base.replace(/^@/, '').trim().split(/[\s._]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() : '#';
};

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
    lista(iso: string | null) {
      if (!iso) return '';
      const k = chave.format(new Date(iso));
      return k === hoje() ? hora.format(new Date(iso)) : k === ontem() ? 'Ontem' : curto.format(new Date(iso));
    },
    separador(iso: string) {
      const k = chave.format(new Date(iso));
      return k === hoje() ? 'Hoje' : k === ontem() ? 'Ontem' : longo.format(new Date(iso));
    },
  };
}

export type PropsInboxRede = { conta: string; podeResponder: boolean; seletor?: ReactNode; mascarado: boolean };

export function InboxRede({ conta, podeResponder, seletor, mascarado }: PropsInboxRede) {
  const [lista, setLista] = useState<ListaRede | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [dados, setDados] = useState<ConversaRedeAberta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const abertaRef = useRef<string | null>(null);
  abertaRef.current = aberta;

  const atualizarLista = useCallback(async () => {
    const r = await carregarConversasRede(conta, busca.trim() || undefined);
    if (r.ok) { setLista(r.dados); setErroLista(null); } else setErroLista(r.erro);
  }, [conta, busca]);

  useEffect(() => {
    const t = window.setTimeout(atualizarLista, busca ? 300 : 0);
    const i = window.setInterval(atualizarLista, ATUALIZA_MS);
    return () => { window.clearTimeout(t); window.clearInterval(i); };
  }, [atualizarLista, busca]);

  const atualizarAberta = useCallback(async (pessoa: string) => {
    const r = await abrirConversaRede(conta, pessoa);
    if (abertaRef.current !== pessoa) return;
    if (r.ok) {
      setDados(r.dados);
      setLista((l) => (l ? { ...l, conversas: l.conversas.map((k) => (k.pessoa_id === pessoa ? r.dados.conversa : k)) } : l));
    }
  }, [conta]);

  useEffect(() => {
    if (!aberta) return;
    const i = window.setInterval(() => atualizarAberta(aberta), ATUALIZA_MS);
    return () => window.clearInterval(i);
  }, [aberta, atualizarAberta]);

  async function abrir(k: ConversaRede) {
    setAberta(k.pessoa_id); setDados(null); setCarregando(true);
    await atualizarAberta(k.pessoa_id);
    setCarregando(false);
  }

  const datas = criarDatas(lista?.fuso ?? 'America/Sao_Paulo');
  const conversas = lista?.conversas ?? [];
  const naoLidas = conversas.reduce((s, k) => s + (k.nao_lidas > 0 ? 1 : 0), 0);
  const atual = aberta ? (dados?.conversa ?? conversas.find((k) => k.pessoa_id === aberta) ?? null) : null;
  const agente = lista?.agente ?? 'IA';
  const rede = NOME_REDE[lista?.conta.rede ?? ''] ?? 'Rede social';

  return (
    <div className={c.tela} data-aberta={aberta ? 'true' : 'false'} data-inbox-rede={conta}>
      <section className={c.lista} aria-label="Conversas">
        <div className={c.listaTopo}>
          <div className={c.listaTitulo}>
            <span className={c.tituloCanal}><h1 className={c.titulo}>Inbox</h1>{seletor}</span>
            <span className={c.contagem}>
              {conversas.length === 1 ? '1 conversa' : `${conversas.length} conversas`}{naoLidas ? ` · ${naoLidas} ${naoLidas === 1 ? 'não lida' : 'não lidas'}` : ''}
            </span>
          </div>
          <label className={c.busca}>
            <span className={c.visivelLeitor}>Buscar conversa</span>
            <Icone nome="busca" tamanho={16} />
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou @usuário" />
          </label>
          {erroLista && <p className={c.subErro}>{erroLista}</p>}
          {mascarado && <p className={c.notaMaster}>Visão da Planee: acesso registrado. Abrir uma conversa não a marca como lida para a equipe.</p>}
        </div>
        <ul className={c.itens}>
          {conversas.map((k) => (
            <li key={k.pessoa_id}>
              <button type="button" className={c.item} aria-current={aberta === k.pessoa_id ? 'true' : undefined} data-pessoa={k.pessoa_id} onClick={() => abrir(k)}>
                <span className={c.avatar} aria-hidden="true">{iniciais(k)}</span>
                <span className={c.itemTexto}>
                  <span className={c.itemLinha}>
                    <span className={k.nao_lidas ? c.itemNomeForte : c.itemNome}>{nomeDe(k)}</span>
                    <span className={c.itemHora}>{datas.lista(k.ultima_em)}</span>
                  </span>
                  <span className={c.itemLinha}>
                    <span className={c.previa}>{k.ultima_direcao === 'saida' ? 'Você: ' : ''}{k.ultima_resumo ?? ''}</span>
                    {k.nao_lidas > 0 && <span className={c.naoLidas} aria-label={`${k.nao_lidas} não lidas`}>{k.nao_lidas}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {lista && !conversas.length && (
          <div className={c.vazio}>{busca.trim() ? 'Nenhuma conversa encontrada.' : `Nenhuma conversa ainda. Quando o ${rede} da empresa receber directs, eles aparecem aqui.`}</div>
        )}
        {!lista && !erroLista && <div className={c.vazio}>Carregando…</div>}
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
                <span aria-hidden="true">←</span><span className={c.voltarTexto}> Voltar</span>
              </button>
              {atual && (
                <>
                  <span className={c.avatarGrande} aria-hidden="true">{iniciais(atual)}</span>
                  <div className={c.cabecaTexto}>
                    <h2 className={c.cabecaNome}>{nomeDe(atual)}</h2>
                    <span className={c.cabecaLinha}>
                      {atual.usuario && <span className={c.arroba}>@{atual.usuario}</span>}
                      <span className={c.tagLinha}>{rede}</span>
                      {!atual.janela_aberta && <span className={c.pilula} data-aberta="false">Janela de 24 h fechada</span>}
                    </span>
                  </div>
                </>
              )}
            </header>
            <Mensagens dados={dados} carregando={carregando} datas={datas} agente={agente} nomeContato={atual ? nomeDe(atual) : 'Pessoa'} />
            {podeResponder
              ? <Resposta conta={conta} pessoa={aberta} janelaAberta={Boolean(atual?.janela_aberta)} onEnviado={() => atualizarAberta(aberta)} />
              : <footer className={c.rodape}>Somente leitura: sua conta não tem a permissão para responder nas redes sociais.</footer>}
          </>
        )}
      </section>
    </div>
  );
}

function Mensagens({ dados, carregando, datas, agente, nomeContato }: {
  dados: ConversaRedeAberta | null; carregando: boolean; datas: ReturnType<typeof criarDatas>; agente: string; nomeContato: string;
}) {
  const rolagem = useRef<HTMLDivElement>(null);
  const ultima = dados?.mensagens.at(-1)?.id;
  useLayoutEffect(() => { const el = rolagem.current; if (el) el.scrollTop = el.scrollHeight; }, [ultima]);
  return (
    <div className={c.mensagens} ref={rolagem}>
      {carregando && <p className={c.carregando}>Carregando a conversa…</p>}
      {dados && !dados.mensagens.length && <p className={c.carregando}>Nenhuma mensagem nesta conversa ainda.</p>}
      {dados?.mensagens.map((m, i) => {
        const novoDia = i === 0 || datas.dia(dados.mensagens[i - 1].em) !== datas.dia(m.em);
        return (
          <div key={m.id} className={c.bloco}>
            {novoDia && <div className={c.dia} role="separator"><span>{datas.separador(m.em)}</span></div>}
            <Bolha m={m} hora={datas.hora(m.em)} agente={agente} nomeContato={nomeContato} />
          </div>
        );
      })}
    </div>
  );
}

function Bolha({ m, hora, agente, nomeContato }: { m: MensagemRede; hora: string; agente: string; nomeContato: string }) {
  const tipo = m.direcao === 'entrada' ? 'entrada' : m.origem === 'ia' ? 'sara' : 'equipe';
  const autor = m.direcao === 'entrada' ? '' : m.origem === 'ia' ? agente : m.origem === 'painel' ? `Painel${m.por ? ' · ' + m.por : ''}` : 'Equipe (app)';
  const rotulo = MIDIA[m.tipo];
  return (
    <div className={c.linha} data-direcao={m.direcao} data-id={m.id} title={m.direcao === 'entrada' ? nomeContato : undefined}>
      {autor && <span className={c.autor} data-tipo={tipo}>{autor}</span>}
      <div className={c.bolha} data-tipo={tipo}>
        {m.texto ? <p className={c.texto}>{m.texto.trim()}</p> : !m.midia_url && <p className={c.semTexto}>{rotulo ?? 'Mensagem sem texto'}</p>}
        {m.midia_url && <a className={c.midiaLink} href={m.midia_url} target="_blank" rel="noopener noreferrer">Abrir {(rotulo ?? 'anexo').toLowerCase()}</a>}
      </div>
      <span className={c.meta}><span className={c.mono}>{hora}</span></span>
    </div>
  );
}

function Resposta({ conta, pessoa, janelaAberta, onEnviado }: { conta: string; pessoa: string; janelaAberta: boolean; onEnviado: () => void }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setTexto(''); setErro(null); }, [pessoa]);
  const desligado = enviando || !janelaAberta;
  async function mandar() {
    const t = texto.trim();
    if (!t || desligado) return;
    setEnviando(true); setErro(null);
    const r = await enviarNaRede(conta, pessoa, t);
    setEnviando(false);
    if (!r.ok) { if (r.sair) window.location.href = '/entrar?motivo=sessao&volta=/inbox'; else setErro(r.erro); return; }
    setTexto('');
    onEnviado();
  }
  return (
    <footer className={c.compositor}>
      {!janelaAberta && <p className={c.foraJanela}>{FORA_DA_JANELA}</p>}
      <div className={c.caixa} data-desligada={janelaAberta ? undefined : 'true'}>
        <label htmlFor="resposta-rede" className={c.visivelLeitor}>Resposta</label>
        <textarea id="resposta-rede" value={texto} maxLength={1000} disabled={desligado}
          placeholder={janelaAberta ? 'Escreva a resposta. Enter envia; Shift+Enter quebra a linha.' : 'Resposta desligada fora da janela de 24 h'}
          onChange={(e) => { setTexto(e.target.value); if (erro) setErro(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); mandar(); } }} />
        <button type="button" className={c.enviar} onClick={mandar} disabled={desligado || !texto.trim()}>{enviando ? 'Enviando…' : 'Enviar'}</button>
      </div>
      {erro && <p className={c.erroEnvio} role="alert">{erro}</p>}
    </footer>
  );
}
