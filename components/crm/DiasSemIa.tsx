'use client';

import { useEffect, useState } from 'react';
import { carregarDiasSemIa, salvarDiasSemIa } from '@/lib/painel/acoes';
import type { DiaFechado, DiasSemIa as TDias } from '@/lib/painel/dias-sem-ia';
import { Janela, Campo, useEnvio } from './Formularios';
import c from './crm.module.css';

// "Dias sem marcação pela IA" (14/10): a equipe fecha um dia da agenda para a IA (o médico atende em outra cidade,
// por exemplo). Cada mudança grava a lista inteira na config do CRM ("agenda_fechada"), que a IA copia.
const dataBonita = (d: string) => {
  const [a, m, dia] = d.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, dia, 12)).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
};

export function DiasSemIa({ onFechar, onSalvo }: { onFechar: () => void; onSalvo: (texto: string) => void }) {
  const [estado, setEstado] = useState<TDias | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [novo, setNovo] = useState({ prof: '', data: '', motivo: '' });
  const { erro, enviando, enviar } = useEnvio<TDias>();

  useEffect(() => {
    void carregarDiasSemIa().then((r) => {
      if (r.ok) setEstado(r.dados);
      else if (r.sair) window.location.href = '/entrar?motivo=sessao';
      else setErroCarga(r.erro);
    });
  }, []);

  const nomeProf = (id: number | null) => (id === null ? 'Todos os profissionais' : estado?.profissionais.find((p) => p.id === id)?.nome ?? `Profissional ${id}`);
  const salvar = (dias: DiaFechado[], texto: string, depois?: () => void) =>
    enviar(() => salvarDiasSemIa(dias), (d) => { setEstado(d); onSalvo(texto); depois?.(); });

  return (
    <Janela titulo="Dias sem marcação pela IA" onFechar={onFechar}>
      <p className={c.notaJanela} role="note" data-aviso-dias>
        Nesses dias a IA não oferece horário, não marca e não remarca para o profissional escolhido.
        Fechar o dia não desmarca quem já está marcado nele. Confira a agenda da Feegow.
      </p>
      {erroCarga && <p className={c.erroForm} role="alert">{erroCarga}</p>}
      {!estado && !erroCarga && <p className={c.notaJanela}>Carregando…</p>}
      {estado && (
        <>
          {estado.dias.length ? (
            <ul className={c.listaDias} aria-label="Dias fechados">
              {estado.dias.map((d) => (
                <li key={`${d.prof ?? '*'}|${d.data}`} data-dia-fechado={d.data}>
                  <span>
                    <strong>{dataBonita(d.data)}</strong> · {nomeProf(d.prof)}
                    {d.motivo ? <small> · {d.motivo}</small> : null}
                  </span>
                  <button type="button" className={c.acaoSec} disabled={enviando}
                    onClick={() => salvar(estado.dias.filter((x) => x !== d), `Dia ${dataBonita(d.data)} reaberto para a IA.`)}>
                    Reabrir
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className={c.notaJanela}>Nenhum dia fechado.</p>}

          <form className={c.formJanela} aria-label="Fechar um dia" onSubmit={(e) => {
            e.preventDefault();
            const prof = novo.prof ? Number(novo.prof) : null;
            salvar([...estado.dias, { prof, data: novo.data, motivo: novo.motivo.trim() }], `Dia ${dataBonita(novo.data)} fechado para a IA.`,
              () => setNovo({ prof: novo.prof, data: '', motivo: '' }));
          }}>
            <Campo id="dia-prof" rotulo="Profissional">
              <select id="dia-prof" value={novo.prof} onChange={(e) => setNovo({ ...novo, prof: e.target.value })}>
                <option value="">Todos os profissionais</option>
                {estado.profissionais.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <Campo id="dia-data" rotulo="Data">
              <input id="dia-data" type="date" min={estado.hoje} required value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
            </Campo>
            <Campo id="dia-motivo" rotulo="Motivo" dica="Opcional. Ex.: atende em outra cidade.">
              <input id="dia-motivo" maxLength={120} autoComplete="off" value={novo.motivo} onChange={(e) => setNovo({ ...novo, motivo: e.target.value })} />
            </Campo>
            {erro && <p className={c.erroForm} role="alert">{erro}</p>}
            <div className={c.acoesFim}><button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Fechar o dia'}</button></div>
          </form>
        </>
      )}
    </Janela>
  );
}
