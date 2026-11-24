'use client';

import { useState } from 'react';
import type { TelaAgenda, Profissional, Tipo } from '@/lib/painel/agenda-propria';
import { arquivarDaAgenda, salvarBloqueio, salvarConfigAgenda, salvarGrade, salvarProfissional, salvarTipo } from '@/lib/painel/acoes-agenda-propria';
import { Painel, isoDe } from './comum';
import c from './propria.module.css';

// Configuração da agenda própria (agenda.config): quem atende, tipos de atendimento, horários de cada um, bloqueios
// (férias, congresso) e regras (antecedência, limite de dias, intervalo). Genérico: serve para clínica ou qualquer serviço.

type Aba = 'profissionais' | 'tipos' | 'horarios' | 'bloqueios' | 'regras';
const ABAS: [Aba, string][] = [['profissionais', 'Quem atende'], ['tipos', 'Tipos de atendimento'], ['horarios', 'Horários'], ['bloqueios', 'Bloqueios'], ['regras', 'Regras']];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];
const MODALIDADES: Record<string, string> = { presencial: 'Presencial', online: 'Online', domicilio: 'Em domicílio' };

type R = { ok: true } | { ok: false; erro: string };

export function ConfigAgenda({ dados, onFechar, onMudou }: { dados: TelaAgenda; onFechar: () => void; onMudou: () => void }) {
  const [aba, setAba] = useState<Aba>(dados.profissionais.length ? (dados.tipos.length ? 'horarios' : 'tipos') : 'profissionais');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function feito(p: Promise<R>, txt: string) {
    setEnviando(true); setErro(null); setOk(null);
    const r = await p;
    setEnviando(false);
    if (r.ok) { setOk(txt); onMudou(); return true; }
    setErro(r.erro); return false;
  }
  return (
    <Painel titulo="Configurar agenda" onFechar={onFechar} largo>
      <div className={c.abas} role="tablist">
        {ABAS.map(([id, nome]) => (
          <button key={id} type="button" role="tab" className={c.chip} aria-pressed={aba === id} aria-selected={aba === id}
            onClick={() => { setAba(id); setErro(null); setOk(null); }} data-aba-agenda={id}>{nome}</button>
        ))}
      </div>
      {erro && <p className={c.erro} role="alert">{erro}</p>}
      {ok && <p className={c.ok} role="status">{ok}</p>}
      {aba === 'profissionais' && <AbaProfissionais dados={dados} enviando={enviando} feito={feito} />}
      {aba === 'tipos' && <AbaTipos dados={dados} enviando={enviando} feito={feito} />}
      {aba === 'horarios' && <AbaHorarios dados={dados} enviando={enviando} feito={feito} />}
      {aba === 'bloqueios' && <AbaBloqueios dados={dados} enviando={enviando} feito={feito} />}
      {aba === 'regras' && <AbaRegras dados={dados} enviando={enviando} feito={feito} />}
    </Painel>
  );
}

type PropsAba = { dados: TelaAgenda; enviando: boolean; feito: (p: Promise<R>, txt: string) => Promise<boolean> };

function AbaProfissionais({ dados, enviando, feito }: PropsAba) {
  const vazio = { id: '', nome: '', descricao: '', cor: '#2563eb', email: '' };
  const [f, setF] = useState(vazio);
  const editar = (p: Profissional) => setF({ id: p.id, nome: p.nome, descricao: p.descricao ?? '', cor: p.cor ?? '#2563eb', email: p.email ?? '' });
  return (
    <>
      <p className={c.sub}>Quem atende: médico, terapeuta, técnico, consultor. Cada um tem a própria cor e os próprios horários.</p>
      <ul className={c.lista}>
        {dados.profissionais.map((p) => (
          <li key={p.id} className={c.item} data-item-profissional={p.nome}>
            <span className={c.bolinha} style={{ ['--evento' as string]: p.cor ?? '#2563eb' }} />
            <span className={c.espaco}><strong>{p.nome}</strong>{p.descricao && <span className={c.sub}> · {p.descricao}</span>}</span>
            <button type="button" className={c.botaoSec} onClick={() => editar(p)}>Editar</button>
            <button type="button" className={c.botaoPerigo} disabled={enviando}
              onClick={() => { if (window.confirm(`Tirar ${p.nome} da agenda? Os agendamentos já marcados continuam.`)) feito(arquivarDaAgenda('profissional', p.id), 'Removido da agenda.'); }}>Remover</button>
          </li>
        ))}
        {!dados.profissionais.length && <li className={c.sub}>Ninguém cadastrado ainda.</li>}
      </ul>
      <h3>{f.id ? 'Editar' : 'Adicionar'}</h3>
      <div className={c.linha}>
        <label className={c.campo}>Nome<input value={f.nome} maxLength={120} onChange={(e) => setF({ ...f, nome: e.target.value })} data-campo-prof-nome /></label>
        <label className={c.campo}>Especialidade ou função<input value={f.descricao} maxLength={200} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
      </div>
      <div className={c.linha}>
        <label className={c.campo}>E-mail (opcional)<input type="email" value={f.email} maxLength={200} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className={c.campo}>Cor<input type="color" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} /></label>
      </div>
      <div className={c.acoes}>
        <button type="button" className={c.botao} disabled={enviando || !f.nome.trim()} data-salvar-profissional
          onClick={async () => { if (await feito(salvarProfissional({ ...f, id: f.id || undefined }), f.id ? 'Profissional atualizado.' : 'Profissional adicionado.')) setF(vazio); }}>
          {f.id ? 'Salvar' : 'Adicionar'}
        </button>
        {f.id && <button type="button" className={c.botaoSec} onClick={() => setF(vazio)}>Cancelar edição</button>}
      </div>
    </>
  );
}

