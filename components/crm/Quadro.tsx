'use client';

import type { Cartao, Etapa, Quadro as TQuadro } from '@/lib/painel/crm';
import { Icone } from '@/components/Icone';
import type { Origem } from './Crm';
import { casaBusca, cpfBonito, duracao, ha, telefoneBonito, type criarFormatos } from './util';
import c from './crm.module.css';

type Fmt = ReturnType<typeof criarFormatos>;
const ORDEM: Record<Etapa, number> = { aguardando: 0, em_atendimento: 1, pendente: 2, finalizado: 3 };

export function filtrar(cartoes: Cartao[], busca: string, origem: Origem, verFinal: boolean) {
  return cartoes.filter((k) =>
    (verFinal || k.etapa !== 'finalizado')
    && (origem === 'todos' || (origem === 'sombra') === k.sombra)
    && casaBusca(busca, [k.nome, k.telefone, k.documento, k.resumo, k.responsavel]));
}

export function Quadro({ quadro, busca, origem, verFinal, fmt, ocupado, podeEditar, podeConfig, onAbrir, onAssumir, onMover }: {
  quadro: TQuadro; busca: string; origem: Origem; verFinal: boolean; fmt: Fmt; ocupado: boolean; podeEditar: boolean; podeConfig: boolean;
  onAbrir: (id: string) => void; onAssumir: (id: string) => void; onMover: (id: string, e: Etapa) => void;
}) {
  const vis = filtrar(quadro.cartoes, busca, origem, verFinal).sort((a, b) =>
    ORDEM[a.etapa] - ORDEM[b.etapa] || (a.etapa === 'aguardando' ? a.aberto_em.localeCompare(b.aberto_em) : b.aberto_em.localeCompare(a.aberto_em)));
  const ids = new Set(quadro.topicos.map((t) => t.id));
  const colunas = [...quadro.topicos.map((t) => ({ id: t.id, nome: t.nome, icone: t.icone }))];
  if (vis.some((k) => !k.topico_id || !ids.has(k.topico_id))) colunas.push({ id: '__sem', nome: 'Sem assunto', icone: 'outros' });

  if (!quadro.topicos.length) {
    return (
      <div className={c.vazioTela}>
        Nenhum assunto configurado no CRM.{' '}
        {podeConfig ? <a className={c.linkBotao} href="/configuracoes">Cadastrar assuntos em Configurações</a> : 'Peça a quem configura o CRM para cadastrar.'}
      </div>
    );
  }

  return (
    <div className={c.quadro}>
      {colunas.map((col) => {
        const cs = vis.filter((k) => (col.id === '__sem' ? !k.topico_id || !ids.has(k.topico_id) : k.topico_id === col.id));
        return (
          <section key={col.id} className={cs.length ? c.coluna : c.colunaVazia} aria-label={col.nome}>
            <div className={c.colTopo}>
              <span className={c.colIcone}><Icone nome={col.icone} tamanho={16} /></span>
              <span className={c.colNome} title={col.nome}>{col.nome}</span>
              <span className={c.colN}>{cs.length}</span>
            </div>
            {cs.map((k) => <CartaoQuadro key={k.id} k={k} quadro={quadro} fmt={fmt} ocupado={ocupado} podeEditar={podeEditar} onAbrir={onAbrir} onAssumir={onAssumir} onMover={onMover} />)}
            {!cs.length && <div className={c.nadaAberto}>{busca ? 'Nada com essa busca' : 'Nada aberto'}</div>}
          </section>
        );
      })}
    </div>
  );
}

