'use client';

import { useEffect, useState } from 'react';
import { arquivarOportunidade, carregarComercial, editarOportunidade } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { Campo, Janela, NovaOportunidade, useEnvio } from './Formularios';
import { casaBusca, criarFormatos, telefoneBonito } from './util';
import c from './crm.module.css';

type Oportunidade = { id: string; etapa_id: string; interesse: string | null; valor: number | null; atualizado_em: string; nome: string | null; telefone: string | null };
type Dados = { etapas: { id: string; nome: string; tipo: string }[]; oportunidades: Oportunidade[] };

const reais = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

// Funil comercial: a IA move os cartões; a equipe também cria, move, edita e arquiva.
export function Comercial({ busca, fuso, podeEditar, podeArquivar, onAviso }: {
  busca: string; fuso: string; podeEditar: boolean; podeArquivar: boolean; onAviso: (t: string) => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const fmt = criarFormatos(fuso);
  useEffect(() => {
    carregarComercial().then((r) => (r.ok ? setDados(r.dados) : setErro(r.erro)));
  }, []);
  if (erro) return <div className={c.vazioTela}>{erro}</div>;
  if (!dados) return <div className={c.vazioTela}>Carregando o funil…</div>;
  const ops = dados.oportunidades.filter((o) => casaBusca(busca, [o.nome, o.telefone, o.interesse]));
  const atual = aberta ? dados.oportunidades.find((o) => o.id === aberta) ?? null : null;
  return (
    <>
      <div className={c.barra}>
        <p className={c.nota}>Um cartão por oportunidade de consulta. A IA move sozinha; a equipe pode ajustar.</p>
        {podeEditar && dados.etapas.length > 0 && (
          <button type="button" className={c.botaoNovo} onClick={() => setNovo(true)}><Icone nome="check" tamanho={14} /> Nova oportunidade</button>
        )}
      </div>
      <div className={c.quadro}>
        {dados.etapas.map((e) => {
          const cs = ops.filter((o) => o.etapa_id === e.id);
          const total = cs.reduce((s, o) => s + (o.valor ?? 0), 0);
          return (
            <section key={e.id} className={c.colunaCom} aria-label={e.nome}>
              <div className={c.colTopo}>
                <span className={c.marcaEtapa} data-tipo={e.tipo}>{e.tipo === 'ganho' ? 'Ganho' : e.tipo === 'perdido' ? 'Perdido' : 'Em andamento'}</span>
                <span className={c.colNome} title={e.nome}>{e.nome}</span>
                <span className={c.colN}>{cs.length}</span>
              </div>
              {total > 0 && <span className={c.detMeta}>{reais(total)}</span>}
              {cs.map((o) => (
                <article key={o.id} className={c.cartaoCom} role={podeEditar ? 'button' : undefined} tabIndex={podeEditar ? 0 : undefined}
                  aria-label={podeEditar ? `Editar oportunidade de ${o.nome || 'contato sem nome'}` : undefined}
                  onClick={podeEditar ? () => setAberta(o.id) : undefined}
                  onKeyDown={podeEditar ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setAberta(o.id); } } : undefined}>
                  <strong>{o.nome || 'Contato sem nome'}</strong>
                  {o.interesse && <span className={c.resumo}>{o.interesse}</span>}
                  <span className={c.detMeta}>{o.telefone ? telefoneBonito(o.telefone) + ' · ' : ''}atualizado {fmt.quando(o.atualizado_em)}</span>
                  {o.valor !== null && <span className={c.chipNeutro}>{reais(o.valor)}</span>}
                </article>
              ))}
              {!cs.length && <div className={c.nadaAberto}>Vazio</div>}
            </section>
          );
        })}
      </div>
      {novo && (
        <NovaOportunidade<Dados> etapas={dados.etapas} onFechar={() => setNovo(false)}
          onPronto={(d) => { setDados(d); setNovo(false); onAviso('Oportunidade criada.'); }} />
      )}
      {atual && (
        <EditarOportunidade key={atual.id} o={atual} etapas={dados.etapas} podeArquivar={podeArquivar} onFechar={() => setAberta(null)}
          onPronto={(d, msg) => { setDados(d); setAberta(null); onAviso(msg); }} />
      )}
    </>
  );
}

function EditarOportunidade({ o, etapas, podeArquivar, onFechar, onPronto }: {
  o: Oportunidade; etapas: Dados['etapas']; podeArquivar: boolean; onFechar: () => void; onPronto: (d: Dados, msg: string) => void;
}) {
  const [f, setF] = useState({
    interesse: o.interesse ?? '', etapa_id: o.etapa_id,
    valor: o.valor === null ? '' : o.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, useGrouping: false }),
  });
  const [confirmar, setConfirmar] = useState(false);
  const { erro, enviando, enviar } = useEnvio<Dados>();
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Janela titulo={o.nome || 'Contato sem nome'} onFechar={onFechar}>
      <form className={c.formJanela} onSubmit={(e) => { e.preventDefault(); enviar(() => editarOportunidade(o.id, f), (d) => onPronto(d, 'Oportunidade salva.')); }}>
        {o.telefone && <p className={c.detMeta}>{telefoneBonito(o.telefone)}</p>}
        <Campo id="op-etapa" rotulo="Etapa do funil">
          <select id="op-etapa" value={f.etapa_id} onChange={mudar('etapa_id')}>
            {etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </Campo>
        <Campo id="op-interesse" rotulo="Interesse">
          <input id="op-interesse" value={f.interesse} onChange={mudar('interesse')} maxLength={300} />
        </Campo>
        <Campo id="op-valor" rotulo="Valor (R$)">
          <input id="op-valor" inputMode="decimal" value={f.valor} onChange={mudar('valor')} />
        </Campo>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}>
          <button type="button" className={c.acaoSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
      {podeArquivar && (
        <section className={c.detBloco}>
          {!confirmar ? (
            <button type="button" className={c.botaoPerigo} onClick={() => setConfirmar(true)} disabled={enviando}>
              <Icone nome="arquivo" tamanho={15} /> Arquivar oportunidade
            </button>
          ) : (
            <div className={c.confirmar}>
              <span>Arquivar tira o cartão do funil. Ele continua guardado no banco.</span>
              <div className={c.acoes}>
                <button type="button" className={c.acaoSec} onClick={() => setConfirmar(false)}>Cancelar</button>
                <button type="button" className={c.botaoPerigoCheio} disabled={enviando}
                  onClick={() => enviar(() => arquivarOportunidade(o.id), (d) => onPronto(d, 'Oportunidade arquivada.'))}>Arquivar</button>
              </div>
            </div>
          )}
        </section>
      )}
    </Janela>
  );
}
