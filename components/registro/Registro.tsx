'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Area, ItemRegistro, Registro as TRegistro } from '@/lib/painel/registro';
import { carregarRegistro } from '@/lib/painel/leitura-cliente';
import { hojeNoFuso, intervaloDoAtalho, type Intervalo } from '@/lib/periodo';
import { FiltroData } from '@/components/FiltroData';
import { Esqueleto } from '@/components/Esqueleto';
import c from './registro.module.css';

// Registro (11/10): o que cada pessoa fez no painel desta empresa, com o login de quem fez. Só o admin e a Planee
// veem (o servidor confere de novo). Filtros: período (atalhos e calendário em português), pessoa e área.

const AREAS: [Area | '', string][] = [['', 'Tudo'], ['crm', 'CRM'], ['inbox', 'Inbox'], ['equipe', 'Equipe'], ['planee', 'Planee']];
const NOME_AREA: Record<Area, string> = { crm: 'CRM', inbox: 'Inbox', equipe: 'Equipe', planee: 'Planee' };

export function Registro({ empresaNome }: { empresaNome: string }) {
  const [hoje] = useState(() => hojeNoFuso('America/Sao_Paulo'));
  const [periodo, setPeriodo] = useState<Intervalo>(() => intervaloDoAtalho('7d', hoje));
  const [pessoa, setPessoa] = useState('');
  const [area, setArea] = useState<Area | ''>('');
  const [sistema, setSistema] = useState(false);
  const [dados, setDados] = useState<TRegistro | null>(null);
  const [itens, setItens] = useState<ItemRegistro[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const pedido = useRef(0);

  const filtros = useMemo(() => ({ de: periodo.de, ate: periodo.ate, pessoa, area, sistema }), [periodo, pessoa, area, sistema]);

  const ler = useCallback(async (antes: string | null) => {
    const n = ++pedido.current;
    setCarregando(true);
    const r = await carregarRegistro({ ...filtros, antes });
    if (n !== pedido.current) return;
    setCarregando(false);
    if (!r.ok) {
      if (r.sair) { window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`; return; }
      setErro(r.erro); return;
    }
    setErro(null); setDados(r.dados);
    setItens((atuais) => (antes ? [...atuais, ...r.dados.itens] : r.dados.itens));
  }, [filtros]);

  useEffect(() => { void ler(null); }, [ler]);

  const fuso = dados?.fuso ?? 'America/Sao_Paulo';
  const fmt = useMemo(() => ({
    dia: new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    chave: new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }),
    hora: new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }),
  }), [fuso]);

  if (!dados && !erro) return <Esqueleto titulo="Registro" />;

  // Agrupado por dia, do mais recente para o mais antigo.
  const grupos: { dia: string; nome: string; itens: ItemRegistro[] }[] = [];
  for (const it of itens) {
    const k = fmt.chave.format(new Date(it.quando));
    const ult = grupos[grupos.length - 1];
    if (ult && ult.dia === k) ult.itens.push(it);
    else grupos.push({ dia: k, nome: k === hoje ? 'Hoje' : fmt.dia.format(new Date(it.quando)), itens: [it] });
  }

  return (
    <div className={c.tela}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>Registro · {empresaNome}</h1>
          <p className={c.sub}>Tudo o que cada pessoa fez no painel, com o login de quem fez. Só o admin vê esta tela.</p>
        </div>
      </header>

      <div className={c.filtros}>
        <FiltroData id="periodo-registro" valor={periodo} onMudar={(v) => { if (v) setPeriodo(v); }} hoje={hoje} rotulo="Período do registro" />
        <label className={c.campo}>
          <span className={c.visivelLeitor}>Pessoa</span>
          <select id="registro-pessoa" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Todas as pessoas</option>
            {(dados?.pessoas ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        <div className={c.segmentado} role="group" aria-label="Área">
          {AREAS.map(([v, t]) => (
            <button key={v || 'tudo'} type="button" className={c.segItem} aria-pressed={area === v} data-area={v || 'tudo'} onClick={() => setArea(v)}>{t}</button>
          ))}
        </div>
        <label className={c.marcar}>
          <input type="checkbox" id="registro-sistema" checked={sistema} disabled={Boolean(pessoa)} onChange={(e) => setSistema(e.target.checked)} />
          Incluir a Sara e as integrações
        </label>
      </div>

      {erro && <p className={c.erro} role="alert">{erro}</p>}

      {!itens.length && !carregando && !erro && <div className={c.vazio}>Nada registrado neste período com esses filtros.</div>}

      {grupos.map((g) => (
        <section key={g.dia} className={c.grupo} aria-label={g.nome}>
          <h2 className={c.dia}>{g.nome}</h2>
          <ol className={c.lista}>
            {g.itens.map((it) => (
              <li key={it.id} className={c.item} data-registro={it.id} data-area={it.area}>
                <time className={c.hora} dateTime={it.quando}>{fmt.hora.format(new Date(it.quando))}</time>
                <span className={c.quem} title={it.email ?? undefined}>
                  {it.quem ?? '—'}{it.sistema && <span className={c.selo}>sistema</span>}
                </span>
                <span className={c.texto}>
                  {it.texto}
                  {it.alvo && <span className={c.alvo}> · {it.alvo}</span>}
                </span>
                <span className={c.area} data-area={it.area}>{NOME_AREA[it.area]}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {dados?.mais && itens.length > 0 && (
        <button type="button" className={c.mais} disabled={carregando} onClick={() => ler(itens[itens.length - 1].quando)}>
          {carregando ? 'Carregando…' : 'Carregar mais antigos'}
        </button>
      )}
    </div>
  );
}
