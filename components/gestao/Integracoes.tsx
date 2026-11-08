'use client';

import { useState } from 'react';
import { conectarPeloBotao, gerarSegredoN8n, salvarTokenFeegow } from '@/lib/painel/acoes-gestao';
import type { LinhaEmpresa } from '@/lib/painel/gestao';
import type { Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import g from './gestao.module.css';

type Rodar = (fn: () => Promise<Resposta<LinhaEmpresa[]>>, ok: string, depois?: () => void) => void;
export type AppMeta = { appId: string; configId: string } | null;

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

// Integrações da empresa (06/11): tudo pela tela, nada no Portainer. Valores cifrados no banco central; não voltam.
export function Integracoes({ e, ocupado, rodar }: { e: LinhaEmpresa; ocupado: boolean; rodar: Rodar }) {
  const [token, setToken] = useState('');
  const [segredo, setSegredo] = useState<string | null>(null);
  const f = e.integracoes.feegow;
  return (
    <div className={g.bloco} data-integracoes>
      <h3 className={g.blocoTitulo}>Integrações</h3>

      <div className={g.linha}>
        <strong>Feegow (agenda)</strong>
        {f.tem_token && f.ativo
          ? <span className={`${g.selo} ${g.seloOk}`} data-feegow="ok">Token testado{f.teste_em ? ` ${quando(f.teste_em)}` : ''} · espelho da agenda ligado</span>
          : f.da_stack ? <span className={g.selo} data-feegow="stack">Token na stack (antigo): cole aqui para migrar</span>
          : <span className={g.selo} data-feegow="nao">Sem token</span>}
      </div>
      <form className={g.linha} onSubmit={(ev) => {
        ev.preventDefault();
        rodar(async () => {
          const r = await salvarTokenFeegow(e.id, token);
          return r.ok ? { ok: true as const, dados: r.dados.empresas } : r;
        }, 'Token da Feegow testado e guardado. O espelho da agenda começa na próxima volta (até 15 min).', () => setToken(''));
      }}>
        <label className={g.visivelLeitor} htmlFor={`feegow-${e.id}`}>Token da API da Feegow</label>
        <input id={`feegow-${e.id}`} type="password" autoComplete="off" className={g.entrada} placeholder="Token da API da Feegow"
          value={token} onChange={(ev) => setToken(ev.target.value)} required />
        <button type="submit" className={g.botaoSec} disabled={ocupado || !token.trim()}>{f.tem_token ? 'Trocar token' : 'Testar e salvar'}</button>
      </form>
      <p className={g.dica}>O painel testa o token na Feegow antes de guardar. Token recusado não é guardado.</p>

      <div className={g.linha}>
        <strong>Segredo do n8n</strong>
        <span className={`${g.selo} ${e.integracoes.n8n.proprio ? g.seloOk : ''}`} data-n8n={e.integracoes.n8n.proprio ? 'proprio' : 'geral'}>
          {e.integracoes.n8n.proprio ? 'Próprio desta empresa' : 'Usa o segredo geral (antigo)'}
        </span>
        <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado}
          onClick={() => {
            if (e.integracoes.n8n.proprio && !window.confirm('Trocar o segredo? O n8n desta empresa deixa de aceitar os avisos até você colar o novo na credencial.')) return;
            rodar(async () => {
              const r = await gerarSegredoN8n(e.id);
              if (!r.ok) return r;
              setSegredo(r.dados.segredo);
              return { ok: true as const, dados: r.dados.empresas };
            }, 'Segredo gerado. Cole na credencial "Header Auth" (x-painel-segredo) do n8n desta empresa.');
          }}>
          {e.integracoes.n8n.proprio ? 'Trocar segredo' : 'Gerar segredo'}
        </button>
      </div>
      {segredo && (
        <div className={`${g.aviso} ${g.avisoOk}`} role="status">
          <span>
            Segredo do n8n de {e.nome}: <strong className={g.codigo} data-segredo>{segredo}</strong>. Cole na credencial do n8n desta
            empresa (cabeçalho x-painel-segredo). Ele não aparece de novo.
          </span>
          <button type="button" aria-label="Fechar segredo" onClick={() => setSegredo(null)}><Icone nome="fechar" tamanho={14} /></button>
        </div>
      )}
    </div>
  );
}

