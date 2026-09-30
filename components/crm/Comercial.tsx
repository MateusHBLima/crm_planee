'use client';

import { useEffect, useState } from 'react';
import { carregarComercial } from '@/lib/painel/acoes';
import { casaBusca, criarFormatos, telefoneBonito } from './util';
import c from './crm.module.css';

type Dados = { etapas: { id: string; nome: string; tipo: string }[]; oportunidades: { id: string; etapa_id: string; interesse: string | null; valor: number | null; atualizado_em: string; nome: string | null; telefone: string | null }[] };

// Funil comercial, só leitura: quem move os cartões é a IA (e, mais adiante, a equipe).
export function Comercial({ busca, fuso }: { busca: string; fuso: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fmt = criarFormatos(fuso);
  useEffect(() => {
    carregarComercial().then((r) => (r.ok ? setDados(r.dados) : setErro(r.erro)));
  }, []);
  if (erro) return <div className={c.vazioTela}>{erro}</div>;
  if (!dados) return <div className={c.vazioTela}>Carregando o funil…</div>;
  const ops = dados.oportunidades.filter((o) => casaBusca(busca, [o.nome, o.telefone, o.interesse]));
  return (
    <>
      <p className={c.nota}>Um cartão por oportunidade de consulta. Quem move é a IA; a equipe acompanha.</p>
      <div className={c.quadro}>
        {dados.etapas.map((e) => {
          const cs = ops.filter((o) => o.etapa_id === e.id);
          return (
            <section key={e.id} className={c.colunaCom} aria-label={e.nome}>
              <div className={c.colTopo}>
                <span className={c.marcaEtapa} data-tipo={e.tipo}>{e.tipo === 'ganho' ? 'Ganho' : e.tipo === 'perdido' ? 'Perdido' : 'Em andamento'}</span>
                <span className={c.colNome} title={e.nome}>{e.nome}</span>
                <span className={c.colN}>{cs.length}</span>
              </div>
              {cs.map((o) => (
                <article key={o.id} className={c.cartaoCom}>
                  <strong>{o.nome || 'Contato sem nome'}</strong>
                  {o.interesse && <span className={c.resumo}>{o.interesse}</span>}
                  <span className={c.detMeta}>{o.telefone ? telefoneBonito(o.telefone) + ' · ' : ''}atualizado {fmt.quando(o.atualizado_em)}</span>
                  {o.valor !== null && <span className={c.chipNeutro}>R$ {o.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                </article>
              ))}
              {!cs.length && <div className={c.nadaAberto}>Vazio</div>}
            </section>
          );
        })}
      </div>
    </>
  );
}
