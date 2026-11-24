'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TelaAgenda } from '@/lib/painel/agenda-propria';
import type { Agendamento } from '@/lib/api/agenda';
import { carregarAgendaPropria } from '@/lib/painel/leitura-cliente';
import { alterarNaAgenda, horariosDaAgenda, marcarNaAgenda } from '@/lib/painel/acoes-agenda-propria';
import { ConfigAgenda } from './ConfigAgenda';
import { Painel, isoDe, partes } from './comum';
import c from './propria.module.css';

// Agenda própria (23/11): semana (colunas = dias) ou dia (colunas = profissionais), como o Google Agenda. Clicar num
// horário vazio marca; clicar num agendamento abre o detalhe (confirmar, atendido, faltou, remarcar, cancelar).
// As regras de vaga são as mesmas da IA (lib/api/agenda.ts). Atualiza sozinha a cada 30 s.

const PX_HORA = 56;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const STATUS: Record<string, string> = { agendado: 'Agendado', confirmado: 'Confirmado', atendido: 'Atendido', faltou: 'Faltou', cancelado: 'Cancelado' };
const CORES = ['#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#4f46e5', '#65a30d'];

const somaDias = (dia: string, n: number) => new Date(Date.parse(dia + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dowDe = (dia: string) => new Date(dia + 'T12:00:00Z').getUTCDay();
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const minutos = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const reais = (v: number | null) => (v === null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fone = (t: string | null) => (t ? t.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '');

type Coluna = { chave: string; dia: string; profissional: string | null; rotulo: string; hoje: boolean };
type Novo = { dia: string; hora: string; profissional: string | null };

export function AgendaPropria() {
  const [hoje] = useState(() => partes(Date.now(), 'America/Sao_Paulo').dia);
  const [ancora, setAncora] = useState(hoje);
  const [vista, setVista] = useState<'semana' | 'dia'>('semana');
  const [filtro, setFiltro] = useState<string>('');
  const [dados, setDados] = useState<TelaAgenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Agendamento | null>(null);
  const [novo, setNovo] = useState<Novo | null>(null);
  const [config, setConfig] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const inicioSemana = useMemo(() => somaDias(ancora, -((dowDe(ancora) + 6) % 7)), [ancora]); // segunda-feira
  const de = vista === 'semana' ? inicioSemana : ancora;
  const ate = vista === 'semana' ? somaDias(inicioSemana, 6) : ancora;

  const carregar = useCallback(async () => {
    const r = await carregarAgendaPropria(de, ate);
    if (r.ok) { setDados(r.dados); setErro(null); }
    else if (r.sair) window.location.href = '/entrar?motivo=sessao&volta=/agenda';
    else setErro(r.erro);
  }, [de, ate]);
  useEffect(() => { carregar(); const i = window.setInterval(carregar, 30000); return () => window.clearInterval(i); }, [carregar]);

  const fuso = dados?.fuso ?? 'America/Sao_Paulo';
  const profs = dados?.profissionais ?? [];
  const corProf = (id: string) => profs.find((p) => p.id === id)?.cor || CORES[Math.max(0, profs.findIndex((p) => p.id === id)) % CORES.length];
  const visiveis = filtro ? profs.filter((p) => p.id === filtro) : profs;

  const colunas: Coluna[] = vista === 'semana'
    ? Array.from({ length: 7 }, (_, i) => {
      const dia = somaDias(inicioSemana, i);
      return { chave: dia, dia, profissional: filtro || null, rotulo: `${DIAS[dowDe(dia)]} ${dia.slice(8)}/${dia.slice(5, 7)}`, hoje: dia === hoje };
    })
    : (visiveis.length ? visiveis : [{ id: '', nome: 'Sem profissional' }]).map((p) => ({ chave: p.id || 'x', dia: ancora, profissional: p.id || null, rotulo: p.nome, hoje: ancora === hoje }));

  // Faixa de horas: da menor hora de início da grade à maior de fim (padrão 8 h às 19 h), sempre cobrindo os agendamentos.
  const [hIni, hFim] = useMemo(() => {
    let ini = 8 * 60; let fim = 19 * 60;
    for (const g of dados?.grade ?? []) { ini = Math.min(ini, minutos(g.inicio)); fim = Math.max(fim, minutos(g.fim)); }
    for (const a of dados?.agendamentos ?? []) { const p = partes(a.inicio, fuso); const q = partes(a.fim, fuso); ini = Math.min(ini, p.hora * 60); fim = Math.max(fim, q.hora * 60 + (q.minuto ? 60 : 0)); }
    return [Math.floor(ini / 60), Math.min(24, Math.ceil(fim / 60))];
  }, [dados, fuso]);
  const altura = (hFim - hIni) * PX_HORA;
  const topo = (h: number, m: number) => ((h - hIni) * 60 + m) * (PX_HORA / 60);

  const titulo = vista === 'semana'
    ? `${new Date(inicioSemana + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' })} a ${new Date(somaDias(inicioSemana, 6) + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
    : new Date(ancora + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const andar = (n: number) => setAncora((d) => somaDias(d, n * (vista === 'semana' ? 7 : 1)));

  // Clique numa coluna vazia: horário arredondado para 30 min.
  function clicarVazio(col: Coluna, y: number) {
    if (!dados?.podeEditar) return;
    const min = Math.max(0, Math.floor((y / (PX_HORA / 60)) / 30) * 30) + hIni * 60;
    setNovo({ dia: col.dia, hora: hhmm(Math.floor(min / 60), min % 60), profissional: col.profissional });
  }

  const semCadastro = dados && (!dados.profissionais.length || !dados.tipos.length);

  return (
    <div className={c.tela} data-agenda-propria>
      <div className={c.topo}>
        <h1 className={c.titulo}>Agenda</h1>
        <button type="button" className={c.botaoSec} onClick={() => setAncora(hoje)}>Hoje</button>
        <div className={c.grupo}>
          <button type="button" onClick={() => andar(-1)} aria-label="Anterior">‹</button>
          <button type="button" onClick={() => andar(1)} aria-label="Próximo">›</button>
        </div>
        <span className={c.periodo} data-periodo>{titulo}</span>
        <span className={c.espaco} />
        <select className={c.seletor} value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Profissional" data-filtro-profissional>
          <option value="">Todos os profissionais</option>
          {profs.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <div className={c.grupo}>
          <button type="button" aria-pressed={vista === 'dia'} onClick={() => setVista('dia')}>Dia</button>
          <button type="button" aria-pressed={vista === 'semana'} onClick={() => setVista('semana')}>Semana</button>
        </div>
        {dados?.podeEditar && <button type="button" className={c.botao} onClick={() => setNovo({ dia: ancora, hora: '09:00', profissional: filtro || null })} data-novo-agendamento>+ Novo</button>}
        {dados?.podeConfig && <button type="button" className={c.botaoSec} onClick={() => setConfig(true)} data-configurar-agenda>Configurar</button>}
      </div>
      {erro && <p className={c.erro} role="alert">{erro}</p>}
      {aviso && <p className={c.ok} role="status">{aviso}</p>}
      {semCadastro && (
        <p className={c.aviso}>{dados?.podeConfig ? 'Comece em Configurar: cadastre quem atende, os tipos de atendimento e os horários.' : 'A agenda ainda não foi configurada. Avise quem administra o painel.'}</p>
      )}

      <div className={c.grade} style={{ gridTemplateColumns: '1fr' }}>
        <div className={c.cabecalho} style={{ gridTemplateColumns: `56px repeat(${colunas.length}, minmax(110px, 1fr))` }}>
          <span />
          {colunas.map((col) => <span key={col.chave} className={c.cabCelula} data-hoje={col.hoje ? 'true' : undefined}>{col.rotulo}</span>)}
        </div>
        <div className={c.corpo} style={{ gridTemplateColumns: `56px repeat(${colunas.length}, minmax(110px, 1fr))`, height: altura }}>
          <div className={c.horas}>
            {Array.from({ length: hFim - hIni }, (_, i) => i > 0 && <span key={i} className={c.hora} style={{ top: i * PX_HORA }}>{hhmm(hIni + i, 0)}</span>)}
          </div>
          {colunas.map((col) => (
            <ColunaAgenda key={col.chave} col={col} dados={dados} fuso={fuso} altura={altura} hIni={hIni} hFim={hFim} topo={topo}
              corProf={corProf} onVazio={(y) => clicarVazio(col, y)} onAbrir={setAberto} />
          ))}
        </div>
      </div>

      {aberto && dados && (
        <Detalhe a={aberto} dados={dados} fuso={fuso} onFechar={() => setAberto(null)}
          onFeito={(txt) => { setAberto(null); setAviso(txt); window.setTimeout(() => setAviso(null), 4000); carregar(); }} />
      )}
      {novo && dados && (
        <NovoAgendamento inicial={novo} dados={dados} fuso={fuso} onFechar={() => setNovo(null)}
          onFeito={(txt) => { setNovo(null); setAviso(txt); window.setTimeout(() => setAviso(null), 4000); carregar(); }} />
      )}
      {config && dados && <ConfigAgenda dados={dados} onFechar={() => { setConfig(false); carregar(); }} onMudou={carregar} />}
    </div>
  );
}

function ColunaAgenda({ col, dados, fuso, altura, hIni, hFim, topo, corProf, onVazio, onAbrir }: {
  col: Coluna; dados: TelaAgenda | null; fuso: string; altura: number; hIni: number; hFim: number; topo: (h: number, m: number) => number;
  corProf: (id: string) => string; onVazio: (y: number) => void; onAbrir: (a: Agendamento) => void;
}) {
  const dow = dowDe(col.dia);
  // Períodos de atendimento desta coluna (grade do profissional, ou de qualquer um na semana com "todos").
  const janelas = (dados?.grade ?? []).filter((g) => g.dia_semana === dow && (!col.profissional || g.profissional_id === col.profissional))
    .map((g) => [minutos(g.inicio), minutos(g.fim)] as const).sort((a, b) => a[0] - b[0]);
  const fora: [number, number][] = [];
  let cursor = hIni * 60;
  for (const [i, f] of janelas) { if (i > cursor) fora.push([cursor, i]); cursor = Math.max(cursor, f); }
  if (cursor < hFim * 60) fora.push([cursor, hFim * 60]);
  const doDia = (dados?.agendamentos ?? []).filter((a) => partes(a.inicio, fuso).dia === col.dia && (!col.profissional || a.profissional_id === col.profissional));
  const bloqueios = (dados?.bloqueios ?? []).filter((b) => (!col.profissional || !b.profissional_id || b.profissional_id === col.profissional)
    && partes(b.inicio, fuso).dia <= col.dia && partes(b.fim, fuso).dia >= col.dia);
  const agora = partes(Date.now(), fuso);
  return (
    <div className={c.coluna} style={{ height: altura }} data-coluna={col.dia + (col.profissional ? ':' + col.profissional : '')}>
      {Array.from({ length: hFim - hIni }, (_, i) => (
        <span key={i}><span className={c.linhaHora} style={{ top: i * PX_HORA }} /><span className={c.linhaMeia} style={{ top: i * PX_HORA + PX_HORA / 2 }} /></span>
      ))}
      {fora.map(([i, f]) => <span key={i} className={c.fora} style={{ top: (i - hIni * 60) * (PX_HORA / 60), height: (f - i) * (PX_HORA / 60) }} />)}
      <div className={c.clicavel} onClick={(e) => onVazio(e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top)} />
      {bloqueios.map((b) => {
        const p = partes(b.inicio, fuso); const q = partes(b.fim, fuso);
        const ini = p.dia < col.dia ? hIni * 60 : p.hora * 60 + p.minuto; const fim = q.dia > col.dia ? hFim * 60 : q.hora * 60 + q.minuto;
        return <span key={b.id} className={c.bloqueio} style={{ top: (ini - hIni * 60) * (PX_HORA / 60), height: Math.max(14, (fim - ini) * (PX_HORA / 60)) }}>{b.motivo || 'Bloqueado'}</span>;
      })}
      {col.dia === agora.dia && agora.hora >= hIni && agora.hora < hFim && <span className={c.agora} style={{ top: topo(agora.hora, agora.minuto) }} />}
      {doDia.map((a) => {
        const p = partes(a.inicio, fuso); const q = partes(a.fim, fuso);
        const h = Math.max(20, ((q.hora * 60 + q.minuto) - (p.hora * 60 + p.minuto)) * (PX_HORA / 60) - 2);
        return (
          <button key={a.id} type="button" className={c.evento} data-status={a.status} data-agendamento={a.id}
            style={{ top: topo(p.hora, p.minuto) + 1, height: h, ['--evento' as string]: a.tipo_cor || corProf(a.profissional_id) }}
            onClick={() => onAbrir(a)} title={`${hhmm(p.hora, p.minuto)} ${a.nome ?? ''} · ${a.tipo} · ${a.profissional}`}>
            <strong>{hhmm(p.hora, p.minuto)} {a.nome || fone(a.telefone) || 'Sem nome'}</strong>
            {h > 34 && <span>{a.tipo}{col.profissional ? '' : ` · ${a.profissional}`}</span>}
          </button>
        );
      })}
    </div>
  );
}


function Detalhe({ a, dados, fuso, onFechar, onFeito }: { a: Agendamento; dados: TelaAgenda; fuso: string; onFechar: () => void; onFeito: (t: string) => void }) {
  const p = partes(a.inicio, fuso); const q = partes(a.fim, fuso);
  const [remarcar, setRemarcar] = useState(false);
  const [dia, setDia] = useState(p.dia);
  const [hora, setHora] = useState(hhmm(p.hora, p.minuto));
  const [prof, setProf] = useState(a.profissional_id);
  const [motivo, setMotivo] = useState('');
  const [cancelar, setCancelar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function mudar(dadosMudanca: Record<string, unknown>, ok: string) {
    setEnviando(true); setErro(null);
    const r = await alterarNaAgenda(a.id, dadosMudanca);
    setEnviando(false);
    if (r.ok) onFeito(ok); else setErro(r.erro);
  }
  const ativo = a.status !== 'cancelado';
  return (
    <Painel titulo={a.nome || 'Agendamento'} onFechar={onFechar}>
      <dl className={c.dado}>
        <dt>Quando</dt><dd>{new Date(p.dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}, {hhmm(p.hora, p.minuto)} às {hhmm(q.hora, q.minuto)}</dd>
        <dt>Atendimento</dt><dd>{a.tipo}{a.valor !== null ? ` · ${reais(a.valor)}` : ''}</dd>
        <dt>Profissional</dt><dd>{a.profissional}</dd>
        {a.telefone && <><dt>Telefone</dt><dd>{fone(a.telefone)}</dd></>}
        <dt>Situação</dt><dd><span className={c.status} data-status-detalhe={a.status}>{STATUS[a.status] ?? a.status}</span></dd>
        <dt>Marcado por</dt><dd>{a.origem === 'IA' ? 'IA' : a.criado_por ?? a.origem}</dd>
        {a.observacao && <><dt>Observação</dt><dd>{a.observacao}</dd></>}
        {a.cancelado_motivo && <><dt>Motivo</dt><dd>{a.cancelado_motivo}</dd></>}
      </dl>
      {erro && <p className={c.erro} role="alert">{erro}</p>}
      {dados.podeEditar && ativo && !remarcar && !cancelar && (
        <div className={c.acoes}>
          {a.status !== 'confirmado' && <button type="button" className={c.botaoSec} disabled={enviando} onClick={() => mudar({ status: 'confirmado' }, 'Agendamento confirmado.')}>Confirmar</button>}
          <button type="button" className={c.botaoSec} disabled={enviando} onClick={() => mudar({ status: 'atendido' }, 'Marcado como atendido.')}>Atendido</button>
          <button type="button" className={c.botaoSec} disabled={enviando} onClick={() => mudar({ status: 'faltou' }, 'Marcado como falta.')}>Faltou</button>
          <button type="button" className={c.botaoSec} disabled={enviando} onClick={() => setRemarcar(true)} data-remarcar>Remarcar</button>
          <button type="button" className={c.botaoPerigo} disabled={enviando} onClick={() => setCancelar(true)} data-cancelar>Cancelar</button>
        </div>
      )}
      {remarcar && (
        <>
          <div className={c.linha}>
            <label className={c.campo}>Dia<input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
            <label className={c.campo}>Hora<input type="time" value={hora} step={300} onChange={(e) => setHora(e.target.value)} /></label>
          </div>
          <label className={c.campo}>Profissional
            <select value={prof} onChange={(e) => setProf(e.target.value)}>{dados.profissionais.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
          </label>
          <div className={c.acoes}>
            <button type="button" className={c.botao} disabled={enviando} onClick={() => mudar({ inicio: isoDe(dia, hora, fuso), profissional: prof }, 'Agendamento remarcado.')} data-confirmar-remarcar>Remarcar</button>
            <button type="button" className={c.botaoSec} onClick={() => setRemarcar(false)}>Voltar</button>
          </div>
        </>
      )}
      {cancelar && (
        <>
          <label className={c.campo}>Motivo (opcional)<input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} /></label>
          <div className={c.acoes}>
            <button type="button" className={c.botaoPerigo} disabled={enviando} onClick={() => mudar({ status: 'cancelado', motivo }, 'Agendamento cancelado.')} data-confirmar-cancelar>Cancelar agendamento</button>
            <button type="button" className={c.botaoSec} onClick={() => setCancelar(false)}>Voltar</button>
          </div>
        </>
      )}
    </Painel>
  );
}

function NovoAgendamento({ inicial, dados, fuso, onFechar, onFeito }: { inicial: Novo; dados: TelaAgenda; fuso: string; onFechar: () => void; onFeito: (t: string) => void }) {
  const [tipo, setTipo] = useState(dados.tipos[0]?.id ?? '');
  const [prof, setProf] = useState(inicial.profissional ?? '');
  const [dia, setDia] = useState(inicial.dia);
  const [hora, setHora] = useState(inicial.hora);
  const [telefone, setTelefone] = useState('');
  const [nome, setNome] = useState('');
  const [obs, setObs] = useState('');
  const [encaixe, setEncaixe] = useState(false);
  const [livres, setLivres] = useState<{ inicio: string; profissional_id: string; profissional: string }[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const t = dados.tipos.find((x) => x.id === tipo);

  useEffect(() => {
    if (!tipo || !dia) return;
    let vivo = true;
    horariosDaAgenda(tipo, prof || null, dia, dia).then((r) => { if (vivo) setLivres(r.ok ? r.dados.horarios : []); });
    return () => { vivo = false; };
  }, [tipo, prof, dia]);

  async function salvar() {
    setErro(null);
    if (!tipo) { setErro('Escolha o tipo de atendimento.'); return; }
    if (!telefone.replace(/\D/g, '') && !nome.trim()) { setErro('Informe o telefone (ou ao menos o nome).'); return; }
    setEnviando(true);
    const tel = telefone.replace(/\D/g, '');
    const r = await marcarNaAgenda({
      tipo, profissional: prof || undefined, inicio: isoDe(dia, hora, fuso), nome: nome.trim() || undefined, observacao: obs.trim() || undefined, encaixe,
      telefone: tel ? (tel.length <= 11 ? '55' + tel : tel) : undefined,
    });
    setEnviando(false);
    if (r.ok) onFeito('Agendamento marcado.'); else setErro(r.erro);
  }
  const horaDe = (iso: string) => { const p = partes(iso, fuso); return hhmm(p.hora, p.minuto); };
  return (
    <Painel titulo="Novo agendamento" onFechar={onFechar}>
      <label className={c.campo}>Atendimento
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} data-campo-tipo>
          {dados.tipos.map((x) => <option key={x.id} value={x.id}>{x.nome} · {x.duracao_min} min{x.valor !== null ? ` · ${reais(x.valor)}` : ''}</option>)}
        </select>
      </label>
      <label className={c.campo}>Profissional
        <select value={prof} onChange={(e) => setProf(e.target.value)} data-campo-profissional>
          <option value="">Qualquer um livre</option>
          {dados.profissionais.filter((x) => !t?.profissionais.length || t.profissionais.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </label>
      <div className={c.linha}>
        <label className={c.campo}>Dia<input type="date" value={dia} onChange={(e) => setDia(e.target.value)} data-campo-dia /></label>
        <label className={c.campo}>Hora<input type="time" value={hora} step={300} onChange={(e) => setHora(e.target.value)} data-campo-hora /></label>
      </div>
      <div>
        <span className={c.sub}>Horários livres neste dia</span>
        <div className={c.chips} data-horarios-livres>
          {livres === null ? <span className={c.sub}>Carregando…</span> : !livres.length ? <span className={c.sub}>Nenhum horário livre.</span>
            : [...new Map(livres.map((h) => [horaDe(h.inicio), h])).values()].map((h) => (
              <button key={h.inicio} type="button" className={c.chip} aria-pressed={horaDe(h.inicio) === hora} onClick={() => setHora(horaDe(h.inicio))}>{horaDe(h.inicio)}</button>
            ))}
        </div>
      </div>
      <div className={c.linha}>
        <label className={c.campo}>Telefone (WhatsApp)<input inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(47) 99999-0000" data-campo-telefone /></label>
        <label className={c.campo}>Nome<input value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} data-campo-nome /></label>
      </div>
      <label className={c.campo}>Observação<textarea value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></label>
      <label className={c.marcar}><input type="checkbox" checked={encaixe} onChange={(e) => setEncaixe(e.target.checked)} /> Encaixe (fora da grade de horários)</label>
      {erro && <p className={c.erro} role="alert">{erro}</p>}
      <div className={c.acoes}>
        <button type="button" className={c.botao} disabled={enviando} onClick={salvar} data-salvar-agendamento>{enviando ? 'Marcando…' : 'Marcar'}</button>
        <button type="button" className={c.botaoSec} onClick={onFechar}>Cancelar</button>
      </div>
    </Painel>
  );
}
