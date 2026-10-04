'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ConversaAberta, Conversa, ListaConversas, Mensagem } from '@/lib/painel/inbox';
import { assumirConversa, devolverConversa, enviarMensagem, renomearContato } from '@/lib/painel/acoes-inbox';
import { abrirConversa, carregarConversas } from '@/lib/painel/leitura-cliente';
import { lembrado, lembrar } from '@/lib/painel/memoria-cliente';
import type { Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { telefoneBonito } from '@/components/crm/util';
import { AvisarPlanee, type AlvoAviso } from '@/components/planee/AvisarPlanee';
import sp from '@/components/planee/planee.module.css';
import c from './inbox.module.css';

// Inbox (fases 1.1, 2.1 e 2.3): lista de conversas à esquerda e a conversa aberta à direita, com a caixa de resposta
// e os botões Assumir / Devolver pra Sara para quem tem inbox.responder. Atualiza a lista e a conversa aberta a cada 10 s, sem tirar a pessoa do ponto
// onde ela rolou. A resposta enviada aparece como "enviando…" até o receptor gravá-la no espelho.

const ATUALIZA_MS = 10000;
type Chave = { numero_id: string; wa_id: string };
type Aberta = Omit<ConversaAberta, 'fuso'>;
type Pendente = { chave: string; wamid: string; texto: string; em: string };
const FORA_DA_JANELA = 'Fora da janela de 24 h: a Meta só permite modelo aprovado. Responda pelo celular ou espere o paciente escrever.';
const chaveDe = (k: Chave) => k.numero_id + ':' + k.wa_id;
// WhatsApp Web oficial da clínica, já na conversa do contato. Fora das 24 h a equipe manda por ali (sem modelo);
// a mensagem volta para a Inbox pelo eco da coexistência e a Sara fica pausada pela regra do celular.
const linkWhatsApp = (waId: string) => `https://web.whatsapp.com/send?phone=${encodeURIComponent(waId)}`;

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

export type PropsInbox = { inicial: ListaConversas; mascarado: boolean; podeResponder: boolean; nome: string; empresaId?: string };

export function Inbox({ inicial, mascarado, podeResponder, nome, empresaId = '' }: PropsInbox) {
  const [lista, setLista] = useState(inicial);
  const inicialRef = useRef(inicial);
  // Memória da aba (lib/painel/memoria-cliente.ts): a lista sem busca e as conversas já abertas aparecem na hora.
  const memLista = `${empresaId}:conversas`;
  const memConversa = useCallback((k: Chave) => `${empresaId}:conversa:${chaveDe(k)}`, [empresaId]);
  const [busca, setBusca] = useState('');
  const [soFollowup, setSoFollowup] = useState(false);
  const filtroRef = useRef<string | null>(null);
  filtroRef.current = soFollowup ? 'followup' : null;
  const [aberta, setAberta] = useState<Chave | null>(null);
  const [dados, setDados] = useState<Aberta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falhouAtualizar, setFalhouAtualizar] = useState(false);
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [mudandoDono, setMudandoDono] = useState(false);
  const [avisando, setAvisando] = useState<AlvoAviso | null>(null);
  const [ok, setOk] = useState<string | null>(null);
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
    const guardada = lembrado<Aberta>(memConversa(k));
    setAberta(k); setDados(guardada ?? null); setCarregando(!guardada); setAviso(null);
    if (guardada) ajuste.current = { tipo: 'fim' };
    // A equipe abriu: as não lidas somem na hora (o servidor confirma em seguida). O master só olha.
    if (!mascarado) setLista((l) => ({ ...l, conversas: l.conversas.map((x) => (mesma(x, k) && x.nao_lidas ? { ...x, nao_lidas: 0 } : x)) }));
    const d = tratar(await abrirConversa(k.numero_id, k.wa_id));
    if (!mesma(abertaRef.current, k)) return;
    setCarregando(false);
    if (!d) return;
    if (guardada) aplicarAtualizacaoRef.current({ conversa: d.conversa, mensagens: d.mensagens, temMais: d.temMais, selo: d.selo });
    else {
      ajuste.current = { tipo: 'fim' };
      setDados({ conversa: d.conversa, mensagens: d.mensagens, temMais: d.temMais, selo: d.selo });
    }
    atualizarLinha(d.conversa);
  }, [tratar, atualizarLinha, memConversa, mascarado]);

  // Leitura antecipada: o mouse parou numa conversa da lista por um instante. Quando a pessoa clica, as mensagens
  // já estão na memória e aparecem na hora. Não marca como lida (quem marca é o clique).
  const antecipando = useRef(new Set<string>());
  const timerPrevia = useRef<number | null>(null);
  const previa = useCallback((k: Chave) => {
    if (timerPrevia.current) window.clearTimeout(timerPrevia.current);
    // O master não antecipa: cada leitura dele vai para a auditoria de acesso, e passar o mouse não é abrir.
    if (mascarado) return;
    const chave = memConversa(k);
    if (lembrado(chave) || antecipando.current.has(chave) || mesma(abertaRef.current, k)) return;
    timerPrevia.current = window.setTimeout(async () => {
      antecipando.current.add(chave);
      const r = await abrirConversa(k.numero_id, k.wa_id, null, true);
      antecipando.current.delete(chave);
      if (r.ok && !lembrado(chave)) lembrar(chave, { conversa: r.dados.conversa, mensagens: r.dados.mensagens, temMais: r.dados.temMais, selo: r.dados.selo });
    }, 150);
  }, [memConversa, mascarado]);
  const cancelarPrevia = useCallback(() => { if (timerPrevia.current) window.clearTimeout(timerPrevia.current); timerPrevia.current = null; }, []);

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
      return { ...x, conversa: d.conversa, mensagens, selo: d.selo };
    });
  }, []);

  const aplicarAtualizacaoRef = useRef(aplicarAtualizacao);
  aplicarAtualizacaoRef.current = aplicarAtualizacao;

  // Guarda na memória da aba a conversa aberta e a lista sem busca (voltar à Inbox ou reabrir mostra na hora).
  useEffect(() => { if (aberta && dados) lembrar(memConversa(aberta), dados); }, [aberta, dados, memConversa]);
  useEffect(() => { if (!busca.trim() && !soFollowup) lembrar(memLista, lista); }, [lista, busca, soFollowup, memLista]);

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
    if (conv.ok && mesma(abertaRef.current, k)) { aplicarAtualizacao(conv.dados); atualizarLinha(conv.dados.conversa); }
    return null;
  }, [aplicarAtualizacao, atualizarLinha]);

  // Assumir (a Sara fica quieta nesta conversa) ou devolver para a Sara.
  const trocarDono = useCallback(async (dono: 'ia' | 'humano') => {
    const k = abertaRef.current;
    if (!k) return;
    setMudandoDono(true); setAviso(null);
    const d = tratar(await (dono === 'humano' ? assumirConversa : devolverConversa)(k.numero_id, k.wa_id));
    setMudandoDono(false);
    if (!d || !mesma(abertaRef.current, k)) return;
    setDados((x) => (x ? { ...x, conversa: d } : x));
    atualizarLinha(d);
  }, [tratar, atualizarLinha]);

  // Link direto para uma conversa (/inbox?numero=...&wa=...): o Interno Planee abre o aviso na conversa certa.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const numero = q.get('numero'); const wa = q.get('wa');
    if (numero && wa && /^\d{5,30}$/.test(numero) && /^\d{8,20}$/.test(wa)) abrir({ numero_id: numero, wa_id: wa });
  }, [abrir]);

  useEffect(() => {
    if (!ok) return;
    const t = window.setTimeout(() => setOk(null), 3500);
    return () => window.clearTimeout(t);
  }, [ok]);

  // Busca no servidor (nome ou dígitos do número), com uma pausa curta enquanto a pessoa digita.
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    const t = window.setTimeout(async () => {
      const r = await carregarConversas(busca, filtroRef.current);
      if (r.ok && buscaRef.current === busca) setLista(r.dados);
      else if (!r.ok) tratar(r);
    }, 300);
    return () => window.clearTimeout(t);
  }, [busca, soFollowup, tratar]);

  // Atualização automática da lista e da conversa aberta, só com a aba do navegador visível.
  useEffect(() => {
    let parado = false;
    const tick = async () => {
      if (parado || document.hidden) return;
      const k = abertaRef.current;
      const [l, conv] = await Promise.all([
        carregarConversas(buscaRef.current, filtroRef.current),
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
    // Lista vinda da memória da aba (voltou à Inbox): mostra na hora e já busca a atual.
    if (Date.now() - new Date(inicialRef.current.lidoEm).getTime() > 3000) tick();
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
          <div className={c.filtros}>
            <button type="button" className={c.filtro} aria-pressed={soFollowup} onClick={() => setSoFollowup((x) => !x)}
              title="Contatos que receberam follow-up da Sara e ainda não responderam">Em follow-up</button>
          </div>
          {falhouAtualizar && <p className={c.subErro}>Sem conexão com o banco agora. Tentando de novo.</p>}
          {mascarado && <p className={c.notaMaster}>Visão da Planee: CPF mascarado, acesso registrado e as não lidas da clínica não mudam.</p>}
        </div>
        <ul className={c.itens}>
          {lista.conversas.map((k) => (
            <li key={k.numero_id + ':' + k.wa_id}>
              <button type="button" className={c.item} aria-current={mesma(k, aberta) ? 'true' : undefined} data-wa={k.wa_id} onClick={() => abrir(k)}
                onMouseEnter={() => previa(k)} onMouseLeave={cancelarPrevia} onFocus={() => previa(k)}>
                <span className={c.avatar} aria-hidden="true">{iniciais(k)}</span>
                <span className={c.itemTexto}>
                  <span className={c.itemLinha}>
                    <span className={k.nao_lidas ? c.itemNomeForte : c.itemNome}>{nomeDe(k)}</span>
                    <span className={c.itemHora}>{datas.lista(k.ultima_em)}</span>
                  </span>
                  <span className={c.itemLinha}>
                    <span className={c.previa}>{k.ultima_direcao === 'saida' ? 'Clínica: ' : ''}{k.ultima_resumo ?? ''}</span>
                    {k.dono === 'humano' && <span className={c.tagEquipe} title={k.dono_por ? `Com a equipe: ${k.dono_por}` : 'Com a equipe'}>Equipe</span>}
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
            {soFollowup ? 'Ninguém em follow-up sem resposta agora.' : busca.trim() ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda. Quando o WhatsApp da empresa receber mensagens, elas aparecem aqui.'}
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
                    {podeResponder ? (
                      <NomeEditavel key={chaveDe(atual)} conversa={atual} onSalvar={async (nome) => {
                        const k = abertaRef.current;
                        if (!k) return 'Abra uma conversa antes.';
                        const r = await renomearContato(k.numero_id, k.wa_id, nome);
                        if (!r.ok) return r.sair ? null : r.erro;
                        if (mesma(abertaRef.current, k)) { setDados((x) => (x ? { ...x, conversa: r.dados } : x)); atualizarLinha(r.dados); }
                        return null;
                      }} />
                    ) : <h2 className={c.cabecaNome}>{nomeDe(atual)}</h2>}
                    <span className={c.cabecaLinha}>
                      <span className={c.mono}>{telefoneBonito(atual.wa_id)}</span>
                      <span className={c.pilula} data-aberta={atual.janela_aberta ? 'true' : 'false'}>
                        {atual.janela_aberta ? 'Janela de 24 h aberta' : 'Janela de 24 h fechada'}
                      </span>
                      <span className={c.dono} data-dono={atual.dono === 'humano' ? 'equipe' : atual.pausa_ate ? 'pausa' : 'sara'}>
                        {atual.dono === 'humano'
                          ? `Equipe atendendo${atual.dono_por ? ' · ' + atual.dono_por : ''}`
                          : atual.pausa_ate ? `Sara pausada até ${datas.hora(atual.pausa_ate)} (resposta pelo celular)` : 'Sara atendendo'}
                      </span>
                      {dados?.selo && (
                        <span className={c.seloAuto} data-selo={dados.selo.tipo} title={`Mensagens automáticas da Sara · desde ${datas.hora(dados.selo.desde)}`}>
                          {dados.selo.texto}
                        </span>
                      )}
                    </span>
                  </div>
                  {podeResponder && (
                    <a className={c.botaoDono} href={linkWhatsApp(atual.wa_id)} target="whatsapp-clinica" rel="noopener noreferrer"
                      title="Abre o WhatsApp Web da clínica nesta conversa. O que você mandar por lá aparece aqui.">
                      Abrir no WhatsApp
                    </a>
                  )}
                  {podeResponder && (
                    <button type="button" className={c.botaoDono} disabled={mudandoDono}
                      onClick={() => trocarDono(atual.dono === 'humano' ? 'ia' : 'humano')}
                      title={atual.dono === 'humano' ? 'A Sara volta a responder esta conversa' : 'A Sara fica quieta nesta conversa até você devolver'}>
                      {mudandoDono ? 'Aguarde…' : atual.dono === 'humano' ? 'Devolver pra Sara' : 'Assumir'}
                    </button>
                  )}
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
                    <Bolha m={m} hora={datas.hora(m.em)} nomeContato={atual ? nomeDe(atual) : 'Contato'}
                      onAvisar={mascarado || !aberta ? undefined : () => setAvisando({
                        numero_id: aberta.numero_id, wa_id: aberta.wa_id, wamid: m.wamid, autor: autorDe(m, atual ? nomeDe(atual) : 'Contato'),
                        trecho: m.texto || (MIDIA[m.tipo] ?? null),
                      })} />
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
              <Compositor key={chaveDe(aberta)} janelaAberta={atual.janela_aberta} onEnviar={enviar} link={linkWhatsApp(atual.wa_id)} />
            )}
          </>
        )}
        {!podeResponder && <footer className={c.rodape}>Somente leitura: sua conta não tem a permissão para responder pelo painel.</footer>}
      </section>

      {avisando && (
        <AvisarPlanee alvo={avisando} onFechar={() => setAvisando(null)}
          onPronto={() => { setAvisando(null); setOk('Aviso enviado para a Planee. A resposta aparece na tela Planee.'); }} />
      )}
      <div className={c.aviso} role="status" aria-live="polite">
        {ok && !aviso && <span className={c.avisoOk}>{ok}</span>}
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

// Nome do contato com lápis: Enter salva, Esc cancela. Vazio volta ao nome do WhatsApp.
function NomeEditavel({ conversa, onSalvar }: { conversa: Conversa; onSalvar: (nome: string) => Promise<string | null> }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(conversa.nome ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async () => {
    if (salvando) return;
    setSalvando(true); setErro(null);
    const e = await onSalvar(valor);
    setSalvando(false);
    if (e) setErro(e); else setEditando(false);
  };
  if (!editando) {
    return (
      <span className={c.nomeLinha}>
        <h2 className={c.cabecaNome}>{nomeDe(conversa)}</h2>
        <button type="button" className={c.lapis} aria-label="Editar o nome do contato" title="Editar o nome do contato"
          onClick={() => { setValor(conversa.nome ?? ''); setErro(null); setEditando(true); }}>✎</button>
      </span>
    );
  }
  return (
    <span className={c.nomeLinha}>
      <label htmlFor="nome-contato" className={c.visivelLeitor}>Nome do contato</label>
      <input id="nome-contato" className={c.nomeCampo} value={valor} maxLength={80} autoFocus disabled={salvando}
        placeholder="Nome do contato (vazio volta ao do WhatsApp)"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); salvar(); } if (e.key === 'Escape') setEditando(false); }} />
      <button type="button" className={c.nomeSalvar} onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      <button type="button" className={c.nomeCancelar} onClick={() => setEditando(false)} disabled={salvando}>Cancelar</button>
      {erro && <span className={c.nomeErro} role="alert">{erro}</span>}
    </span>
  );
}

// Caixa de resposta: Enter envia, Shift+Enter quebra a linha. Fora da janela de 24 h fica desligada, com o motivo.
function Compositor({ janelaAberta, onEnviar, link }: { janelaAberta: boolean; onEnviar: (texto: string) => Promise<string | null>; link: string }) {
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
      {!janelaAberta && (
        <div className={c.foraJanelaBloco}>
          <p className={c.foraJanela}>{FORA_DA_JANELA}</p>
          <a className={c.botaoDono} href={link} target="whatsapp-clinica" rel="noopener noreferrer">Abrir no WhatsApp</a>
        </div>
      )}
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

const autorDe = (m: Mensagem, nomeContato: string) =>
  m.direcao === 'entrada' ? nomeContato : m.origem === 'painel' && m.por ? `Painel · ${m.por}` : AUTOR[m.origem] || 'Clínica';

// Menu "⋯" de cada mensagem. Hoje só "Avisar a Planee"; outras ações entram aqui.
function MenuMensagem({ lado, onAvisar }: { lado: 'esquerda' | 'direita'; onAvisar: () => void }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  return (
    <span className={sp.menuCaixa} ref={caixa}>
      <button type="button" className={sp.menuBotao} aria-label="Opções da mensagem" aria-haspopup="menu" aria-expanded={aberto}
        onClick={() => setAberto((x) => !x)}>⋯</button>
      {aberto && (
        <span className={sp.menu} role="menu" data-lado={lado}>
          <button type="button" role="menuitem" autoFocus onClick={() => { setAberto(false); onAvisar(); }}>Avisar a Planee</button>
        </span>
      )}
    </span>
  );
}

function Bolha({ m, hora, nomeContato, onAvisar }: { m: Mensagem; hora: string; nomeContato: string; onAvisar?: () => void }) {
  const tipoBolha = m.direcao === 'entrada' ? 'entrada' : m.origem === 'api' ? 'sara' : 'equipe';
  const autor = m.origem === 'painel' && m.por ? `Painel · ${m.por}` : AUTOR[m.origem] ?? '';
  const st = m.direcao === 'saida' && m.status ? STATUS[m.status] : undefined;
  const rotMidia = MIDIA[m.tipo];
  let conteudo: React.ReactNode;
  if (m.origem === 'api' && m.tipo === 'desconhecido' && !m.texto) {
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
        {onAvisar && <MenuMensagem lado={m.direcao === 'saida' ? 'direita' : 'esquerda'} onAvisar={onAvisar} />}
      </span>
    </div>
  );
}
