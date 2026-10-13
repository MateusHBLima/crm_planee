'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  anoInteiro, atalhoDe, diaDe, diaBr, intervaloDoAtalho, MESES_CURTOS, mesInteiro, nomeIntervalo, nomeMes, NOMES_ATALHO,
  type Atalho, type Intervalo,
} from '@/lib/periodo';
import { Icone } from './Icone';
import f from './filtro-data.module.css';

// Filtro de data do painel (11/10), todo em português: atalhos (Hoje, Ontem, Últimos 7 dias, Este mês, Mês passado,
// Este ano...) e um calendário para escolher um dia, um mês, um ano ou um intervalo "de… até…". Semana começa no
// domingo, como no calendário brasileiro. Usado no CRM, no Registro, nos Resultados e na Agenda.

export type Modo = 'dia' | 'mes' | 'ano' | 'intervalo';
const NOMES_MODO: Record<Modo, string> = { dia: 'Dia', mes: 'Mês', ano: 'Ano', intervalo: 'Intervalo' };
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

type Props = {
  valor: Intervalo | null;
  onMudar: (v: Intervalo | null) => void;
  hoje: string;                         // YYYY-MM-DD no fuso do painel
  atalhos?: readonly Atalho[];
  modos?: readonly Modo[];
  vazio?: string;                       // texto quando não há período (ex.: "Abertos agora"); sem ele, sempre há um período
  rotulo?: string;                      // nome para leitor de tela
  id?: string;
};

export function FiltroData({ valor, onMudar, hoje, atalhos = ['hoje', 'ontem', '7d', '30d', 'mes', 'mes_passado', 'ano'], modos = ['dia', 'mes', 'ano', 'intervalo'], vazio, rotulo = 'Período', id }: Props) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const idPainel = useId();
  const texto = valor ? nomeIntervalo(valor, hoje, atalhos) : (vazio ?? 'Escolha o período');

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  // O painel abre alinhado pela direita do botão; se assim ele passaria por baixo do menu lateral (botão perto da
  // esquerda da tela, como no CRM com o filtro por fase), abre alinhado pela esquerda.
  const painel = useRef<HTMLDivElement>(null);
  const [aEsquerda, setAEsquerda] = useState(false);
  useLayoutEffect(() => {
    if (!aberto) { setAEsquerda(false); return; }
    const p = painel.current; if (!p || getComputedStyle(p).position !== 'absolute') return;
    const limite = caixa.current?.closest('main')?.getBoundingClientRect().left ?? 0;
    if (p.getBoundingClientRect().left < limite) setAEsquerda(true);
  }, [aberto]);

  const escolher = (v: Intervalo | null) => { onMudar(v); setAberto(false); };

  return (
    <div className={f.caixa} ref={caixa} data-filtro-data={id ?? ''}>
      <button type="button" id={id} className={f.botao} aria-haspopup="dialog" aria-expanded={aberto} aria-controls={idPainel}
        aria-label={`${rotulo}: ${texto}`} data-ativo={valor ? 'sim' : undefined} onClick={() => setAberto((a) => !a)}>
        <Icone nome="agenda" tamanho={15} />
        <span className={f.texto}>{texto}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {aberto && (
        <div className={f.painel} id={idPainel} role="dialog" aria-label={rotulo} ref={painel} data-lado={aEsquerda ? 'esquerda' : undefined}>
          <Conteudo valor={valor} hoje={hoje} atalhos={atalhos} modos={modos} vazio={vazio} onEscolher={escolher} />
        </div>
      )}
    </div>
  );
}