function CartaoQuadro({ k, quadro, fmt, ocupado, podeEditar, onAbrir, onAssumir, onMover }: {
  k: Cartao; quadro: TQuadro; fmt: Fmt; ocupado: boolean; podeEditar: boolean;
  onAbrir: (id: string) => void; onAssumir: (id: string) => void; onMover: (id: string, e: Etapa) => void;
}) {
  const fim = k.etapa === 'finalizado';
  return (
    <article className={fim ? c.cartaoFim : c.cartao} onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a')) onAbrir(k.id); }}>
      <div className={c.cartaoTopo}>
        <EtapaPill etapa={k.etapa} nome={quadro.etapas[k.etapa]} />
        {k.sombra && <span className={c.selo} title="Aberto pela Sara nova no modo sombra (não foi para o paciente)">sombra</span>}
      </div>
      <div className={c.cartaoNome}>
        <button type="button" className={c.nomeBotao} onClick={() => onAbrir(k.id)}>{k.nome || 'Contato sem nome'}</button>
        <span className={c.resumo}>{k.resumo || 'Sem resumo.'}</span>
      </div>
      <div className={c.cartaoMeta}>
        <span><Icone nome="relogio" tamanho={14} /><span><span className={c.metaRot}>Aberto</span> {fmt.quando(k.aberto_em)}{k.aberto_por ? ` · ${k.aberto_por}` : ''}{!fim && k.etapa === 'aguardando' ? ` · ${ha(k.aberto_em)}` : ''}</span></span>
        <span><Icone nome="pessoa" tamanho={14} /><span><span className={c.metaRot}>Responsável</span> {k.responsavel
          ? `${k.responsavel}${k.assumido_em ? ` · ${fmt.quando(k.assumido_em)} (${duracao(k.aberto_em, k.assumido_em)} após abrir)` : ''}`
          : 'ninguém assumiu'}</span></span>
        {fim && k.finalizado_em && <span><Icone nome="finalizado" tamanho={14} /><span><span className={c.metaRot}>Finalizado</span> {fmt.quando(k.finalizado_em)} · total {duracao(k.aberto_em, k.finalizado_em)}</span></span>}
      </div>
      <div className={c.chips}>
        {k.telefone && <span className={c.chipNeutro + ' ' + c.mono}>{telefoneBonito(k.telefone)}</span>}
        {k.documento && <span className={c.chipNeutro + ' ' + c.mono}>CPF {cpfBonito(k.documento)}</span>}
        {k.notas > 0 && <span className={c.chipNeutro}><Icone nome="nota" tamanho={12} /> {k.notas} {k.notas === 1 ? 'nota' : 'notas'}</span>}
        {k.lead && <span className={c.chipNeutro}>lead no funil</span>}
      </div>
      {podeEditar && <Acoes k={k} quadro={quadro} ocupado={ocupado} onAssumir={onAssumir} onMover={onMover} />}
    </article>
  );
}

export function EtapaPill({ etapa, nome }: { etapa: Etapa; nome: string }) {
  return <span className={c.pill} data-etapa={etapa}><Icone nome={etapa} tamanho={12} />{nome}</span>;
}

export function Acoes({ k, quadro, ocupado, onAssumir, onMover }: {
  k: Cartao; quadro: TQuadro; ocupado: boolean; onAssumir: (id: string) => void; onMover: (id: string, e: Etapa) => void;
}) {
  const b = (rotulo: string, fn: () => void, forte: boolean) => (
    <button key={rotulo} type="button" className={forte ? c.acaoPri : c.acaoSec} disabled={ocupado} onClick={fn}>{rotulo}</button>
  );
  return (
    <div className={c.acoes}>
      {k.etapa === 'aguardando' && b('Assumir', () => onAssumir(k.id), true)}
      {k.etapa === 'em_atendimento' && [b(quadro.etapas.pendente, () => onMover(k.id, 'pendente'), false), b('Finalizar', () => onMover(k.id, 'finalizado'), true)]}
      {k.etapa === 'pendente' && [b('Retomar', () => onMover(k.id, 'em_atendimento'), false), b('Finalizar', () => onMover(k.id, 'finalizado'), true)]}
      {k.etapa === 'finalizado' && b('Reabrir', () => onMover(k.id, 'aguardando'), false)}
    </div>
  );
}