function AbaTipos({ dados, enviando, feito }: PropsAba) {
  const vazio = { id: '', nome: '', duracao_min: '60', valor: '', modalidade: 'presencial', cor: '#16a34a', descricao: '', profissionais: [] as string[], publico: true };
  const [f, setF] = useState(vazio);
  const editar = (t: Tipo) => setF({ id: t.id, nome: t.nome, duracao_min: String(t.duracao_min), valor: t.valor === null ? '' : String(t.valor), modalidade: t.modalidade,
    cor: t.cor ?? '#16a34a', descricao: t.descricao ?? '', profissionais: t.profissionais, publico: t.publico });
  const marcarProf = (id: string, sim: boolean) => setF({ ...f, profissionais: sim ? [...f.profissionais, id] : f.profissionais.filter((x) => x !== id) });
  return (
    <>
      <p className={c.sub}>O que se marca: consulta, retorno, avaliação, visita técnica. A duração define o tamanho de cada horário.</p>
      <ul className={c.lista}>
        {dados.tipos.map((t) => (
          <li key={t.id} className={c.item} data-item-tipo={t.nome}>
            <span className={c.bolinha} style={{ ['--evento' as string]: t.cor ?? '#16a34a' }} />
            <span className={c.espaco}><strong>{t.nome}</strong> <span className={c.sub}>· {t.duracao_min} min · {MODALIDADES[t.modalidade] ?? t.modalidade}
              {t.valor !== null ? ` · ${t.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}
              {t.profissionais.length ? ` · ${t.profissionais.length} profissional(is)` : ' · todos'}</span></span>
            <button type="button" className={c.botaoSec} onClick={() => editar(t)}>Editar</button>
            <button type="button" className={c.botaoPerigo} disabled={enviando}
              onClick={() => { if (window.confirm(`Remover "${t.nome}"? Os agendamentos já marcados continuam.`)) feito(arquivarDaAgenda('tipo', t.id), 'Tipo removido.'); }}>Remover</button>
          </li>
        ))}
        {!dados.tipos.length && <li className={c.sub}>Nenhum tipo cadastrado ainda.</li>}
      </ul>
      <h3>{f.id ? 'Editar' : 'Adicionar'}</h3>
      <div className={c.linha}>
        <label className={c.campo}>Nome<input value={f.nome} maxLength={120} onChange={(e) => setF({ ...f, nome: e.target.value })} data-campo-tipo-nome /></label>
        <label className={c.campo}>Duração (min)<input type="number" min={5} max={720} step={5} value={f.duracao_min} onChange={(e) => setF({ ...f, duracao_min: e.target.value })} data-campo-tipo-duracao /></label>
        <label className={c.campo}>Valor (R$, opcional)<input type="number" min={0} step="0.01" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></label>
      </div>
      <div className={c.linha}>
        <label className={c.campo}>Modalidade
          <select value={f.modalidade} onChange={(e) => setF({ ...f, modalidade: e.target.value })}>
            {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={c.campo}>Cor<input type="color" value={f.cor} onChange={(e) => setF({ ...f, cor: e.target.value })} /></label>
      </div>
      <label className={c.campo}>Descrição (a IA e o link público usam)<textarea value={f.descricao} maxLength={500} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
      {dados.profissionais.length > 0 && (
        <div>
          <span className={c.sub}>Quem faz este atendimento (nenhum marcado = todos)</span>
          <div className={c.chips}>
            {dados.profissionais.map((p) => (
              <label key={p.id} className={c.marcar}><input type="checkbox" checked={f.profissionais.includes(p.id)} onChange={(e) => marcarProf(p.id, e.target.checked)} /> {p.nome}</label>
            ))}
          </div>
        </div>
      )}
      <label className={c.marcar}><input type="checkbox" checked={f.publico} onChange={(e) => setF({ ...f, publico: e.target.checked })} /> Pode ser marcado pela IA e pelo link público</label>
      <div className={c.acoes}>
        <button type="button" className={c.botao} disabled={enviando || !f.nome.trim()} data-salvar-tipo
          onClick={async () => { if (await feito(salvarTipo({ ...f, id: f.id || undefined, duracao_min: Number(f.duracao_min) }), f.id ? 'Tipo atualizado.' : 'Tipo adicionado.')) setF(vazio); }}>
          {f.id ? 'Salvar' : 'Adicionar'}
        </button>
        {f.id && <button type="button" className={c.botaoSec} onClick={() => setF(vazio)}>Cancelar edição</button>}
      </div>
    </>
  );
}

type JanelaEd = { inicio: string; fim: string };
function AbaHorarios({ dados, enviando, feito }: PropsAba) {
  const [prof, setProf] = useState(dados.profissionais[0]?.id ?? '');
  const gradeDe = (id: string) => {
    const g: Record<number, JanelaEd[]> = {};
    for (const j of dados.grade.filter((x) => x.profissional_id === id).sort((a, b) => a.inicio.localeCompare(b.inicio))) (g[j.dia_semana] ??= []).push({ inicio: j.inicio, fim: j.fim });
    return g;
  };
  const [grade, setGrade] = useState<Record<number, JanelaEd[]>>(() => gradeDe(prof));
  if (!dados.profissionais.length) return <p className={c.aviso}>Cadastre primeiro quem atende, na aba Quem atende.</p>;
  const trocar = (id: string) => { setProf(id); setGrade(gradeDe(id)); };
  const mudar = (dia: number, i: number, campo: 'inicio' | 'fim', v: string) => setGrade({ ...grade, [dia]: (grade[dia] ?? []).map((j, k) => (k === i ? { ...j, [campo]: v } : j)) });
  const somar = (dia: number) => {
    const l = grade[dia] ?? [];
    setGrade({ ...grade, [dia]: [...l, l.length ? { inicio: '14:00', fim: '18:00' } : { inicio: '09:00', fim: '12:00' }] });
  };
  const tirar = (dia: number, i: number) => setGrade({ ...grade, [dia]: (grade[dia] ?? []).filter((_, k) => k !== i) });
  const copiarSegunda = () => {
    const base = grade[1] ?? [];
    setGrade({ ...grade, 2: base.map((j) => ({ ...j })), 3: base.map((j) => ({ ...j })), 4: base.map((j) => ({ ...j })), 5: base.map((j) => ({ ...j })) });
  };
  const janelas = Object.entries(grade).flatMap(([dia, l]) => l.map((j) => ({ dia_semana: Number(dia), inicio: j.inicio, fim: j.fim })));
  return (
    <>
      <label className={c.campo}>Profissional
        <select value={prof} onChange={(e) => trocar(e.target.value)} data-grade-profissional>
          {dados.profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      <p className={c.sub}>Os períodos em que atende, em cada dia da semana (horário de {dados.fuso.replace('_', ' ')}). Fora deles, ninguém marca, nem a IA; só a equipe, como encaixe.</p>
      <div>
        {ORDEM_DIAS.map((dia) => (
          <div key={dia} className={c.diaGrade} data-dia-grade={dia}>
            <strong>{DIAS[dia]}</strong>
            <div>
              {(grade[dia] ?? []).map((j, i) => (
                <div key={i} className={c.janela}>
                  <input type="time" value={j.inicio} step={300} onChange={(e) => mudar(dia, i, 'inicio', e.target.value)} aria-label={`${DIAS[dia]} início`} />
                  <span className={c.sub}>às</span>
                  <input type="time" value={j.fim} step={300} onChange={(e) => mudar(dia, i, 'fim', e.target.value)} aria-label={`${DIAS[dia]} fim`} />
                  <button type="button" className={c.fechar} onClick={() => tirar(dia, i)} aria-label="Tirar período">✕</button>
                </div>
              ))}
              {!(grade[dia] ?? []).length && <span className={c.semGrade}>Não atende</span>}
              <div><button type="button" className={c.botaoSec} onClick={() => somar(dia)} data-somar-periodo={dia}>+ Período</button></div>
            </div>
          </div>
        ))}
      </div>
      <div className={c.acoes}>
        <button type="button" className={c.botao} disabled={enviando} data-salvar-grade onClick={() => feito(salvarGrade(prof, janelas), 'Horários salvos.')}>Salvar horários</button>
        <button type="button" className={c.botaoSec} onClick={copiarSegunda} data-copiar-segunda>Copiar segunda para terça a sexta</button>
      </div>
    </>
  );
}

function AbaBloqueios({ dados, enviando, feito }: PropsAba) {
  const [f, setF] = useState({ profissional_id: '', dia_ini: dados.de, hora_ini: '08:00', dia_fim: dados.de, hora_fim: '18:00', motivo: '' });
  const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: dados.fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <p className={c.sub}>Férias, congresso, feriado: ninguém marca nesse período. Sem profissional, vale para todos.</p>
      <ul className={c.lista}>
        {dados.bloqueios.map((b) => (
          <li key={b.id} className={c.item}>
            <span className={c.espaco}><strong>{b.motivo || 'Bloqueado'}</strong> <span className={c.sub}>· {quando(b.inicio)} a {quando(b.fim)} ·
              {' '}{dados.profissionais.find((p) => p.id === b.profissional_id)?.nome ?? 'todos'}</span></span>
            <button type="button" className={c.botaoPerigo} disabled={enviando} onClick={() => feito(arquivarDaAgenda('bloqueio', b.id), 'Bloqueio removido.')}>Remover</button>
          </li>
        ))}
        {!dados.bloqueios.length && <li className={c.sub}>Nenhum bloqueio no período que está na tela.</li>}
      </ul>
      <h3>Novo bloqueio</h3>
      <label className={c.campo}>Profissional
        <select value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value })}>
          <option value="">Todos</option>
          {dados.profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      <div className={c.linha}>
        <label className={c.campo}>De<input type="date" value={f.dia_ini} onChange={(e) => setF({ ...f, dia_ini: e.target.value, dia_fim: e.target.value > f.dia_fim ? e.target.value : f.dia_fim })} /></label>
        <label className={c.campo}>Hora<input type="time" value={f.hora_ini} onChange={(e) => setF({ ...f, hora_ini: e.target.value })} /></label>
        <label className={c.campo}>Até<input type="date" value={f.dia_fim} onChange={(e) => setF({ ...f, dia_fim: e.target.value })} /></label>
        <label className={c.campo}>Hora<input type="time" value={f.hora_fim} onChange={(e) => setF({ ...f, hora_fim: e.target.value })} /></label>
      </div>
      <label className={c.campo}>Motivo<input value={f.motivo} maxLength={200} onChange={(e) => setF({ ...f, motivo: e.target.value })} placeholder="Férias, congresso…" /></label>
      <div className={c.acoes}>
        <button type="button" className={c.botao} disabled={enviando} data-salvar-bloqueio
          onClick={() => feito(salvarBloqueio({ profissional_id: f.profissional_id || null, inicio: isoDe(f.dia_ini, f.hora_ini, dados.fuso), fim: isoDe(f.dia_fim, f.hora_fim, dados.fuso), motivo: f.motivo }), 'Bloqueio criado.')}>
          Bloquear
        </button>
      </div>
    </>
  );
}

function AbaRegras({ dados, enviando, feito }: PropsAba) {
  const [f, setF] = useState({
    antecedencia_h: String(Math.round(dados.config.antecedencia_min / 60 * 10) / 10), limite_dias: String(dados.config.limite_dias),
    passo_min: dados.config.passo_min === null ? '' : String(dados.config.passo_min), fuso: dados.config.fuso,
  });
  return (
    <>
      <p className={c.sub}>Valem para a IA e para o link público. A equipe pode marcar fora delas como encaixe.</p>
      <div className={c.linha}>
        <label className={c.campo}>Antecedência mínima (horas)<input type="number" min={0} step="0.5" value={f.antecedencia_h} onChange={(e) => setF({ ...f, antecedencia_h: e.target.value })} data-campo-antecedencia /></label>
        <label className={c.campo}>Marcar até quantos dias à frente<input type="number" min={1} max={365} value={f.limite_dias} onChange={(e) => setF({ ...f, limite_dias: e.target.value })} /></label>
      </div>
      <div className={c.linha}>
        <label className={c.campo}>Intervalo entre horários (min; vazio = a duração do tipo)<input type="number" min={5} max={240} step={5} value={f.passo_min} onChange={(e) => setF({ ...f, passo_min: e.target.value })} /></label>
        <label className={c.campo}>Fuso horário<input value={f.fuso} onChange={(e) => setF({ ...f, fuso: e.target.value })} /></label>
      </div>
      <div className={c.acoes}>
        <button type="button" className={c.botao} disabled={enviando} data-salvar-regras
          onClick={() => feito(salvarConfigAgenda({ antecedencia_min: Math.round(Number(f.antecedencia_h) * 60), limite_dias: Number(f.limite_dias), passo_min: f.passo_min, fuso: f.fuso }), 'Regras salvas.')}>
          Salvar regras
        </button>
      </div>
    </>
  );
}
