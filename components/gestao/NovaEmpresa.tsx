'use client';

import { useState, useTransition } from 'react';
import { conectarNumero, criarEmpresaCompleta } from '@/lib/painel/acoes-gestao';
import type { LinhaEmpresa } from '@/lib/painel/gestao';
import type { ResultadoNovaEmpresa } from '@/lib/painel/nova-empresa';
import { LISTA_MODELOS } from '@/lib/painel/modelos-crm';
import { Icone } from '@/components/Icone';
import g from './gestao.module.css';

// Nova empresa em três passos (28/10): 1) o Mateus cria o projeto Supabase; 2) este formulário cria tudo no painel
// (banco, CRM, agente, chave do n8n, domínio, admin); 3) "Conectar número". Lógica em lib/painel/nova-empresa.ts.

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

type Aviso = { tipo: 'erro' | 'ok'; texto: string } | null;
const VAZIA = { nome: '', apelido: '', apelidoManual: false, modelo: 'clinica', agente: '', pausa_min: '30', admin_nome: '', admin_email: '', banco: '' };

function Copiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} aria-label={`Copiar ${rotulo}`}
      onClick={() => { navigator.clipboard?.writeText(valor).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => undefined); }}>
      {ok ? 'Copiado' : 'Copiar'}
    </button>
  );
}

function ConectarNumero({ empresa, aoTerminar }: { empresa: string; aoTerminar: (e: LinhaEmpresa[], texto: string) => void }) {
  const [f, setF] = useState({ phone_number_id: '', waba_id: '', nome: '', token: '', app_secret: '', modo: 'painel', webhook_ia: '' });
  const [aviso, setAviso] = useState<Aviso>(null);
  const [ocupado, iniciar] = useTransition();
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: ev.target.value }) });
  return (
    <form className={g.bloco} aria-label="Conectar número" data-conectar onSubmit={(ev) => {
      ev.preventDefault();
      iniciar(async () => {
        const r = await conectarNumero(empresa, f);
        if (!r.ok) { setAviso({ tipo: 'erro', texto: r.erro }); return; }
        setAviso(null); setF({ ...f, token: '', app_secret: '' });
        aoTerminar(r.dados.empresas, r.dados.conectando
          ? 'Número cadastrado. O receptor está apontando o número para o painel: o resultado aparece no cartão da empresa em segundos.'
          : 'Número cadastrado. A IA continua recebendo direto da Meta; as respostas pela Inbox avisam a IA no webhook informado.');
      });
    }}>
      <h3 className={g.blocoTitulo}>3. Conectar número de WhatsApp</h3>
      <div className={g.linha}>
        <label className={g.campo}>Identificação do número (phone_number_id)
          <input id="cn-phone" inputMode="numeric" required {...campo('phone_number_id')} /></label>
        <label className={g.campo}>Conta do WhatsApp (WABA)
          <input id="cn-waba" inputMode="numeric" {...campo('waba_id')} /></label>
        <label className={g.campo}>Nome na Inbox
          <input id="cn-nome" maxLength={80} placeholder="Atendimento" {...campo('nome')} /></label>
      </div>
      <div className={g.linha}>
        <label className={g.campo}>Token da Meta
          <input id="cn-token" type="password" autoComplete="off" required {...campo('token')} /></label>
        <label className={g.campo}>Chave secreta do app (só se for outro app da Meta)
          <input id="cn-segredo" type="password" autoComplete="off" {...campo('app_secret')} /></label>
      </div>
      <fieldset className={g.checks} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={g.dica}>Como a IA recebe as mensagens</legend>
        <label className={g.check}><input type="radio" name="cn-modo" value="painel" checked={f.modo === 'painel'} onChange={() => setF({ ...f, modo: 'painel' })} />
          <span>Pelo painel (recomendado): a Meta entrega no painel, que repassa à IA</span></label>
        <label className={g.check}><input type="radio" name="cn-modo" value="direto" checked={f.modo === 'direto'} onChange={() => setF({ ...f, modo: 'direto' })} />
          <span>Direto da Meta: a IA continua recebendo como hoje</span></label>
      </fieldset>
      <label className={g.campo}>
        {f.modo === 'painel'
          ? 'Webhook da IA no n8n (vazio = o painel usa o endereço que recebe hoje na Meta)'
          : 'Webhook da IA no n8n (recebe o aviso das respostas pela Inbox)'}
        <input id="cn-webhook" type="url" placeholder="https://..." required={f.modo === 'direto'} {...campo('webhook_ia')} /></label>
      <p className={g.dica}>
        {f.modo === 'painel'
          ? 'Ao conectar, o painel aponta o número para o receptor na Meta (override do número) e já pede o histórico. A IA não para: o receptor repassa cada mensagem.'
          : 'Nada muda na Meta. Para as mensagens aparecerem na Inbox, o n8n da IA repassa uma cópia de cada evento ao receptor.'}
        {' '}Token e chave ficam cifrados e não aparecem de novo.
      </p>
      {aviso && <p className={g.erroLinha} role="alert">{aviso.texto}</p>}
      <div className={g.linha}><button type="submit" className={g.botao} disabled={ocupado}>{ocupado ? 'Conectando…' : 'Conectar número'}</button></div>
    </form>
  );
}