// ---- Botão "Conectar WhatsApp" (cadastro incorporado da Meta, coexistência) ----
type FBSdk = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void, o: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: FBSdk; fbAsyncInit?: () => void } }

let sdk: Promise<FBSdk> | null = null;
function carregarSdk(appId: string): Promise<FBSdk> {
  sdk ??= new Promise((ok, falha) => {
    window.fbAsyncInit = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: 'v23.0' }); ok(window.FB!); };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/pt_BR/sdk.js'; s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => { sdk = null; falha(new Error('Não consegui abrir o cadastro da Meta. Confira a internet e tente de novo.')); };
    document.body.appendChild(s);
  });
  return sdk;
}

export function ConectarWhatsApp({ empresa, meta, ocupado, rodar }: { empresa: string; meta: AppMeta; ocupado: boolean; rodar: Rodar }) {
  const [webhook, setWebhook] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);

  if (!meta) {
    return <p className={g.dica} data-conectar-whatsapp="sem-config">Botão &quot;Conectar WhatsApp&quot;: faltam META_APP_ID e META_CADASTRO_CONFIG_ID na stack do painel (uma vez só, vale para todos os clientes).</p>;
  }

  async function abrir() {
    setErro(null); setAbrindo(true);
    let fb: FBSdk;
    try { fb = await carregarSdk(meta!.appId); } catch (x) { setErro((x as Error).message); setAbrindo(false); return; }
    // A Meta manda a conta e o número por mensagem da janela dela; o código chega na volta do login.
    let sessao: { waba_id?: string; phone_number_id?: string } = {};
    let cancelado: string | null = null;
    const ouvir = (ev: MessageEvent) => {
      let host = ''; try { host = new URL(ev.origin).hostname; } catch { return; }
      if (!host.endsWith('facebook.com')) return;
      try {
        const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (String(d.event ?? '').startsWith('FINISH')) sessao = { waba_id: d.data?.waba_id, phone_number_id: d.data?.phone_number_id };
        else if (d.event === 'CANCEL') cancelado = d.data?.current_step ? `Cadastro interrompido na etapa "${d.data.current_step}".` : 'Cadastro cancelado.';
        else if (d.event === 'ERROR') cancelado = `A Meta recusou: ${String(d.data?.error_message ?? 'erro sem detalhe').slice(0, 160)}`;
      } catch { /* mensagem de outro tipo */ }
    };
    window.addEventListener('message', ouvir);
    fb.login((resp) => {
      const code = resp?.authResponse?.code;
      // A mensagem com a conta pode chegar um pouco depois do código.
      const esperar = (n: number) => {
        if ((!sessao.phone_number_id || !sessao.waba_id) && !cancelado && n > 0) { setTimeout(() => esperar(n - 1), 250); return; }
        window.removeEventListener('message', ouvir);
        setAbrindo(false);
        if (!code) { setErro(cancelado ?? 'Cadastro não concluído. Clique de novo e vá até o fim, com o celular do WhatsApp Business na mão.'); return; }
        rodar(() => conectarPeloBotao(empresa, { code, waba_id: sessao.waba_id ?? '', phone_number_id: sessao.phone_number_id ?? '', webhook_ia: webhook.trim() }),
          'WhatsApp recebido da Meta. Conectando: em segundos o número aparece como Conectado e a Inbox começa a receber.');
      };
      esperar(12);
    }, {
      config_id: meta!.configId, response_type: 'code', override_default_response_type: true,
      extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
    });
  }

  return (
    <div className={g.conectarWhats} data-conectar-whatsapp="pronto">
      <div className={g.linha}>
        <label className={g.campo}>Webhook da IA desta empresa (n8n; vazio = sem IA, só a Inbox)
          <input type="url" placeholder="https://..." value={webhook} onChange={(ev) => setWebhook(ev.target.value)} /></label>
        <button type="button" className={g.botao} disabled={ocupado || abrindo} onClick={abrir} data-botao-conectar-whatsapp>
          {abrindo ? 'Abrindo a Meta…' : 'Conectar WhatsApp'}
        </button>
      </div>
      <p className={g.dica}>Abre o cadastro da Meta: o cliente escolhe o WhatsApp Business e escaneia o QR no celular. Número, conta e token chegam sozinhos; o painel conecta, puxa o histórico e a Inbox começa a receber.</p>
      {erro && <p className={g.erroLinha} role="alert">{erro}</p>}
    </div>
  );
}
