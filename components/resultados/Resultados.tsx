'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Periodo, Resultados as TResultados } from '@/lib/painel/resultados';
import { carregarResultados } from '@/lib/painel/leitura-cliente';
import { lembrado, lembrar } from '@/lib/painel/memoria-cliente';
import { Esqueleto } from '@/components/Esqueleto';
import { TIPOS_AUTOMATICA } from '@/lib/automaticas-nomes';
import c from './resultados.module.css';

// Resultados da empresa (fase 1.3, 09/10): conversas, espera pela equipe, quadro, agendamentos, funil, mensagens
// automáticas e comprovantes no período escolhido. Só números agregados; atualiza a cada 5 minutos.

const PERIODOS: [Periodo, string][] = [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['mes', 'Este mês']];
const ATUALIZA_MS = 5 * 60_000;
const SITUACAO: Record<string, string> = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou' };

const inteiro = (v: number) => v.toLocaleString('pt-BR');
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
function minutos(m: number | null) {
  if (m === null) return '—';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24); return `${d} d ${h % 24} h`;
}

export function Resultados({ empresaId, empresaNome }: { empresaId: string; empresaNome: string }) {
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const chave = `${empresaId}:resultados:${periodo}`;
  const [dados, setDados] = useState<TResultados | null>(() => lembrado<TResultados>(`${empresaId}:resultados:30`) ?? null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const guardado = lembrado<TResultados>(chave);
    if (guardado) setDados(guardado);
    const ler = async () => {
      const r = await carregarResultados(periodo);
      if (!vivo) return;
      if (r.ok) { setDados(r.dados); lembrar(chave, r.dados); setErro(null); }
      else if (r.sair) window.location.href = `/entrar?motivo=sessao&volta=${encodeURIComponent(window.location.pathname)}`;
      else setErro(r.erro);
    };
    void ler();
    const t = window.setInterval(() => { if (!document.hidden) void ler(); }, ATUALIZA_MS);
    return () => { vivo = false; window.clearInterval(t); };
  }, [chave, periodo]);

  const fmtDia = useMemo(() => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }), []);
  const fmtData = useMemo(() => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: dados?.fuso ?? 'America/Sao_Paulo' }), [dados?.fuso]);

  if (!dados) return erro ? <div className={c.tela}><h1 className={c.titulo}>Resultados</h1><p className={c.erro} role="alert">{erro}</p></div> : <Esqueleto titulo="Resultados" />;
  const d = dados;
  // Todos os dias do período, com zero nos dias sem mensagem (a consulta só traz os dias com mensagem).
  const porDiaMapa = new Map((d.conversas?.porDia ?? []).map((x) => [x.dia, x]));
  const diaLocal = new Intl.DateTimeFormat('en-CA', { timeZone: d.fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
  const todosDias: { dia: string; contatos: number; recebidas: number }[] = [];
  for (let t = new Date(d.de).getTime() + 12 * 3600_000; t <= new Date(d.ate).getTime() + 12 * 3600_000 && todosDias.length < 400; t += 86400_000) {
    const k = diaLocal.format(new Date(Math.min(t, new Date(d.ate).getTime())));
    if (!todosDias.length || todosDias[todosDias.length - 1].dia !== k) todosDias.push(porDiaMapa.get(k) ?? { dia: k, contatos: 0, recebidas: 0 });
  }
  const conv = d.conversas ? { ...d.conversas, porDia: todosDias } : null;
  const maxDia = Math.max(1, ...(conv?.porDia ?? []).map((x) => x.contatos));
  const totalEspera = d.espera?.respostas ?? 0;
  const acimaDeUmaHora = d.espera ? d.espera.faixas.slice(2).reduce((s, f) => s + f.qtde, 0) : 0;

  return (
    <div className={c.tela}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>Resultados · {empresaNome}</h1>
          <p className={c.sub}>{fmtData.format(new Date(d.de))} a {fmtData.format(new Date(d.ate))} · medido no banco{erro ? ' · ' : ''}{erro && <span className={c.erro}>{erro}</span>}</p>
        </div>
        <div className={c.segmentado} role="group" aria-label="Período">
          {PERIODOS.map(([v, t]) => (
            <button key={v} type="button" className={c.segItem} aria-pressed={periodo === v} onClick={() => setPeriodo(v)}>{t}</button>
          ))}
        </div>
      </header>

      <section className={c.kpis} aria-label="Números do período">
        <div className={c.kpi}>
          <span className={c.kpiRotulo}>Pessoas que escreveram</span>
          <span className={c.kpiValor} data-kpi="contatos">{conv ? inteiro(conv.contatos) : '—'}</span>
          <span className={c.kpiNota}>{conv ? `${inteiro(conv.recebidas)} mensagens recebidas` : 'Espelho do WhatsApp ainda não instalado'}</span>
        </div>
        <div className={c.kpi}>
          <span className={c.kpiRotulo}>Atendidas só pela Sara</span>
          <span className={c.kpiValor} data-kpi="so-sara">{conv ? pct(conv.soSara, conv.contatos) : '—'}</span>
          <span className={c.kpiNota}>{conv ? `${inteiro(conv.soSara)} sem nenhuma mensagem da equipe` : '—'}</span>
        </div>
        <div className={c.kpi}>
          <span className={c.kpiRotulo}>Agendamentos registrados</span>
          <span className={c.kpiValor} data-kpi="agenda">{d.agenda ? inteiro(d.agenda.total) : '—'}</span>
          <span className={c.kpiNota}>{d.agenda ? `${inteiro(d.agenda.pelaIa)} pela Sara` : 'Agendamentos ainda não instalados'}</span>
        </div>
        <div className={c.kpi}>
          <span className={c.kpiRotulo}>Pedidos para a equipe</span>
          <span className={c.kpiValor} data-kpi="quadro">{d.quadro ? inteiro(d.quadro.abertos) : '—'}</span>
          <span className={c.kpiNota}>{d.quadro ? `${inteiro(d.quadro.finalizados)} finalizados · assumir em ${minutos(d.quadro.mediana_assumir_min)} (mediana)` : '—'}</span>
        </div>
      </section>

      <div className={c.grade}>
        <section className={c.cartao} aria-label="Conversas por dia">
          <div>
            <h2 className={c.cartaoTitulo}>Pessoas que escreveram, por dia</h2>
            <p className={c.cartaoSub}>contatos distintos com mensagem recebida no dia</p>
          </div>
          {conv && conv.porDia.length ? (
            <>
              <div className={c.barras}>
                {conv.porDia.map((x) => (
                  <div key={x.dia} className={c.barra} title={`${fmtDia.format(new Date(x.dia + 'T12:00:00Z'))}: ${x.contatos} pessoas, ${x.recebidas} mensagens`}>
                    {conv.porDia.length <= 31 && x.contatos > 0 && <span className={c.barraValor}>{x.contatos}</span>}
                    <span className={c.barraCor} style={{ height: `${Math.max(2, (x.contatos / maxDia) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className={c.dias} aria-hidden="true">
                {conv.porDia.map((x, i) => (
                  <span key={x.dia} className={c.dia}>{conv.porDia.length <= 10 || i % Math.ceil(conv.porDia.length / 8) === 0 ? fmtDia.format(new Date(x.dia + 'T12:00:00Z')) : ''}</span>
                ))}
              </div>
              <p className={c.cartaoSub}>Respostas no período: {inteiro(conv.respostasSara)} da Sara · {inteiro(conv.respostasEquipe)} da equipe</p>
            </>
          ) : <div className={c.vazio}>Sem mensagens no período.</div>}
        </section>

        <section className={c.cartao} aria-label="Espera pela equipe">
          <div>
            <h2 className={c.cartaoTitulo}>Quanto o paciente espera pela equipe</h2>
            <p className={c.cartaoSub}>da primeira mensagem do paciente até a resposta da equipe (celular ou painel), {inteiro(totalEspera)} respostas · mediana {minutos(d.espera?.mediana_min ?? null)}</p>
          </div>
          {d.espera && totalEspera ? (
            <>
              <div className={c.faixas}>
                {d.espera.faixas.map((f, i) => (
                  <div key={f.rotulo} className={c.faixa} title={`${f.qtde} respostas`}>
                    <span className={c.faixaRotulo}>{f.rotulo}</span>
                    <span className={c.faixaFundo}><span className={c.faixaCor} data-nivel={i + 1} style={{ width: `${(f.qtde / totalEspera) * 100}%` }} /></span>
                    <span className={c.faixaValor}>{pct(f.qtde, totalEspera)}</span>
                  </div>
                ))}
              </div>
              {acimaDeUmaHora > 0 && <div className={c.destaque}>{pct(acimaDeUmaHora, totalEspera)} das respostas da equipe vieram depois de 1 hora.</div>}
            </>
          ) : <div className={c.vazio}>Sem respostas da equipe no período.</div>}
        </section>
      </div>

      <section className={c.cartao} aria-label="Quadro por assunto">
        <div>
          <h2 className={c.cartaoTitulo}>Quadro de atendimento por assunto</h2>
          <p className={c.cartaoSub}>agora, e quantos pedidos abriram no período (sem os cartões sombra)</p>
        </div>
        {d.quadro ? (
          <div className={c.rolagem}>
            <table className={c.tabela}>
              <thead><tr><th>Assunto</th><th className={c.num}>Aguardando</th><th className={c.num}>Em atendimento</th><th className={c.num}>Pendente</th><th className={c.num}>Abertos no período</th></tr></thead>
              <tbody>
                {d.quadro.agora.map((t) => (
                  <tr key={t.topico}><td>{t.nome}</td><td className={c.num}>{t.aguardando}</td><td className={c.num}>{t.em_atendimento}</td><td className={c.num}>{t.pendente}</td><td className={c.num}>{t.abertos_periodo}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className={c.vazio}>Quadro indisponível.</div>}
        {d.quadro && (
          <p className={c.cartaoSub}>
            Tempo até finalizar (mediana): {minutos(d.quadro.mediana_finalizar_min)} · assumidos no período: {inteiro(d.quadro.assumidos)}
          </p>
        )}
      </section>

      <div className={c.grade}>
        <section className={c.cartao} aria-label="Equipe">
          <div>
            <h2 className={c.cartaoTitulo}>Equipe no quadro</h2>
            <p className={c.cartaoSub}>quem assumiu e finalizou pedidos no período</p>
          </div>
          {d.quadro && d.quadro.pessoas.length ? (
            <table className={c.tabela}>
              <thead><tr><th>Pessoa</th><th className={c.num}>Assumiu</th><th className={c.num}>Finalizou</th></tr></thead>
              <tbody>{d.quadro.pessoas.map((p) => <tr key={p.nome}><td>{p.nome}</td><td className={c.num}>{p.assumidos}</td><td className={c.num}>{p.finalizados}</td></tr>)}</tbody>
            </table>
          ) : <div className={c.vazio}>Ninguém assumiu ou finalizou pedidos pelo quadro no período.</div>}
        </section>

        <section className={c.cartao} aria-label="Agendamentos">
          <div>
            <h2 className={c.cartaoTitulo}>Agendamentos registrados</h2>
            <p className={c.cartaoSub}>por situação e por tipo, registrados no período</p>
          </div>
          {d.agenda && d.agenda.total ? (
            <div className={c.mini}>
              {d.agenda.porSituacao.map((s) => <div key={s.situacao} className={c.miniItem}><span className={c.miniValor}>{s.qtde}</span><span className={c.miniRotulo}>{SITUACAO[s.situacao] ?? s.situacao}</span></div>)}
              {d.agenda.porTipo.map((s) => <div key={'t' + s.tipo} className={c.miniItem}><span className={c.miniValor}>{s.qtde}</span><span className={c.miniRotulo}>{s.tipo}</span></div>)}
            </div>
          ) : <div className={c.vazio}>Nenhum agendamento registrado no CRM no período.</div>}
        </section>
      </div>

      <div className={c.grade}>
        <section className={c.cartao} aria-label="Mensagens automáticas">
          <div>
            <h2 className={c.cartaoTitulo}>Mensagens automáticas da Sara</h2>
            <p className={c.cartaoSub}>lembretes, aniversários e follow-up registrados no CRM</p>
          </div>
          {d.automaticas && d.automaticas.length ? (
            <table className={c.tabela}>
              <thead><tr><th>Tipo</th><th className={c.num}>Enviadas</th><th className={c.num}>Falharam</th><th className={c.num}>Canceladas</th></tr></thead>
              <tbody>{d.automaticas.map((a) => <tr key={a.tipo}><td>{TIPOS_AUTOMATICA[a.tipo] ?? a.tipo}</td><td className={c.num}>{a.enviado}</td><td className={c.num}>{a.falhou}</td><td className={c.num}>{a.cancelado}</td></tr>)}</tbody>
            </table>
          ) : <div className={c.vazio}>Nenhuma mensagem automática registrada no período.</div>}
        </section>

        <section className={c.cartao} aria-label="Comercial e comprovantes">
          <div>
            <h2 className={c.cartaoTitulo}>Comercial e comprovantes</h2>
            <p className={c.cartaoSub}>funil de oportunidades e comprovantes recebidos no período</p>
          </div>
          <div className={c.mini}>
            <div className={c.miniItem}><span className={c.miniValor}>{d.funil ? d.funil.novas : '—'}</span><span className={c.miniRotulo}>Oportunidades novas</span></div>
            <div className={c.miniItem}><span className={c.miniValor}>{d.funil ? d.funil.ganhas : '—'}</span><span className={c.miniRotulo}>Ganhas{d.funil && d.funil.valorGanho ? ` · ${reais(d.funil.valorGanho)}` : ''}</span></div>
            <div className={c.miniItem}><span className={c.miniValor}>{d.funil ? d.funil.perdidas : '—'}</span><span className={c.miniRotulo}>Perdidas</span></div>
            <div className={c.miniItem}><span className={c.miniValor}>{d.comprovantes ? d.comprovantes.total : '—'}</span><span className={c.miniRotulo}>Comprovantes{d.comprovantes && d.comprovantes.valor ? ` · ${reais(d.comprovantes.valor)}` : ''}</span></div>
            <div className={c.miniItem}><span className={c.miniValor}>{d.comprovantes ? d.comprovantes.suspeitos : '—'}</span><span className={c.miniRotulo}>Suspeitos</span></div>
            <div className={c.miniItem}><span className={c.miniValor}>{d.comprovantes ? d.comprovantes.conferidos : '—'}</span><span className={c.miniRotulo}>Conferidos</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