export function NovaEmpresa({ sufixo, aoMudar }: { sufixo: string; aoMudar: (e: LinhaEmpresa[], texto: string) => void }) {
  const [f, setF] = useState(VAZIA);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [feito, setFeito] = useState<ResultadoNovaEmpresa | null>(null);
  const [ocupado, iniciar] = useTransition();
  const campo = (k: Exclude<keyof typeof f, 'apelidoManual'>) => ({ value: f[k], onChange: (ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: ev.target.value }) });

  if (feito) {
    return (
      <section className={g.cartao} aria-label={`Empresa nova ${feito.nome}`} data-nova-resultado={feito.id}>
        <div className={g.cartaoTopo}>
          <h2 className={g.cartaoNome}>{feito.nome} está pronta</h2>
          <span className={g.id}>{feito.id}</span>
          <span className={g.espaco} />
          <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} onClick={() => { setFeito(null); setF(VAZIA); }}>Cadastrar outra</button>
        </div>
        <p className={g.dica}>
          Banco preparado ({feito.migracoes} migrações no schema painel), CRM com {feito.etapas} etapas e {feito.topicos} assuntos, Inbox e CRM liberados.
          Endereço: <a href={`https://${feito.dominio}`} target="_blank" rel="noreferrer" data-dominio-novo>{feito.dominio}</a> (o HTTPS sai em até 1 minuto).
        </p>
        <div className={`${g.aviso} ${g.avisoOk}`} role="status">
          <span>
            Código de primeiro acesso do admin ({feito.admin}): <strong className={g.codigo} data-convite-novo>{feito.codigo ?? 'já tem senha'}</strong>.
            Vale 7 dias. Envie para a pessoa: ela cria a senha em &quot;Primeiro acesso&quot;, no endereço acima.
          </span>
        </div>
        <div className={`${g.aviso} ${g.avisoOk}`} role="status">
          <span>
            Chave da API para o n8n (credencial Header Auth, <code>Authorization: Bearer …</code>, em <code>https://{feito.dominio}/api/v1</code>):{' '}
            <strong className={g.codigo} data-chave-n8n>{feito.chave}</strong>. Cole direto na credencial do n8n: ela não aparece de novo.
          </span>
          <Copiar valor={feito.chave} rotulo="chave da API" />
        </div>
        <ConectarNumero empresa={feito.id} aoTerminar={aoMudar} />
      </section>
    );
  }

  return (
    <form className={g.cartao} aria-labelledby="titulo-nova-empresa" data-nova-empresa onSubmit={(ev) => {
      ev.preventDefault();
      iniciar(async () => {
        setAviso(null);
        const r = await criarEmpresaCompleta({ ...f });
        if (!r.ok) { if (r.sair) window.location.href = '/entrar?motivo=sessao'; setAviso({ tipo: 'erro', texto: r.erro }); return; }
        setFeito(r.dados.resultado);
        aoMudar(r.dados.empresas, `${r.dados.resultado.nome} foi criada.`);
      });
    }}>
      <h2 id="titulo-nova-empresa" className={g.blocoTitulo}>Nova empresa</h2>
      <p className={g.dica}>
        1. Crie o projeto da empresa no Supabase e copie a connection string em Connect → Session pooler, trocando [YOUR-PASSWORD] pela senha do banco.
        2. Preencha e clique em Criar: o painel prepara o banco (usuário painel_app e schema painel, sem tocar em mais nada), monta o CRM, o agente, a chave do n8n, o endereço e o admin.
        3. Conecte o número.
      </p>
      <div className={g.linha}>
        <label className={g.campo}>Nome da empresa
          <input id="ne-nome" required maxLength={80} value={f.nome}
            onChange={(ev) => setF({ ...f, nome: ev.target.value, apelido: f.apelidoManual ? f.apelido : slug(ev.target.value) })} /></label>
        <label className={g.campo}>Apelido (endereço do painel)
          <input id="ne-apelido" required maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,39}" value={f.apelido}
            onChange={(ev) => setF({ ...f, apelido: ev.target.value.toLowerCase(), apelidoManual: true })} /></label>
      </div>
      {f.apelido && <p className={g.dica} data-endereco-previsto>Endereço: {f.apelido}.{sufixo}</p>}
      <div className={g.linha}>
        <label className={g.campo}>Modelo do CRM
          <select id="ne-modelo" value={f.modelo} onChange={(ev) => setF({ ...f, modelo: ev.target.value })}>
            {LISTA_MODELOS.map((m) => <option key={m.id} value={m.id}>{m.nome}: {m.descricao}</option>)}
          </select></label>
        <label className={g.campo}>Nome do agente de IA
          <input id="ne-agente" required maxLength={40} placeholder="Sara" {...campo('agente')} /></label>
        <label className={g.campo}>Pausa da IA depois da equipe (min)
          <input id="ne-pausa" type="number" min={1} max={1440} required {...campo('pausa_min')} /></label>
      </div>
      <div className={g.linha}>
        <label className={g.campo}>Nome do admin da empresa
          <input id="ne-admin-nome" required maxLength={80} {...campo('admin_nome')} /></label>
        <label className={g.campo}>E-mail do admin
          <input id="ne-admin-email" type="email" required maxLength={200} {...campo('admin_email')} /></label>
      </div>
      <label className={g.campo}>Connection string do banco (usuário postgres; usada só agora, não fica guardada)
        <input id="ne-banco" type="password" autoComplete="off" required placeholder="postgresql://postgres.xxxx:senha@aws-0-...pooler.supabase.com:5432/postgres" {...campo('banco')} /></label>
      {aviso && (
        <div className={`${g.aviso} ${g.avisoErro}`} role="alert">
          <span>{aviso.texto}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setAviso(null)}><Icone nome="fechar" tamanho={14} /></button>
        </div>
      )}
      <div className={g.linha}>
        <button type="submit" className={g.botao} disabled={ocupado} data-criar-completa>{ocupado ? 'Criando… (até 1 minuto)' : 'Criar empresa completa'}</button>
      </div>
    </form>
  );
}
