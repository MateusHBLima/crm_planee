'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { Aviso, DetalheAviso } from '@/lib/painel/avisos';
import type { Integracao, Novidade, SaudeEmpresa, SaudeLinha } from '@/lib/painel/planee';
import type { Resposta } from '@/lib/painel/resposta';
import {
  carregarAviso, carregarAvisos, carregarIntegracoes, carregarNovidades, carregarSaude, carregarSaudeEmpresa,
} from '@/lib/painel/leitura-cliente';
import { arquivarNovidade, atualizarAviso, salvarIntegracao, salvarNovidade, verificarAgora } from '@/lib/painel/acoes-planee';
import { Campo, Janela } from '@/components/crm/Formularios';
import c from '@/components/crm/crm.module.css';
import s from './planee.module.css';

// Interno Planee (08/10): a fila de avisos de todas as empresas, a saúde de cada cliente, novidades e manutenções,
// e a validade dos tokens das integrações. Só o master chega aqui (lib/telas.ts e cada leitura conferem).

type Aba = 'avisos' | 'saude' | 'novidades' | 'integracoes';
type EmpresaOpcao = { id: string; nome: string };
type Toast = { tipo: 'ok' | 'erro'; texto: string } | null;

const ESTADO: Record<string, string> = { aberto: 'Aberto', em_analise: 'Em análise', resolvido: 'Resolvido' };
const NIVEL: Record<string, string> = { ok: 'Tudo certo', atencao: 'Atenção', problema: 'Problema' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const dataBr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
function ha(iso: string | null) {
  if (!iso) return 'nunca';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}
const prazoToken = (dias: number) => (dias < 0 ? `vencido há ${-dias} ${dias === -1 ? 'dia' : 'dias'}` : dias === 0 ? 'vence hoje' : `vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`);
// ISO → valor de <input type="datetime-local"> no horário do navegador.
const paraCampo = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const doCampo = (v: string) => (v ? new Date(v).toISOString() : null);
const linkIr = (empresa: string, para: string) => `/ir?empresa=${encodeURIComponent(empresa)}&para=${encodeURIComponent(para)}`;

function useTratar(setToast: (t: Toast) => void) {
  return useCallback(<T,>(r: Resposta<T>, sucesso?: string): T | null => {
    if (!r.ok) {
      if (r.sair) { window.location.href = '/entrar?motivo=sessao&volta=/interno'; return null; }
      setToast({ tipo: 'erro', texto: r.erro });
      return null;
    }
    if (sucesso) setToast({ tipo: 'ok', texto: sucesso });
    return r.dados;
  }, [setToast]);
}

export function Interno({ empresas, nome }: { empresas: EmpresaOpcao[]; nome: string }) {
  const [aba, setAba] = useState<Aba>('avisos');
  const [toast, setToast] = useState<Toast>(null);
  const [versao, setVersao] = useState(0);
  const [verificando, iniciar] = useTransition();
  const tratar = useTratar(setToast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.tipo === 'ok' ? 4000 : 7000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const verificar = () => iniciar(async () => {
    const r = tratar(await verificarAgora());
    if (!r) return;
    const novos = r.tokens + r.silencio + r.falhas;
    setToast({
      tipo: r.sem_banco.length ? 'erro' : 'ok',
      texto: `Verificação feita em ${r.empresas} ${r.empresas === 1 ? 'banco' : 'bancos'}: ${novos} ${novos === 1 ? 'aviso novo' : 'avisos novos'}`
        + ` (tokens ${r.tokens}, números sem mensagens ${r.silencio}, envios falhando ${r.falhas}), ${r.resolvidos} ${r.resolvidos === 1 ? 'resolvido' : 'resolvidos'} sozinhos.`
        + (r.sem_banco.length ? ` Sem resposta do banco: ${r.sem_banco.join(', ')}.` : ''),
    });
    setVersao((v) => v + 1);
  });

  const ABAS: { id: Aba; nome: string }[] = [
    { id: 'avisos', nome: 'Avisos' }, { id: 'saude', nome: 'Saúde dos clientes' },
    { id: 'novidades', nome: 'Novidades e manutenção' }, { id: 'integracoes', nome: 'Integrações' },
  ];
  return (
    <div className={s.tela}>
      <header className={s.topo}>
        <div className={s.titulos}>
          <p className={s.rotulo}>Planee</p>
          <h1 className={s.titulo}>Interno Planee</h1>
          <p className={s.sub}>Avisos das equipes e do sistema de todos os clientes, numa fila só. O vigia confere tokens, números e envios de 15 em 15 minutos.</p>
        </div>
        <button type="button" className={s.botaoSec} onClick={verificar} disabled={verificando}>{verificando ? 'Verificando…' : 'Verificar agora'}</button>
      </header>
      <div className={s.abas} role="tablist" aria-label="Partes do Interno Planee">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" id={`aba-${a.id}`} aria-selected={aba === a.id} aria-controls={`painel-${a.id}`} className={s.aba} onClick={() => setAba(a.id)}>
            {a.nome}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {aba === 'avisos' && <Avisos empresas={empresas} nome={nome} versao={versao} tratar={tratar} />}
        {aba === 'saude' && <Saude versao={versao} tratar={tratar} />}
        {aba === 'novidades' && <Novidades empresas={empresas} versao={versao} tratar={tratar} />}
        {aba === 'integracoes' && <Integracoes empresas={empresas} versao={versao} tratar={tratar} />}
      </div>
      {toast && <div className={s.toast} data-tipo={toast.tipo} role={toast.tipo === 'erro' ? 'alert' : 'status'}>{toast.texto}</div>}
    </div>
  );
}

type Tratar = ReturnType<typeof useTratar>;

// ---------------- Avisos ----------------

function Avisos({ empresas, nome, versao, tratar }: { empresas: EmpresaOpcao[]; nome: string; versao: number; tratar: Tratar }) {
  const [estado, setEstado] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [lista, setLista] = useState<Aviso[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const d = tratar(await carregarAvisos(estado || null, empresa || null));
    if (d) setLista(d);
  }, [estado, empresa, tratar]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  // A fila se atualiza sozinha enquanto a aba do navegador está visível.
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) carregar(); }, 30000);
    return () => window.clearInterval(t);
  }, [carregar]);
  return (
    <section className={s.secao}>
      <div className={s.filtros}>
        <label>Mostrar
          <select id="filtro-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Abertos e em análise</option>
            <option value="aberto">Só abertos</option>
            <option value="em_analise">Só em análise</option>
            <option value="resolvido">Resolvidos</option>
            <option value="todos">Todos</option>
          </select>
        </label>
        <label>Empresa
          <select id="filtro-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Todas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <span className={s.espaco} />
        {lista && <span className={s.itemMeta}>{lista.length} {lista.length === 1 ? 'aviso' : 'avisos'}</span>}
      </div>
      {!lista ? <div className={s.vazio}>Carregando…</div> : !lista.length ? <div className={s.vazio}>Nenhum aviso aqui. Tudo em dia.</div> : (
        <ul className={s.lista} aria-label="Fila de avisos">
          {lista.map((a) => (
            <li key={a.id}>
              <button type="button" className={s.item} data-aviso={a.id} onClick={() => setAberto(a.id)}>
                <span className={s.itemLinha}>
                  <span className={s.selo} data-estado={a.estado}>{ESTADO[a.estado]}</span>
                  <span className={s.selo} data-origem={a.origem}>{a.origem === 'sistema' ? 'Automático' : 'Equipe'}</span>
                  <span className={s.itemTitulo}>{a.empresa_nome ?? a.empresa_id}</span>
                  <span className={s.itemMeta}>{a.tipo_nome}</span>
                  <span className={s.espaco} />
                  <span className={s.itemMeta}>{a.responsavel ? `com ${a.responsavel} · ` : ''}{dataHora(a.criado_em)}</span>
                </span>
                <span className={s.comentario}>{a.titulo}{a.criado_por ? ` — ${a.criado_por}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {aberto && <DetalheDoAviso key={aberto} id={aberto} nome={nome} tratar={tratar} onFechar={() => setAberto(null)} onSalvo={carregar} />}
    </section>
  );
}

function DetalheDoAviso({ id, nome, tratar, onFechar, onSalvo }: { id: string; nome: string; tratar: Tratar; onFechar: () => void; onSalvo: () => void }) {
  const [d, setD] = useState<DetalheAviso | null>(null);
  const [f, setF] = useState({ estado: 'aberto', responsavel: '', resposta: '' });
  const [salvando, iniciar] = useTransition();
  const preencher = (x: DetalheAviso) => {
    setD(x);
    setF({ estado: x.aviso.estado, responsavel: x.aviso.responsavel ?? '', resposta: x.aviso.resposta ?? '' });
  };
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    carregarAviso(id).then((r) => { const x = tratar(r); if (x) preencher(x); else fechar.current(); });
  }, [id, tratar]);
  if (!d) return <Janela titulo="Aviso" onFechar={onFechar}><p className={s.itemMeta}>Carregando…</p></Janela>;
  const a = d.aviso;
  const salvar = (extra?: Partial<typeof f>) => iniciar(async () => {
    const v = { ...f, ...extra };
    const mudou: { estado?: string; responsavel?: string; resposta?: string } = {};
    if (v.estado !== a.estado) mudou.estado = v.estado;
    if (v.responsavel.trim() !== (a.responsavel ?? '')) mudou.responsavel = v.responsavel;
    if (v.resposta.trim() !== (a.resposta ?? '')) mudou.resposta = v.resposta;
    if (!Object.keys(mudou).length) { onFechar(); return; }
    const x = tratar(await atualizarAviso(a.id, mudou), 'Aviso salvo.');
    if (x) { preencher(x); onSalvo(); }
  });
  const ref = a.ref as { alvo?: string; alvo_id?: string; pagamento_id?: string; numero_id?: string };
  return (
    <Janela titulo={`${a.tipo_nome} · ${a.empresa_nome ?? a.empresa_id}`} onFechar={onFechar}>
      <div className={c.formJanela}>
        <div className={s.itemLinha}>
          <span className={s.selo} data-estado={a.estado}>{ESTADO[a.estado]}</span>
          <span className={s.selo} data-origem={a.origem}>{a.origem === 'sistema' ? 'Automático' : 'Equipe'}</span>
          <span className={s.itemMeta}>{a.criado_por ? `${a.criado_por} · ` : ''}{dataHora(a.criado_em)}</span>
        </div>
        <div className={s.bloco}>
          <p className={s.blocoTitulo}>Aviso</p>
          <p className={s.comentario}>{a.titulo}</p>
        </div>
        {d.comentario && (
          <div className={s.bloco}>
            <p className={s.blocoTitulo}>Comentário da equipe</p>
            <p className={s.comentario}>{d.comentario}</p>
          </div>
        )}
        {d.trecho && (
          <div className={s.bloco}>
            <p className={s.blocoTitulo}>Mensagem</p>
            <p className={s.trecho}>{d.trecho}</p>
          </div>
        )}
        {(d.numero_id && d.wa_id) || (ref.alvo === 'cartao' && ref.alvo_id) ? (
          <div className={s.links}>
            {d.numero_id && d.wa_id && <a href={linkIr(a.empresa_id, `/inbox?numero=${d.numero_id}&wa=${d.wa_id}`)}>Abrir a conversa na Inbox</a>}
            {ref.alvo === 'cartao' && ref.alvo_id && <a href={linkIr(a.empresa_id, `/crm?cartao=${ref.alvo_id}`)}>Abrir o cartão no CRM</a>}
          </div>
        ) : null}
        <form className={c.formJanela} onSubmit={(e) => { e.preventDefault(); salvar(); }}>
          <Campo id="aviso-estado" rotulo="Estado">
            <select id="aviso-estado" value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
              <option value="aberto">Aberto</option>
              <option value="em_analise">Em análise</option>
              <option value="resolvido">Resolvido</option>
            </select>
          </Campo>
          <Campo id="aviso-responsavel" rotulo="Quem da Planee está cuidando">
            <input id="aviso-responsavel" value={f.responsavel} maxLength={80} onChange={(e) => setF({ ...f, responsavel: e.target.value })} placeholder={nome} />
          </Campo>
          <Campo id="aviso-resposta" rotulo="Resposta para a clínica" dica={a.origem === 'equipe' ? 'A equipe da clínica vê esta resposta na tela Planee.' : 'Aviso automático: a resposta fica só aqui.'}>
            <textarea id="aviso-resposta" value={f.resposta} maxLength={2000} rows={4} onChange={(e) => setF({ ...f, resposta: e.target.value })} />
          </Campo>
          {a.respondido_em && <p className={s.itemMeta}>Respondido por {a.respondido_por ?? '—'} em {dataHora(a.respondido_em)}</p>}
          <div className={c.acoesFim}>
            {a.estado === 'aberto' && !a.responsavel && (
              <button type="button" className={c.acaoSec} disabled={salvando} onClick={() => salvar({ estado: 'em_analise', responsavel: nome })}>Assumir</button>
            )}
            <button type="submit" className={c.acaoPri} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </div>
    </Janela>
  );
}

// ---------------- Saúde ----------------

function Saude({ versao, tratar }: { versao: number; tratar: Tratar }) {
  const [linhas, setLinhas] = useState<SaudeLinha[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [carregando, iniciar] = useTransition();
  const carregar = useCallback(() => iniciar(async () => { const d = tratar(await carregarSaude()); if (d) setLinhas(d); }), [tratar]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  return (
    <section className={s.secao}>
      <div className={s.filtros}>
        <span className={s.itemMeta}>Uma linha por cliente. Clique para ver o detalhe da empresa.</span>
        <span className={s.espaco} />
        <button type="button" className={`${s.botaoSec} ${s.peq}`} onClick={carregar} disabled={carregando}>{carregando ? 'Atualizando…' : 'Atualizar'}</button>
      </div>
      {!linhas ? <div className={s.vazio}>Carregando…</div> : (
        <div className={s.tabelaCaixa}>
          <table className={s.tabela} aria-label="Saúde dos clientes">
            <thead>
              <tr>
                <th>Cliente</th><th>Situação</th><th>Última mensagem recebida</th>
                <th className={s.num}>Recebidas 24 h</th><th className={s.num}>Enviadas 24 h</th><th className={s.num}>Falhas 24 h</th>
                <th className={s.num}>Avisos abertos</th><th>Token</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} data-clica="true" data-empresa={l.id} tabIndex={0} onClick={() => setAberta(l.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberta(l.id); } }}>
                  <td><span className={s.nomeEmpresa}><span className={s.ponto} data-nivel={l.nivel} title={NIVEL[l.nivel]} />{l.nome}</span></td>
                  <td>
                    {l.motivos.length ? <ul className={s.motivos}>{l.motivos.map((m) => <li key={m}>{m}</li>)}</ul> : <span className={s.itemMeta}>{NIVEL[l.nivel]}</span>}
                  </td>
                  <td>{l.banco === 'erro' ? '—' : ha(l.ultima_entrada)}</td>
                  <td className={s.num}>{l.entradas_24h ?? '—'}</td>
                  <td className={s.num}>{l.saidas_24h ?? '—'}</td>
                  <td className={s.num}>{l.falhas_24h ?? '—'}</td>
                  <td className={s.num}>{l.avisos_abertos + l.avisos_sistema_abertos}{l.avisos_em_analise ? ` (+${l.avisos_em_analise} em análise)` : ''}</td>
                  <td>{l.token ? `${l.token.rotulo || l.token.sistema}: ${prazoToken(l.token.dias)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aberta && <DetalheSaude key={aberta} id={aberta} tratar={tratar} onFechar={() => setAberta(null)} />}
    </section>
  );
}

function DetalheSaude({ id, tratar, onFechar }: { id: string; tratar: Tratar; onFechar: () => void }) {
  const [d, setD] = useState<SaudeEmpresa | null>(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => { carregarSaudeEmpresa(id).then((r) => { const x = tratar(r); if (x) setD(x); else fechar.current(); }); }, [id, tratar]);
  if (!d) return <Janela titulo="Saúde da empresa" onFechar={onFechar}><p className={s.itemMeta}>Carregando…</p></Janela>;
  const l = d.linha;
  return (
    <Janela titulo={`Saúde · ${l.nome}`} onFechar={onFechar}>
      <div className={c.formJanela}>
        <div className={s.itemLinha}>
          <span className={s.ponto} data-nivel={l.nivel} />
          <strong>{NIVEL[l.nivel]}</strong>
          {l.banco_erro && <span className={s.itemMeta}>{l.banco_erro}</span>}
        </div>
        {l.motivos.length > 0 && <ul className={s.motivos}>{l.motivos.map((m) => <li key={m}>{m}</li>)}</ul>}
        <div className={s.bloco}>
          <p className={s.blocoTitulo}>Números de WhatsApp (últimos 7 dias)</p>
          {!d.numeros.length ? <p className={s.itemMeta}>Nenhuma mensagem nos últimos 7 dias.</p> : (
            <div className={s.tabelaCaixa}>
              <table className={s.tabela}>
                <thead><tr><th>Número</th><th>Última recebida</th><th className={s.num}>24 h (rec./env./falhas)</th><th className={s.num}>Recebidas 7 dias</th></tr></thead>
                <tbody>
                  {d.numeros.map((n) => (
                    <tr key={n.numero_id}>
                      <td>{n.nome ?? <span className={s.mono}>id ••{n.numero_id.slice(-4)}</span>}</td>
                      <td>{ha(n.ultima_entrada)}</td>
                      <td className={s.num}>{n.entradas_24h} / {n.saidas_24h} / {n.falhas_24h}</td>
                      <td className={s.num}>{n.entradas_7d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {d.falhas.length > 0 && (
          <div className={s.bloco}>
            <p className={s.blocoTitulo}>Últimos envios que falharam</p>
            <ul className={s.motivos}>
              {d.falhas.map((f, i) => <li key={i}>{dataHora(f.em)} · {f.codigo ? `erro ${f.codigo}` : 'sem código'}{f.titulo ? `: ${f.titulo}` : ''}</li>)}
            </ul>
          </div>
        )}
        <div className={s.bloco}>
          <p className={s.blocoTitulo}>Integrações</p>
          {!d.integracoes.length ? <p className={s.itemMeta}>Nenhuma integração cadastrada (aba Integrações).</p> : (
            <ul className={s.motivos}>
              {d.integracoes.map((i) => (
                <li key={i.id}>{i.rotulo || i.sistema}: {i.token_valido_ate ? `token até ${dataBr(i.token_valido_ate)} (${prazoToken(i.dias ?? 0)})` : 'sem validade cadastrada'}{i.ativo ? '' : ' · desligada'}</li>
              ))}
            </ul>
          )}
        </div>
        <div className={s.bloco}>
          <p className={s.blocoTitulo}>Avisos recentes</p>
          {!d.avisos.length ? <p className={s.itemMeta}>Nenhum aviso.</p> : (
            <ul className={s.motivos}>
              {d.avisos.map((a) => <li key={a.id}><span className={s.selo} data-estado={a.estado}>{ESTADO[a.estado]}</span> {a.tipo_nome}: {a.titulo} · {dataHora(a.criado_em)}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Janela>
  );
}

// ---------------- Novidades e manutenção ----------------

const NOVA = { id: '', tipo: 'novidade', titulo: '', texto: '', empresa_id: '', inicio: '', fim: '' };

function Novidades({ empresas, versao, tratar }: { empresas: EmpresaOpcao[]; versao: number; tratar: Tratar }) {
  const [lista, setLista] = useState<Novidade[] | null>(null);
  const [f, setF] = useState(NOVA);
  const [ocupado, iniciar] = useTransition();
  useEffect(() => { carregarNovidades().then((r) => { const d = tratar(r); if (d) setLista(d); }); }, [versao, tratar]);
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const publicar = () => iniciar(async () => {
    const d = tratar(await salvarNovidade({ id: f.id || null, tipo: f.tipo, titulo: f.titulo, texto: f.texto, empresa_id: f.empresa_id || null,
      inicio: doCampo(f.inicio), fim: doCampo(f.fim) }), f.id ? 'Novidade salva.' : 'Publicado.');
    if (d) { setLista(d); setF(NOVA); }
  });
  const arquivar = (n: Novidade) => iniciar(async () => {
    const d = tratar(await arquivarNovidade(n.id, !n.arquivado), n.arquivado ? 'Voltou a aparecer.' : 'Arquivada: não aparece mais para as empresas.');
    if (d) setLista(d);
  });
  return (
    <section className={s.secao}>
      <form className={s.form} aria-label={f.id ? 'Editar novidade' : 'Publicar novidade ou manutenção'} onSubmit={(e) => { e.preventDefault(); publicar(); }}>
        <Campo id="nov-tipo" rotulo="Tipo">
          <select id="nov-tipo" value={f.tipo} onChange={mudar('tipo')}>
            <option value="novidade">Novidade</option>
            <option value="manutencao">Manutenção</option>
          </select>
        </Campo>
        <Campo id="nov-empresa" rotulo="Para quem">
          <select id="nov-empresa" value={f.empresa_id} onChange={mudar('empresa_id')}>
            <option value="">Todas as empresas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>Só {e.nome}</option>)}
          </select>
        </Campo>
        <Campo id="nov-inicio" rotulo="Início" dica="Vazio: agora.">
          <input id="nov-inicio" type="datetime-local" value={f.inicio} onChange={mudar('inicio')} />
        </Campo>
        <Campo id="nov-fim" rotulo="Fim" dica={f.tipo === 'manutencao' ? 'A faixa some depois do fim.' : 'Opcional.'}>
          <input id="nov-fim" type="datetime-local" value={f.fim} onChange={mudar('fim')} />
        </Campo>
        <div className={s.formLargo}>
          <Campo id="nov-titulo" rotulo="Título">
            <input id="nov-titulo" value={f.titulo} onChange={mudar('titulo')} maxLength={120} required minLength={3} />
          </Campo>
        </div>
        <div className={s.formLargo}>
          <Campo id="nov-texto" rotulo="Texto">
            <textarea id="nov-texto" value={f.texto} onChange={mudar('texto')} maxLength={2000} rows={3} required />
          </Campo>
        </div>
        <div className={s.formAcoes}>
          {f.id && <button type="button" className={s.botaoSec} onClick={() => setF(NOVA)}>Cancelar edição</button>}
          <button type="submit" className={s.botao} disabled={ocupado}>{ocupado ? 'Salvando…' : f.id ? 'Salvar' : 'Publicar'}</button>
        </div>
      </form>
      {!lista ? <div className={s.vazio}>Carregando…</div> : !lista.length ? <div className={s.vazio}>Nada publicado ainda.</div> : (
        <ul className={s.lista} aria-label="Novidades publicadas">
          {lista.map((n) => (
            <li key={n.id} className={s.item} data-novidade={n.id}>
              <div className={s.itemLinha}>
                <span className={s.selo} data-tipo={n.tipo}>{n.tipo === 'manutencao' ? 'Manutenção' : 'Novidade'}</span>
                <span className={s.itemTitulo}>{n.titulo}</span>
                <span className={s.itemMeta}>{n.empresa_nome ? `só ${n.empresa_nome}` : 'todas as empresas'}{n.arquivado ? ' · arquivada' : ''}</span>
                <span className={s.espaco} />
                <span className={s.itemMeta}>{dataHora(n.inicio)}{n.fim ? ` até ${dataHora(n.fim)}` : ''}</span>
                <button type="button" className={`${s.botaoSec} ${s.peq}`} disabled={ocupado}
                  onClick={() => setF({ id: n.id, tipo: n.tipo, titulo: n.titulo, texto: n.texto, empresa_id: n.empresa_id ?? '', inicio: paraCampo(n.inicio), fim: paraCampo(n.fim) })}>Editar</button>
                <button type="button" className={`${s.botaoSec} ${s.peq}`} disabled={ocupado} onClick={() => arquivar(n)}>{n.arquivado ? 'Reativar' : 'Arquivar'}</button>
              </div>
              <p className={s.comentario}>{n.texto}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- Integrações ----------------

const NOVA_INT = { empresa_id: '', sistema: '', rotulo: '', token_valido_ate: '', observacao: '', ativo: true };

function Integracoes({ empresas, versao, tratar }: { empresas: EmpresaOpcao[]; versao: number; tratar: Tratar }) {
  const [lista, setLista] = useState<Integracao[] | null>(null);
  const [f, setF] = useState(NOVA_INT);
  const [editando, setEditando] = useState(false);
  const [ocupado, iniciar] = useTransition();
  useEffect(() => { carregarIntegracoes().then((r) => { const d = tratar(r); if (d) setLista(d); }); }, [versao, tratar]);
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const salvar = () => iniciar(async () => {
    const d = tratar(await salvarIntegracao({ ...f, rotulo: f.rotulo || null, token_valido_ate: f.token_valido_ate || null, observacao: f.observacao || null }), 'Integração salva.');
    if (d) { setLista(d); setF(NOVA_INT); setEditando(false); }
  });
  return (
    <section className={s.secao}>
      <p className={s.sub}>Validade do token de API de cada integração (ex.: Feegow). A partir de 30 dias antes, o vigia abre um aviso e lembra a cada 3 dias até a data ser atualizada aqui.</p>
      <form className={s.form} aria-label="Integração" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        <Campo id="int-empresa" rotulo="Empresa">
          <select id="int-empresa" value={f.empresa_id} onChange={mudar('empresa_id')} required disabled={editando}>
            <option value="" disabled>Escolha</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo id="int-sistema" rotulo="Sistema" dica="Ex.: feegow">
          <input id="int-sistema" value={f.sistema} onChange={mudar('sistema')} maxLength={40} required disabled={editando} />
        </Campo>
        <Campo id="int-rotulo" rotulo="Nome para mostrar">
          <input id="int-rotulo" value={f.rotulo} onChange={mudar('rotulo')} maxLength={80} placeholder="Feegow" />
        </Campo>
        <Campo id="int-validade" rotulo="Token válido até">
          <input id="int-validade" type="date" value={f.token_valido_ate} onChange={mudar('token_valido_ate')} />
        </Campo>
        <div className={s.formLargo}>
          <Campo id="int-obs" rotulo="Observação" dica="Sem o token: ele fica só no cofre de segredos.">
            <input id="int-obs" value={f.observacao} onChange={mudar('observacao')} maxLength={500} />
          </Campo>
        </div>
        <div className={s.formAcoes}>
          <label className={s.check}><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativa (o vigia confere)</label>
          <span className={s.espaco} />
          {editando && <button type="button" className={s.botaoSec} onClick={() => { setF(NOVA_INT); setEditando(false); }}>Cancelar edição</button>}
          <button type="submit" className={s.botao} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar integração'}</button>
        </div>
      </form>
      {!lista ? <div className={s.vazio}>Carregando…</div> : !lista.length ? <div className={s.vazio}>Nenhuma integração cadastrada.</div> : (
        <div className={s.tabelaCaixa}>
          <table className={s.tabela} aria-label="Integrações">
            <thead><tr><th>Empresa</th><th>Sistema</th><th>Token válido até</th><th>Situação</th><th>Atualizado</th><th /></tr></thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} data-integracao={`${i.empresa_id}:${i.sistema}`}>
                  <td>{i.empresa_nome ?? i.empresa_id}</td>
                  <td>{i.rotulo || i.sistema}{i.rotulo ? <span className={s.itemMeta}> ({i.sistema})</span> : null}</td>
                  <td>{i.token_valido_ate ? dataBr(i.token_valido_ate) : '—'}</td>
                  <td>{!i.ativo ? 'Desligada' : i.dias === null ? 'Sem validade' : prazoToken(i.dias)}</td>
                  <td className={s.itemMeta}>{i.atualizado_por ?? '—'} · {dataHora(i.atualizado_em)}</td>
                  <td>
                    <button type="button" className={`${s.botaoSec} ${s.peq}`} onClick={() => {
                      setEditando(true);
                      setF({ empresa_id: i.empresa_id, sistema: i.sistema, rotulo: i.rotulo ?? '', token_valido_ate: i.token_valido_ate ?? '', observacao: i.observacao ?? '', ativo: i.ativo });
                    }}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