function Conteudo({ valor, hoje, atalhos, modos, vazio, onEscolher }: {
  valor: Intervalo | null; hoje: string; atalhos: readonly Atalho[]; modos: readonly Modo[]; vazio?: string; onEscolher: (v: Intervalo | null) => void;
}) {
  const atual = atalhoDe(valor, hoje, atalhos);
  const inicial = tipoDe(valor);
  const [modo, setModo] = useState<Modo>(modos.includes(inicial) ? inicial : modos[0]);
  const ref = valor?.ate ?? hoje;
  const [ano, setAno] = useState(Number(ref.slice(0, 4)));
  const [mes, setMes] = useState(Number(ref.slice(5, 7)));
  const [inicio, setInicio] = useState<string | null>(null);   // intervalo: primeiro clique
  const [passando, setPassando] = useState<string | null>(null);

  const mudarMes = (n: number) => {
    let m = mes + n, a = ano;
    if (m < 1) { m = 12; a--; } if (m > 12) { m = 1; a++; }
    setMes(m); setAno(a);
  };

  const clicarDia = (d: string) => {
    if (modo === 'dia') { onEscolher({ de: d, ate: d }); return; }
    if (!inicio) { setInicio(d); return; }
    onEscolher(d < inicio ? { de: d, ate: inicio } : { de: inicio, ate: d });
  };

  // Faixa marcada no calendário: a escolhida, ou a que está sendo escolhida (do primeiro clique até o mouse).
  const faixa: Intervalo | null = modo === 'intervalo' && inicio
    ? (passando ? (passando < inicio ? { de: passando, ate: inicio } : { de: inicio, ate: passando }) : { de: inicio, ate: inicio })
    : valor;

  return (
    <div className={f.conteudo}>
      {(atalhos.length > 0 || vazio) && (
        <ul className={f.atalhos} aria-label="Atalhos">
          {vazio && (
            <li><button type="button" className={f.atalho} aria-pressed={!valor} onClick={() => onEscolher(null)}>{vazio}</button></li>
          )}
          {atalhos.map((a) => (
            <li key={a}>
              <button type="button" className={f.atalho} aria-pressed={atual === a} data-atalho={a} onClick={() => onEscolher(intervaloDoAtalho(a, hoje))}>
                {NOMES_ATALHO[a]}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={f.calendario}>
        {modos.length > 1 && (
          <div className={f.modos} role="tablist" aria-label="Escolher por">
            {modos.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={modo === m} className={f.modo} data-modo={m}
                onClick={() => { setModo(m); setInicio(null); setPassando(null); }}>{NOMES_MODO[m]}</button>
            ))}
          </div>
        )}

        {(modo === 'dia' || modo === 'intervalo') && (
          <>
            <div className={f.navega}>
              <button type="button" className={f.seta} onClick={() => mudarMes(-1)} aria-label="Mês anterior">‹</button>
              <span className={f.mesAno} aria-live="polite">{nomeMes(mes)} de {ano}</span>
              <button type="button" className={f.seta} onClick={() => mudarMes(1)} aria-label="Próximo mês">›</button>
            </div>
            <div className={f.grade} role="grid" aria-label={`${nomeMes(mes)} de ${ano}`} onMouseLeave={() => setPassando(null)}>
              {SEMANA.map((s, i) => <span key={i} className={f.semana} title={SEMANA_LONGA[i]} aria-hidden="true">{s}</span>)}
              {diasDoMes(ano, mes).map((d, i) => d === null ? <span key={`v${i}`} /> : (
                <button key={d} type="button" className={f.dia} data-dia={d}
                  data-hoje={d === hoje ? 'sim' : undefined}
                  data-ponta={faixa && (d === faixa.de || d === faixa.ate) ? 'sim' : undefined}
                  data-dentro={faixa && d > faixa.de && d < faixa.ate ? 'sim' : undefined}
                  aria-pressed={Boolean(faixa && (d === faixa.de || d === faixa.ate))}
                  aria-label={nomeIntervalo({ de: d, ate: d })}
                  onMouseEnter={() => { if (modo === 'intervalo' && inicio) setPassando(d); }}
                  onClick={() => clicarDia(d)}>
                  {Number(d.slice(8))}
                </button>
              ))}
            </div>
            {modo === 'intervalo' && (
              <p className={f.dica}>
                {inicio ? <>De <strong>{diaBr(inicio)}</strong> até… clique no último dia.</> : 'Clique no primeiro dia e depois no último.'}
              </p>
            )}
          </>
        )}

        {modo === 'mes' && (
          <>
            <div className={f.navega}>
              <button type="button" className={f.seta} onClick={() => setAno(ano - 1)} aria-label="Ano anterior">‹</button>
              <span className={f.mesAno}>{ano}</span>
              <button type="button" className={f.seta} onClick={() => setAno(ano + 1)} aria-label="Próximo ano">›</button>
            </div>
            <div className={f.meses}>
              {MESES_CURTOS.map((m, i) => {
                const x = mesInteiro(ano, i + 1);
                return (
                  <button key={m} type="button" className={f.mes} data-mes={`${ano}-${String(i + 1).padStart(2, '0')}`}
                    aria-pressed={Boolean(valor && valor.de === x.de && valor.ate === x.ate)} aria-label={`${nomeMes(i + 1)} de ${ano}`}
                    data-hoje={hoje.slice(0, 7) === x.de.slice(0, 7) ? 'sim' : undefined}
                    onClick={() => onEscolher(x)}>{m}</button>
                );
              })}
            </div>
          </>
        )}

        {modo === 'ano' && (
          <div className={f.meses}>
            {Array.from({ length: 9 }, (_, i) => Number(hoje.slice(0, 4)) - 7 + i).map((a) => {
              const x = anoInteiro(a);
              return (
                <button key={a} type="button" className={f.mes} data-ano={a} aria-pressed={Boolean(valor && valor.de === x.de && valor.ate === x.ate)}
                  data-hoje={hoje.startsWith(String(a)) ? 'sim' : undefined} onClick={() => onEscolher(x)}>{a}</button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Em que aba o calendário abre: a do período que já está escolhido.
function tipoDe(v: Intervalo | null): Modo {
  if (!v || v.de === v.ate) return 'dia';
  const ano = Number(v.de.slice(0, 4)), mes = Number(v.de.slice(5, 7));
  const m = mesInteiro(ano, mes);
  if (v.de === m.de && v.ate === m.ate) return 'mes';
  const a = anoInteiro(ano);
  if (v.de === a.de && v.ate === a.ate) return 'ano';
  return 'intervalo';
}

// Dias do mês na grade de 7 colunas, começando no domingo (null = casa vazia antes do dia 1º).
function diasDoMes(ano: number, mes: number): (string | null)[] {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return [...Array<null>(primeiro).fill(null), ...Array.from({ length: total }, (_, i) => diaDe(ano, mes, i + 1))];
}
