'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import type { Quadro as TQuadro } from '@/lib/painel/crm';
import { criarAtendimento, criarOportunidade, salvarContato, type Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import c from './crm.module.css';

// Janela lateral (mesmo visual do detalhe do atendimento) para os formulários de criação e edição.
export function Janela({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  const painel = useRef<HTMLElement>(null);
  // Quem chama passa uma função nova a cada desenho (o quadro se atualiza a cada 15 s). Guardada num ref, o efeito
  // roda só ao abrir: antes, ele devolvia o foco à janela no meio da digitação (auditoria 01/10, U1).
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    painel.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); antes?.focus?.(); };
  }, []);
  return (
    <div className={c.fundoDetalhe} onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <aside ref={painel} tabIndex={-1} className={c.detalhe} aria-label={titulo} role="dialog" aria-modal="true">
        <header className={c.detTopo}>
          <div className={c.detTitulo}><h2>{titulo}</h2></div>
          <button type="button" className={c.fechar} onClick={onFechar} aria-label="Fechar"><Icone nome="fechar" tamanho={18} /></button>
        </header>
        <div className={c.detCorpo}>{children}</div>
      </aside>
    </div>
  );
}

// Envia o formulário, mostra o erro dentro da janela e só fecha quando o servidor aceitou.
export function useEnvio<T>() {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const enviar = (fn: () => Promise<Resposta<T>>, ok: (d: T) => void) => iniciar(async () => {
    setErro(null);
    const r = await fn();
    if (!r.ok) {
      if (r.sair) { window.location.href = '/entrar?motivo=sessao'; return; }
      setErro(r.erro);
      return;
    }
    ok(r.dados);
  });
  return { erro, enviando, enviar };
}

export function Campo({ id, rotulo, dica, children }: { id: string; rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className={c.campo} htmlFor={id}>
      <span>{rotulo}</span>
      {children}
      {dica && <small>{dica}</small>}
    </label>
  );
}

export function NovoAtendimento({ quadro, telefone = '', nome = '', onFechar, onPronto }: {
  quadro: TQuadro; telefone?: string; nome?: string; onFechar: () => void; onPronto: (q: TQuadro) => void;
}) {
  const [f, setF] = useState({ telefone, nome, topico_id: quadro.topicos[0]?.id ?? '', resumo: '' });
  const { erro, enviando, enviar } = useEnvio<TQuadro>();
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Janela titulo="Novo atendimento" onFechar={onFechar}>
      <form className={c.formJanela} onSubmit={(e) => { e.preventDefault(); enviar(() => criarAtendimento(f), onPronto); }}>
        <Campo id="na-telefone" rotulo="Telefone (WhatsApp)" dica="Se o número já for de um contato, o atendimento entra nele.">
          <input id="na-telefone" inputMode="tel" autoComplete="off" value={f.telefone} onChange={mudar('telefone')} placeholder="(47) 99999-1234" required />
        </Campo>
        <Campo id="na-nome" rotulo="Nome">
          <input id="na-nome" autoComplete="off" value={f.nome} onChange={mudar('nome')} maxLength={120} />
        </Campo>
        <Campo id="na-assunto" rotulo="Assunto">
          <select id="na-assunto" value={f.topico_id} onChange={mudar('topico_id')}>
            <option value="">Sem assunto</option>
            {quadro.topicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        <Campo id="na-resumo" rotulo="O que foi pedido">
          <textarea id="na-resumo" value={f.resumo} onChange={mudar('resumo')} maxLength={2000} rows={4} required />
        </Campo>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}>
          <button type="button" className={c.acaoSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Abrir atendimento'}</button>
        </div>
      </form>
    </Janela>
  );
}

export type Etapas = { id: string; nome: string; tipo: string }[];

export function NovaOportunidade<T>({ etapas, onFechar, onPronto }: { etapas: Etapas; onFechar: () => void; onPronto: (d: T) => void }) {
  const [f, setF] = useState({ telefone: '', nome: '', interesse: '', valor: '', etapa_id: etapas.find((e) => e.tipo === 'aberta')?.id ?? '' });
  const { erro, enviando, enviar } = useEnvio<T>();
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Janela titulo="Nova oportunidade" onFechar={onFechar}>
      <form className={c.formJanela} onSubmit={(e) => { e.preventDefault(); enviar(() => criarOportunidade(f) as Promise<Resposta<T>>, onPronto); }}>
        <Campo id="no-telefone" rotulo="Telefone (WhatsApp)">
          <input id="no-telefone" inputMode="tel" autoComplete="off" value={f.telefone} onChange={mudar('telefone')} placeholder="(47) 99999-1234" required />
        </Campo>
        <Campo id="no-nome" rotulo="Nome">
          <input id="no-nome" autoComplete="off" value={f.nome} onChange={mudar('nome')} maxLength={120} />
        </Campo>
        <Campo id="no-interesse" rotulo="Interesse">
          <input id="no-interesse" value={f.interesse} onChange={mudar('interesse')} maxLength={300} placeholder="Ex.: primeira consulta" />
        </Campo>
        <div className={c.detCampos}>
          <Campo id="no-valor" rotulo="Valor (R$)">
            <input id="no-valor" inputMode="decimal" value={f.valor} onChange={mudar('valor')} placeholder="800,00" />
          </Campo>
          <Campo id="no-etapa" rotulo="Etapa">
            <select id="no-etapa" value={f.etapa_id} onChange={mudar('etapa_id')}>
              {etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </Campo>
        </div>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}>
          <button type="button" className={c.acaoSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Criar oportunidade'}</button>
        </div>
      </form>
    </Janela>
  );
}

type ListaContatos = Awaited<ReturnType<typeof salvarContato>> extends Resposta<infer D> ? D : never;

export function FormContato({ contato, esconderDocumento, onFechar, onPronto }: {
  contato: { id: string; nome: string | null; telefone: string | null; documento: string | null } | null;
  esconderDocumento: boolean; onFechar: () => void; onPronto: (d: ListaContatos) => void;
}) {
  const [f, setF] = useState({ nome: contato?.nome ?? '', telefone: contato?.telefone ?? '', documento: esconderDocumento ? '' : contato?.documento ?? '' });
  const { erro, enviando, enviar } = useEnvio<ListaContatos>();
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Janela titulo={contato ? 'Editar contato' : 'Novo contato'} onFechar={onFechar}>
      <form className={c.formJanela} onSubmit={(e) => { e.preventDefault(); enviar(() => salvarContato(contato?.id ?? null, f), onPronto); }}>
        <Campo id="ct-nome" rotulo="Nome">
          <input id="ct-nome" autoComplete="off" value={f.nome} onChange={mudar('nome')} maxLength={120} />
        </Campo>
        <Campo id="ct-telefone" rotulo="Telefone (WhatsApp)">
          <input id="ct-telefone" inputMode="tel" autoComplete="off" value={f.telefone} onChange={mudar('telefone')} placeholder="(47) 99999-1234" required />
        </Campo>
        {esconderDocumento && contato ? (
          <p className={c.detMeta}>O CPF aparece mascarado para a Planee e não é alterado por aqui.</p>
        ) : (
          <Campo id="ct-documento" rotulo="CPF ou CNPJ" dica="Opcional. Só números ou com pontuação.">
            <input id="ct-documento" inputMode="numeric" autoComplete="off" value={f.documento} onChange={mudar('documento')} />
          </Campo>
        )}
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}>
          <button type="button" className={c.acaoSec} onClick={onFechar}>Cancelar</button>
          <button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar contato'}</button>
        </div>
      </form>
    </Janela>
  );
}
