'use client';

import { useState } from 'react';
import type { ConfigCrm as TConfig, Etapa } from '@/lib/painel/crm';
import { arquivarDaConfig, salvarAssunto, salvarEtapaDoFunil, salvarNomesDasEtapas, salvarPrazosDoAtendimento, type Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import { Campo, useEnvio } from './Formularios';
import c from './crm.module.css';

const ICONES_ASSUNTO = ['receita', 'doc', 'exame', 'valor', 'agenda', 'os', 'garantia', 'caixa', 'recibo', 'pessoa', 'predio', 'outros'];
const TIPOS = [['aberta', 'Em andamento'], ['ganho', 'Ganho'], ['perdido', 'Perdido']] as const;
const ETAPAS: [Etapa, string][] = [['aguardando', 'Aguardando equipe'], ['em_atendimento', 'Em atendimento'], ['pendente', 'Pendente interno'], ['finalizado', 'Finalizado']];

// Configuração do CRM pela tela (quem tem crm.config). Tudo passa pela mesma camada da API, com auditoria.
export function ConfigCrm({ inicial }: { inicial: TConfig }) {
  const [cfg, setCfg] = useState(inicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const pronto = (msg: string) => (d: TConfig) => { setCfg(d); setAviso(msg); window.setTimeout(() => setAviso(null), 3500); };

  return (
    <div className={c.tela}>
      <header className={c.topo}>
        <div className={c.titulos}>
          <h1 className={c.titulo}>Configurações do CRM</h1>
          <p className={c.sub}>Assuntos do quadro, etapas do funil e nomes das etapas. Vale na hora para a equipe e para a IA.</p>
        </div>
      </header>
      <div className={c.aviso} role="status" aria-live="polite">{aviso && <span className={c.avisoOk}>{aviso}</span>}</div>
      <div className={c.telaConfig}>
        <NomesEtapas cfg={cfg} onPronto={pronto('Nomes das etapas salvos.')} />
        <PrazosAtendimento cfg={cfg} onPronto={pronto('Prazos salvos. O quadro já usa as cores novas.')} />

        <section className={c.blocoConfig} aria-labelledby="cfg-assuntos">
          <h2 id="cfg-assuntos">Assuntos do atendimento</h2>
          <p>Cada assunto é uma coluna do quadro. As palavras ajudam a IA a escolher o assunto certo.</p>
          {cfg.topicos.map((t) => (
            <LinhaAssunto key={t.id} item={t} onPronto={pronto} />
          ))}
          <LinhaAssunto key={`novo-${cfg.topicos.length}`} item={null} onPronto={pronto} />
        </section>

        <section className={c.blocoConfig} aria-labelledby="cfg-funil">
          <h2 id="cfg-funil">Etapas do funil comercial</h2>
          <p>O funil precisa de pelo menos uma etapa de cada tipo. O gatilho descreve quando a IA move o cartão para cá.</p>
          {cfg.funil.map((e) => (
            <LinhaEtapa key={e.id} item={e} onPronto={pronto} />
          ))}
          <LinhaEtapa key={`nova-${cfg.funil.length}`} item={null} onPronto={pronto} />
        </section>
      </div>
    </div>
  );
}

type Pronto = (msg: string) => (d: TConfig) => void;

function NomesEtapas({ cfg, onPronto }: { cfg: TConfig; onPronto: (d: TConfig) => void }) {
  const [nomes, setNomes] = useState<Record<string, string>>({ ...cfg.etapasAtendimento });
  const { erro, enviando, enviar } = useEnvio<TConfig>();
  return (
    <section className={c.blocoConfig} aria-labelledby="cfg-etapas">
      <h2 id="cfg-etapas">Etapas do atendimento</h2>
      <p>As quatro etapas são fixas; aqui só muda o nome que a equipe vê.</p>
      <form className={c.formJanela} onSubmit={(e) => { e.preventDefault(); enviar(() => salvarNomesDasEtapas(nomes), onPronto); }}>
        <div className={c.gradeEtapas}>
          {ETAPAS.map(([id, padrao]) => (
            <Campo key={id} id={`etapa-${id}`} rotulo={padrao}>
              <input id={`etapa-${id}`} value={nomes[id] ?? ''} maxLength={40} onChange={(e) => setNomes({ ...nomes, [id]: e.target.value })} required />
            </Campo>
          ))}
        </div>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}><button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar nomes'}</button></div>
      </form>
    </section>
  );
}

// Quando o cartão fica amarelo e vermelho no quadro. Aguardando em minutos; pendente interno em horas.
function PrazosAtendimento({ cfg, onPronto }: { cfg: TConfig; onPronto: (d: TConfig) => void }) {
  const [v, setV] = useState({
    ag_am: String(cfg.prazos.aguardando.amarelo), ag_vm: String(cfg.prazos.aguardando.vermelho),
    pd_am: String(cfg.prazos.pendente.amarelo / 60), pd_vm: String(cfg.prazos.pendente.vermelho / 60),
  });
  const { erro, enviando, enviar } = useEnvio<TConfig>();
  const campo = (k: keyof typeof v, rotulo: string, max: number) => (
    <Campo id={`prazo-${k}`} rotulo={rotulo}>
      <input id={`prazo-${k}`} type="number" inputMode="numeric" min={1} max={max} step={1} required value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Campo>
  );
  return (
    <section className={c.blocoConfig} aria-labelledby="cfg-prazos">
      <h2 id="cfg-prazos">Prazos do atendimento</h2>
      <p>Quando o cartão fica amarelo (atenção) e vermelho (atrasado) no quadro. Aguardando conta desde que o cartão abriu; pendente interno, desde a última mudança.</p>
      <form className={c.formJanela} onSubmit={(e) => {
        e.preventDefault();
        enviar(() => salvarPrazosDoAtendimento({
          aguardando: { amarelo: Number(v.ag_am), vermelho: Number(v.ag_vm) },
          pendente: { amarelo: Math.round(Number(v.pd_am) * 60), vermelho: Math.round(Number(v.pd_vm) * 60) },
        }), onPronto);
      }}>
        <div className={c.gradeEtapas}>
          {campo('ag_am', 'Aguardando: amarelo após (min)', 43200)}
          {campo('ag_vm', 'Aguardando: vermelho após (min)', 43200)}
          {campo('pd_am', 'Pendente: amarelo após (horas)', 720)}
          {campo('pd_vm', 'Pendente: vermelho após (horas)', 720)}
        </div>
        {erro && <p className={c.erroForm} role="alert">{erro}</p>}
        <div className={c.acoesFim}><button type="submit" className={c.acaoPri} disabled={enviando}>{enviando ? 'Salvando…' : 'Salvar prazos'}</button></div>
      </form>
    </section>
  );
}

function BotaoArquivar({ recurso, id, onPronto }: { recurso: 'topicos' | 'etapas'; id: string; onPronto: Pronto }) {
  const [confirmar, setConfirmar] = useState(false);
  const { erro, enviando, enviar } = useEnvio<TConfig>();
  if (!confirmar) return <button type="button" className={c.acaoSec} onClick={() => setConfirmar(true)} aria-label="Arquivar"><Icone nome="arquivo" tamanho={14} /></button>;
  return (
    <span className={c.confirmaLinha}>
      <span>Arquivar tira este item da tela e da IA. Ele continua guardado no banco.</span>
      <button type="button" className={c.botaoPerigoCheio} disabled={enviando}
        onClick={() => enviar(() => arquivarDaConfig(recurso, id), onPronto(recurso === 'topicos' ? 'Assunto arquivado.' : 'Etapa arquivada.'))}>Arquivar</button>
      <button type="button" className={c.acaoSec} onClick={() => setConfirmar(false)}>Não</button>
      {erro && <span className={c.erroForm} role="alert">{erro}</span>}
    </span>
  );
}

function LinhaAssunto({ item, onPronto }: { item: TConfig['topicos'][number] | null; onPronto: Pronto }) {
  const [f, setF] = useState({ nome: item?.nome ?? '', icone: item?.icone ?? 'outros', ordem: String(item?.ordem ?? ''), palavras: item?.palavras ?? '' });
  const { erro, enviando, enviar } = useEnvio<TConfig>();
  const p = item ? `as-${item.id}` : 'as-novo';
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const salvar = () => enviar(() => salvarAssunto(item?.id ?? null, f) as Promise<Resposta<TConfig>>, onPronto(item ? 'Assunto salvo.' : 'Assunto criado.'));
  return (
    <form className={c.linhaConfig} onSubmit={(e) => { e.preventDefault(); salvar(); }} aria-label={item ? `Assunto ${item.nome}` : 'Novo assunto'}>
      <Campo id={`${p}-ordem`} rotulo="Ordem"><input id={`${p}-ordem`} inputMode="numeric" value={f.ordem} onChange={mudar('ordem')} /></Campo>
      <Campo id={`${p}-nome`} rotulo={item ? 'Nome' : 'Novo assunto'}><input id={`${p}-nome`} value={f.nome} onChange={mudar('nome')} maxLength={60} required /></Campo>
      <Campo id={`${p}-icone`} rotulo="Ícone">
        <select id={`${p}-icone`} value={f.icone} onChange={mudar('icone')}>
          {ICONES_ASSUNTO.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </Campo>
      <Campo id={`${p}-palavras`} rotulo="Palavras para a IA"><input id={`${p}-palavras`} value={f.palavras} onChange={mudar('palavras')} maxLength={1000} placeholder="receita, renovar, remédio" /></Campo>
      <span className={c.acoes}>
        <button type="submit" className={c.acaoPri} disabled={enviando}>{item ? 'Salvar' : 'Criar'}</button>
      </span>
      {item && <BotaoArquivar recurso="topicos" id={item.id} onPronto={onPronto} />}
      {erro && <p className={c.erroForm} role="alert">{erro}</p>}
    </form>
  );
}

function LinhaEtapa({ item, onPronto }: { item: TConfig['funil'][number] | null; onPronto: Pronto }) {
  const [f, setF] = useState({ nome: item?.nome ?? '', tipo: item?.tipo ?? 'aberta', ordem: String(item?.ordem ?? ''), gatilho: item?.gatilho ?? '' });
  const { erro, enviando, enviar } = useEnvio<TConfig>();
  const p = item ? `et-${item.id}` : 'et-nova';
  const mudar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const salvar = () => enviar(() => salvarEtapaDoFunil(item?.id ?? null, f) as Promise<Resposta<TConfig>>, onPronto(item ? 'Etapa salva.' : 'Etapa criada.'));
  return (
    <form className={c.linhaConfig} onSubmit={(e) => { e.preventDefault(); salvar(); }} aria-label={item ? `Etapa ${item.nome}` : 'Nova etapa'}>
      <Campo id={`${p}-ordem`} rotulo="Ordem"><input id={`${p}-ordem`} inputMode="numeric" value={f.ordem} onChange={mudar('ordem')} /></Campo>
      <Campo id={`${p}-nome`} rotulo={item ? 'Nome' : 'Nova etapa'}><input id={`${p}-nome`} value={f.nome} onChange={mudar('nome')} maxLength={60} required /></Campo>
      <Campo id={`${p}-tipo`} rotulo="Tipo">
        <select id={`${p}-tipo`} value={f.tipo} onChange={mudar('tipo')}>
          {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </Campo>
      <Campo id={`${p}-gatilho`} rotulo="Gatilho"><input id={`${p}-gatilho`} value={f.gatilho} onChange={mudar('gatilho')} maxLength={120} placeholder="Manual (equipe)" /></Campo>
      <span className={c.acoes}>
        <button type="submit" className={c.acaoPri} disabled={enviando}>{item ? 'Salvar' : 'Criar'}</button>
      </span>
      {item && <BotaoArquivar recurso="etapas" id={item.id} onPronto={onPronto} />}
      {erro && <p className={c.erroForm} role="alert">{erro}</p>}
    </form>
  );
}
