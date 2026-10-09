'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import type { DiaAgenda, ItemAgenda } from '@/lib/painel/agenda';
import { carregarAgenda } from '@/lib/painel/leitura-cliente';
import { sincronizarAgendaAgora } from '@/lib/painel/acoes-planee';
import { lembrado, lembrar } from '@/lib/painel/memoria-cliente';
import { Esqueleto } from '@/components/Esqueleto';
import { telefoneBonito } from '@/components/crm/util';
import c from './agenda.module.css';

// Tela Agenda (09/10): os agendamentos do dia por profissional, do espelho da Feegow e da Sara. Atualiza a cada
// 2 minutos. O master vê o botão "Ler a agenda agora" (roda o espelho na hora).

const SITUACAO: Record<string, string> = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Atendido', cancelado: 'Desmarcado', faltou: 'Faltou' };
const ATUALIZA_MS = 120_000;
const somaDias = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function Agenda({ empresaId, master }: { empresaId: string; master: boolean }) {
  const [dia, setDia] = useState<string | null>(null);
  const [dados, setDados] = useState<DiaAgenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [prof, setProf] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [lendo, iniciar] = useTransition();

  const ler = useCallback(async (d: string | null) => {
    const r = await carregarAgenda(d ?? '');
    if (r.ok) { setDados(r.dados); setErro(null); lembrar(`${empresaId}:agenda:${r.dados.dia}`, r.dados); if (!d) setDia(r.dados.dia); }
    else if (r.sair) window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`;
    else setErro(r.erro);
  }, [empresaId]);

  useEffect(() => {
    if (dia) { const g = lembrado<DiaAgenda>(`${empresaId}:agenda:${dia}`); if (g) setDados(g); }
    void ler(dia);
    const t = window.setInterval(() => { if (!document.hidden) void ler(dia); }, ATUALIZA_MS);
    return () => window.clearInterval(t);
  }, [dia, ler, empresaId]);

  const fmt = useMemo(() => {
    const tz = dados?.fuso ?? 'America/Sao_Paulo';
    return {
      hora: new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
      dia: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
      quando: new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    };
  }, [dados?.fuso]);

  if (!dados) return erro ? <div className={c.tela}><h1 className={c.titulo}>Agenda</h1><p className={`${c.aviso} ${c.avisoErro}`} role="alert">{erro}</p></div> : <Esqueleto titulo="Agenda" />;

  const profissionais = [...new Set(dados.itens.map((i) => i.profissional ?? 'Sem profissional'))].sort();
  const vis = dados.itens.filter((i) => !prof || (i.profissional ?? 'Sem profissional') === prof);
  const grupos = new Map<string, ItemAgenda[]>();
  for (const i of vis) { const k = i.profissional ?? 'Sem profissional'; grupos.set(k, [...(grupos.get(k) ?? []), i]); }
  const conta = (s: string) => vis.filter((i) => i.situacao === s).length;
  const e = dados.espelho;

  const lerAgora = () => iniciar(async () => {
    setAviso(null);
    const r = await sincronizarAgendaAgora();
    if (!r.ok) { setAviso({ ok: false, texto: r.erro }); return; }
    const x = r.dados;
    setAviso({ ok: x.situacao !== 'erro', texto: x.situacao === 'sem_token' ? 'Falta o token da Feegow na stack do painel.' : x.situacao === 'ocupado' ? 'O espelho já está lendo a agenda agora.'
      : `${x.gravados} agendamentos gravados, ${x.novos_contatos} contatos novos, ${x.chamadas} chamadas à Feegow${x.situacao === 'parcial' ? ' (continua na próxima rodada)' : ''}${x.erro ? ` · ${x.erro}` : ''}.` });
    await ler(dia);
  });

  return (
    <div className={c.tela}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>Agenda</h1>
          <p className={c.sub}>
            {fmt.dia.format(new Date(dados.dia + 'T12:00:00Z'))}
            {e && e.configurado && <> · espelho da Feegow {e.ultima_ok ? `lido ${fmt.quando.format(new Date(e.ultima_ok))}` : 'ainda não leu'}
              {e.carga_completa ? ' · histórico completo' : e.carga_ate ? ` · histórico carregado desde ${e.carga_ate.split('-').reverse().join('/')}` : ''}</>}
            {e && e.ultimo_erro && <span className={c.subErro}> · {e.ultimo_erro}</span>}
            {erro && <span className={c.subErro}> · {erro}</span>}
          </p>
        </div>
        <div className={c.navDia}>
          <button type="button" className={c.botaoSec} onClick={() => setDia(somaDias(dados.dia, -1))} aria-label="Dia anterior">←</button>
          <input type="date" className={c.data} value={dados.dia} onChange={(ev) => ev.target.value && setDia(ev.target.value)} aria-label="Dia" />
          <button type="button" className={c.botaoSec} onClick={() => setDia(somaDias(dados.dia, 1))} aria-label="Próximo dia">→</button>
          <button type="button" className={c.botaoSec} onClick={() => setDia(null)}>Hoje</button>
          <select className={c.filtro} value={prof} onChange={(ev) => setProf(ev.target.value)} aria-label="Profissional">
            <option value="">Todos os profissionais</option>
            {profissionais.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {master && <button type="button" className={c.botaoSec} onClick={lerAgora} disabled={lendo}>{lendo ? 'Lendo…' : 'Ler a agenda agora'}</button>}
        </div>
      </header>
      {aviso && <p className={aviso.ok ? c.aviso : `${c.aviso} ${c.avisoErro}`} role="status">{aviso.texto}</p>}
      <div className={c.resumo} aria-label="Resumo do dia">
        <span className={c.chip}>Agendamentos <strong>{vis.length}</strong></span>
        {(['confirmado', 'agendado', 'realizado', 'faltou', 'cancelado'] as const).map((s) => conta(s) ? <span key={s} className={c.chip}>{SITUACAO[s]} <strong>{conta(s)}</strong></span> : null)}
        {vis.some((i) => i.origem === 'sara') && <span className={c.chip}>Marcados pela Sara <strong>{vis.filter((i) => i.origem === 'sara').length}</strong></span>}
      </div>
      {!vis.length ? (
        <div className={c.vazio}>
          Nenhum agendamento neste dia.{e && !e.configurado ? ' O espelho da agenda da Feegow ainda não está ligado para esta empresa: aparecem só os agendamentos que a Sara registrou.' : ''}
        </div>
      ) : [...grupos.entries()].map(([nome, itens]) => (
        <section key={nome} className={c.grupo} aria-label={nome}>
          <h2 className={c.grupoTitulo}>{nome} <span>{itens.filter((i) => i.situacao !== 'cancelado').length} no dia</span></h2>
          <ul className={c.lista}>
            {itens.map((i) => (
              <li key={i.id} className={c.item} data-situacao={i.situacao} data-agendamento={i.id}>
                <span className={c.hora}>{i.inicio ? fmt.hora.format(new Date(i.inicio)) : '—'}</span>
                <span className={c.corpo}>
                  <span className={c.nome}>{i.contato.nome || (i.contato.telefone ? telefoneBonito(i.contato.telefone) : 'Paciente sem nome')}</span>
                  <span className={c.meta}>{[i.tipo, i.local, i.contato.telefone ? telefoneBonito(i.contato.telefone) : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={c.etiquetas}>
                  {i.primeira && <span className={c.etiqueta}>1ª consulta</span>}
                  {i.encaixe && <span className={c.etiqueta}>Encaixe</span>}
                  {i.origem === 'sara' && <span className={c.etiqueta} data-origem="sara">Sara</span>}
                  <span className={c.etiqueta} data-situacao={i.situacao} title={i.status ?? undefined}>{SITUACAO[i.situacao] ?? i.situacao}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
