'use client';

import { useEffect, useState, useTransition } from 'react';
import { MODELOS, PERMISSOES } from '@/lib/permissoes';
import {
  adicionarAdmin, adicionarDominio, atualizarEmpresa, carregarEmpresas, criarEmpresa, definirBancoEmpresa, pedirNoNumero,
  removerDominio, salvarNumero,
} from '@/lib/painel/acoes-gestao';
import type { LinhaEmpresa } from '@/lib/painel/gestao';
import type { NumeroWhats } from '@/lib/painel/numeros';
import type { Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import g from './gestao.module.css';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function Modulos({ valor, onChange, prefixo }: { valor: string[]; onChange: (v: string[]) => void; prefixo: string }) {
  return (
    <div className={g.checks}>
      {PERMISSOES.map((p) => (
        <label key={p.id} className={g.check}>
          <input type="checkbox" id={`${prefixo}-${p.id}`} checked={valor.includes(p.id)}
            onChange={(e) => onChange(e.target.checked ? [...valor, p.id] : valor.filter((x) => x !== p.id))} />
          <span>{p.nome}</span>
        </label>
      ))}
    </div>
  );
}

type Rodar = (fn: () => Promise<Resposta<LinhaEmpresa[]>>, ok: string, depois?: () => void) => void;

const quando = (v: string | null) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fone = (t: string | null) => {
  const d = (t ?? '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : '';
};
const pendente = (n: NumeroWhats) => Boolean(n.conectar_pedido_em || n.historico_pedido_em || n.historico_status?.startsWith('pedindo'));

type Ficha = { phone_number_id: string; waba_id: string; nome: string; encaminhar_url: string; token: string; app_secret: string };
const vazia: Ficha = { phone_number_id: '', waba_id: '', nome: '', encaminhar_url: '', token: '', app_secret: '' };

function FormNumero({ empresa, inicial, editando, ocupado, rodar, fechar }: {
  empresa: string; inicial: Ficha; editando: boolean; ocupado: boolean; rodar: Rodar; fechar: () => void;
}) {
  const [f, setF] = useState(inicial);
  const campo = (k: keyof Ficha) => ({ value: f[k], onChange: (ev: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: ev.target.value }) });
  return (
    <form className={g.editor} aria-label={editando ? `Editar número ${inicial.phone_number_id}` : 'Novo número de WhatsApp'}
      onSubmit={(ev) => { ev.preventDefault(); rodar(() => salvarNumero(empresa, f), editando ? 'Número salvo.' : 'Número cadastrado. Agora clique em Conectar.', fechar); }}>
      <div className={g.linha}>
        <label className={g.campo}>Identificação do número (phone_number_id)
          <input name="phone_number_id" inputMode="numeric" required readOnly={editando} {...campo('phone_number_id')} /></label>
        <label className={g.campo}>Conta do WhatsApp (WABA)
          <input name="waba_id" inputMode="numeric" {...campo('waba_id')} /></label>
        <label className={g.campo}>Nome na Inbox
          <input name="nome" maxLength={80} placeholder="Clínica — principal" {...campo('nome')} /></label>
      </div>
      <label className={g.campo}>Repassar para a Sara (webhook do n8n; vazio = não repassa)
        <input name="encaminhar_url" type="url" placeholder="https://..." {...campo('encaminhar_url')} /></label>
      <div className={g.linha}>
        <label className={g.campo}>Token da Meta {editando && '(vazio = mantém o guardado)'}
          <input name="token" type="password" autoComplete="off" {...campo('token')} /></label>
        <label className={g.campo}>Chave secreta do app (só se for outro app da Meta)
          <input name="app_secret" type="password" autoComplete="off" {...campo('app_secret')} /></label>
      </div>
      <p className={g.dica}>Token e chave ficam cifrados no banco e não aparecem de novo nesta tela.</p>
      <div className={g.linha}>
        <button type="submit" className={g.botao} disabled={ocupado}>{editando ? 'Salvar número' : 'Cadastrar número'}</button>
        <button type="button" className={g.botaoSec} onClick={fechar}>Cancelar</button>
      </div>
    </form>
  );
}

function Numeros({ e, ocupado, rodar }: { e: LinhaEmpresa; ocupado: boolean; rodar: Rodar }) {
  const [editar, setEditar] = useState<string | null>(null); // phone_number_id, '' = novo
  return (
    <div className={g.bloco}>
      <h3 className={g.blocoTitulo}>Números de WhatsApp</h3>
      {e.numeros.length === 0 && <p className={g.dica}>Nenhum número. Cadastre, clique em Conectar e o receptor aponta o número para o painel na Meta.</p>}
      {e.numeros.map((n) => (
        <div key={n.phone_number_id} className={`${g.numero} ${n.ativo ? '' : g.inativa}`} data-numero={n.phone_number_id}>
          <div className={g.linha}>
            <strong className={g.pessoaNome}>{n.nome || n.verificado_nome || 'Sem nome'}</strong>
            {n.telefone && <span>{fone(n.telefone)}</span>}
            <span className={g.id}>{n.phone_number_id}</span>
            {!n.ativo ? <span className={`${g.selo} ${g.seloOff}`}>Desativado</span>
              : n.conectar_pedido_em ? <span className={g.selo} data-estado="conectando">Conectando…</span>
              : n.conexao_erro ? <span className={`${g.selo} ${g.seloOff}`} data-estado="erro">Erro ao conectar</span>
              : n.conectado_em ? <span className={`${g.selo} ${g.seloOk}`} data-estado="conectado">Conectado {quando(n.conectado_em)}</span>
              : <span className={g.selo} data-estado="nao">Não conectado</span>}
            <span className={g.selo}>{n.tem_token ? 'Token guardado' : 'Token geral do receptor'}</span>
          </div>
          {n.conexao_erro && !n.conectar_pedido_em && <p className={g.erroLinha} data-erro>{n.conexao_erro}</p>}
          {n.verificado_nome && <p className={g.dica}>Nome verificado na Meta: {n.verificado_nome}{n.encaminhar_url ? ' · repassa para a Sara' : ' · sem repasse para a Sara'}</p>}
          {(n.historico_status || n.historico_pedido_em) && (
            <p className={g.dica} data-historico>Histórico: {n.historico_status}{n.historico_em ? ` (${quando(n.historico_em)})` : ''}</p>
          )}
          <div className={g.linha}>
            {n.ativo && (
              <>
                <button type="button" className={`${g.botao} ${g.botaoPeq}`} disabled={ocupado || Boolean(n.conectar_pedido_em)}
                  onClick={() => rodar(() => pedirNoNumero(n.phone_number_id, 'conectar'), 'Pedido de conexão enviado. O resultado aparece aqui em segundos.')}>
                  {n.conectado_em ? 'Conectar de novo' : 'Conectar'}
                </button>
                <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado || pendente(n)}
                  title="Agenda e conversas dos últimos 180 dias. Vale nas 24 h depois de conectar o número no app WhatsApp Business."
                  onClick={() => rodar(() => pedirNoNumero(n.phone_number_id, 'historico'), 'Pedido de histórico enviado. As conversas antigas chegam na Inbox aos poucos.')}>
                  Puxar histórico
                </button>
              </>
            )}
            <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado} onClick={() => setEditar(n.phone_number_id)}>Editar</button>
            <button type="button" className={`${n.ativo ? g.botaoPerigo : g.botaoSec} ${g.botaoPeq}`} disabled={ocupado}
              onClick={() => rodar(() => pedirNoNumero(n.phone_number_id, n.ativo ? 'desativar' : 'ativar'), n.ativo ? 'Número desativado: o receptor para de distribuir as mensagens dele.' : 'Número reativado.')}>
              {n.ativo ? 'Desativar' : 'Reativar'}
            </button>
          </div>
          {editar === n.phone_number_id && (
            <FormNumero empresa={e.id} editando ocupado={ocupado} rodar={rodar} fechar={() => setEditar(null)}
              inicial={{ ...vazia, phone_number_id: n.phone_number_id, waba_id: n.waba_id ?? '', nome: n.nome ?? '', encaminhar_url: n.encaminhar_url ?? '' }} />
          )}
        </div>
      ))}
      {editar === ''
        ? <FormNumero empresa={e.id} inicial={vazia} editando={false} ocupado={ocupado} rodar={rodar} fechar={() => setEditar(null)} />
        : <div className={g.linha}><button type="button" className={g.botaoSec} disabled={ocupado} onClick={() => setEditar('')}>Adicionar número</button></div>}
    </div>
  );
}

function CartaoEmpresa({ e, ocupado, rodar }: {
  e: LinhaEmpresa; ocupado: boolean; rodar: (fn: () => Promise<Resposta<LinhaEmpresa[]>>, ok: string, depois?: () => void) => void;
}) {
  const [modulos, setModulos] = useState<string[]>(e.modulos);
  const [dominio, setDominio] = useState('');
  const [admin, setAdmin] = useState({ nome: '', email: '' });
  const [banco, setBanco] = useState('');
  const [convite, setConvite] = useState<{ nome: string; codigo: string } | null>(null);
  const [nome, setNome] = useState<string | null>(null);
  const mudouModulos = [...modulos].sort().join() !== [...e.modulos].sort().join();

  return (
    <article className={g.cartao} aria-label={`Empresa ${e.nome}`} data-empresa={e.id}>
      <div className={g.cartaoTopo}>
        {nome === null ? (
          <>
            <h2 className={g.cartaoNome}>{e.nome}</h2>
            <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado} onClick={() => setNome(e.nome)}>Renomear</button>
          </>
        ) : (
          <form className={g.linha} onSubmit={(ev) => { ev.preventDefault(); rodar(() => atualizarEmpresa(e.id, { nome }), `Empresa renomeada para ${nome.trim()}.`, () => setNome(null)); }}>
            <input aria-label={`Novo nome de ${e.nome}`} className={g.entrada} value={nome} onChange={(ev) => setNome(ev.target.value)} required maxLength={80} autoFocus />
            <button type="submit" className={`${g.botao} ${g.botaoPeq}`} disabled={ocupado || !nome.trim()}>Salvar</button>
            <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} onClick={() => setNome(null)}>Cancelar</button>
          </form>
        )}
        <span className={g.id}>{e.id}</span>
        <span className={`${g.selo} ${e.ativo ? g.seloOk : g.seloOff}`}>{e.ativo ? 'Ativa' : 'Desativada'}</span>
        <span className={g.selo}>{e.pessoas} {e.pessoas === 1 ? 'pessoa' : 'pessoas'}</span>
        <span className={g.espaco} />
        <button type="button" className={`${e.ativo ? g.botaoPerigo : g.botaoSec} ${g.botaoPeq}`} disabled={ocupado}
          onClick={() => rodar(() => atualizarEmpresa(e.id, { ativo: !e.ativo }), e.ativo ? `${e.nome} foi desativada: ninguém dela entra mais.` : `${e.nome} foi reativada.`)}>
          {e.ativo ? 'Desativar empresa' : 'Reativar empresa'}
        </button>
      </div>

      <div className={g.bloco}>
        <h3 className={g.blocoTitulo}>Módulos liberados</h3>
        <Modulos prefixo={`mod-${e.id}`} valor={modulos} onChange={setModulos} />
        {mudouModulos && (
          <div className={g.linha}>
            <button type="button" className={g.botao} disabled={ocupado}
              onClick={() => rodar(() => atualizarEmpresa(e.id, { modulos }), `Módulos de ${e.nome} salvos.`)}>Salvar módulos</button>
            <button type="button" className={g.botaoSec} onClick={() => setModulos(e.modulos)}>Desfazer</button>
          </div>
        )}
      </div>

      <div className={g.bloco}>
        <h3 className={g.blocoTitulo}>Domínios</h3>
        <div className={g.chips}>
          {e.dominios.length === 0 && <span className={g.dica}>Nenhum. A empresa entra pelo endereço geral do painel.</span>}
          {e.dominios.map((d) => (
            <span key={d} className={g.chip}>{d}
              <button type="button" aria-label={`Remover ${d}`} disabled={ocupado}
                onClick={() => rodar(() => removerDominio(d), `${d} removido.`)}><Icone nome="fechar" tamanho={12} /></button>
            </span>
          ))}
        </div>
        <form className={g.linha} onSubmit={(ev) => { ev.preventDefault(); rodar(() => adicionarDominio(e.id, dominio), `${dominio.trim()} cadastrado. O HTTPS sai em até 1 minuto depois que o DNS apontar para o servidor.`, () => setDominio('')); }}>
          <label className={g.visivelLeitor} htmlFor={`dom-${e.id}`}>Novo domínio</label>
          <input id={`dom-${e.id}`} className={g.entrada} placeholder="painel.clinica.com.br" value={dominio} onChange={(ev) => setDominio(ev.target.value)} required />
          <button type="submit" className={g.botaoSec} disabled={ocupado}>Adicionar domínio</button>
        </form>
      </div>

      <div className={g.bloco}>
        <h3 className={g.blocoTitulo}>Admins</h3>
        <div className={g.chips}>
          {e.admins.length === 0 && <span className={g.dica}>Nenhum admin ainda.</span>}
          {e.admins.map((a) => <span key={a} className={`${g.chip} ${g.chipSo}`}>{a}</span>)}
        </div>
        <form className={g.linha} onSubmit={(ev) => { ev.preventDefault(); const nomeAdmin = admin.nome.trim(); rodar(async () => {
          const r = await adicionarAdmin(e.id, admin.nome, admin.email);
          if (!r.ok) return r;
          setConvite(r.dados.codigo ? { nome: nomeAdmin, codigo: r.dados.codigo } : null);
          return { ok: true as const, dados: r.dados.empresas };
        }, `${nomeAdmin} é admin de ${e.nome}.`, () => setAdmin({ nome: '', email: '' })); }}>
          <input aria-label="Nome do admin" className={g.entrada} placeholder="Nome" value={admin.nome} onChange={(ev) => setAdmin({ ...admin, nome: ev.target.value })} required maxLength={80} />
          <input aria-label="E-mail do admin" type="email" className={g.entrada} placeholder="e-mail" value={admin.email} onChange={(ev) => setAdmin({ ...admin, email: ev.target.value })} required maxLength={200} />
          <button type="submit" className={g.botaoSec} disabled={ocupado}>Adicionar admin</button>
        </form>
        {convite && (
          <div className={`${g.aviso} ${g.avisoOk}`} role="status">
            <span>
              Código de primeiro acesso de {convite.nome}: <strong className={g.codigo} data-convite>{convite.codigo}</strong>. Vale 7 dias.
              Envie para a pessoa: ela cria a senha em &quot;Primeiro acesso&quot;. Este código não aparece de novo.
            </span>
            <button type="button" aria-label="Fechar código" onClick={() => setConvite(null)}><Icone nome="fechar" tamanho={14} /></button>
          </div>
        )}
      </div>

      <Numeros e={e} ocupado={ocupado} rodar={rodar} />

      <div className={g.bloco}>
        <h3 className={g.blocoTitulo}>Banco de dados</h3>
        <p className={g.dica}>{e.banco_proprio ? 'Banco próprio (endereço guardado cifrado).' : 'Sem banco próprio. Só a empresa padrão do painel funciona assim; as outras só abrem o CRM depois que o banco delas for salvo aqui.'}</p>
        <form className={g.linha} onSubmit={(ev) => { ev.preventDefault(); rodar(() => definirBancoEmpresa(e.id, banco), 'Banco da empresa salvo.', () => setBanco('')); }}>
          <input aria-label="Connection string do banco" type="password" autoComplete="off" className={g.entrada} placeholder="postgresql://..." value={banco} onChange={(ev) => setBanco(ev.target.value)} required />
          <button type="submit" className={g.botaoSec} disabled={ocupado}>Salvar banco</button>
          {e.banco_proprio && (
            <button type="button" className={g.botaoSec} disabled={ocupado}
              onClick={() => rodar(() => definirBancoEmpresa(e.id, ''), 'A empresa voltou para o banco padrão.')}>Voltar ao padrão</button>
          )}
        </form>
      </div>
    </article>
  );
}

export function Empresas({ inicial }: { inicial: LinhaEmpresa[] }) {
  const [empresas, setEmpresas] = useState(inicial);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [nova, setNova] = useState<{ nome: string; id: string; idManual: boolean; modulos: string[] }>(
    { nome: '', id: '', idManual: false, modulos: ['inbox.ver', ...MODELOS.gestor.permissoes.filter((p) => p !== 'inbox.ver')] },
  );

  const rodar = (fn: () => Promise<Resposta<LinhaEmpresa[]>>, ok: string, depois?: () => void) => iniciar(async () => {
    const r = await fn();
    if (!r.ok) { if (r.sair) window.location.href = '/entrar?motivo=sessao'; setAviso({ tipo: 'erro', texto: r.erro }); return; }
    setEmpresas(r.dados); setAviso({ tipo: 'ok', texto: ok }); depois?.();
  });

  // Enquanto o receptor executa um pedido (conectar, histórico), a tela relê a cada 4 s para mostrar o resultado.
  const esperando = empresas.some((e) => e.numeros.some(pendente));
  useEffect(() => {
    if (!esperando) return;
    const t = setInterval(async () => { const r = await carregarEmpresas(); if (r.ok) setEmpresas(r.dados); }, 4000);
    return () => clearInterval(t);
  }, [esperando]);

  return (
    <div className={g.tela}>
      <div className={g.topo}>
        <div>
          <p className={g.rotulo}>Planee · master</p>
          <h1 className={g.titulo}>Empresas</h1>
          <p className={g.sub}>Cada empresa tem os próprios domínios, módulos e banco. O admin de cada uma só distribui o que estiver liberado aqui.</p>
        </div>
      </div>

      {aviso && (
        <div className={`${g.aviso} ${aviso.tipo === 'erro' ? g.avisoErro : g.avisoOk}`} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
          <span>{aviso.texto}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setAviso(null)}><Icone nome="fechar" tamanho={14} /></button>
        </div>
      )}

      <form className={g.cartao} aria-labelledby="titulo-nova" onSubmit={(ev) => {
        ev.preventDefault();
        rodar(() => criarEmpresa({ id: nova.id, nome: nova.nome, modulos: nova.modulos }), `${nova.nome.trim()} foi criada.`,
          () => setNova({ ...nova, nome: '', id: '', idManual: false }));
      }}>
        <h2 id="titulo-nova" className={g.blocoTitulo}>Nova empresa</h2>
        <div className={g.linha}>
          <label className={g.campo}>Nome<input id="nova-nome" value={nova.nome} required maxLength={80}
            onChange={(ev) => setNova({ ...nova, nome: ev.target.value, id: nova.idManual ? nova.id : slug(ev.target.value) })} /></label>
          <label className={g.campo}>Identificador<input id="nova-id" value={nova.id} required maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,39}"
            onChange={(ev) => setNova({ ...nova, id: ev.target.value.toLowerCase(), idManual: true })} /></label>
        </div>
        <Modulos prefixo="nova" valor={nova.modulos} onChange={(v) => setNova({ ...nova, modulos: v })} />
        <div className={g.linha}><button type="submit" className={g.botao} disabled={ocupado}>Criar empresa</button></div>
      </form>

      {empresas.map((e) => <CartaoEmpresa key={`${e.id}-${e.modulos.join()}`} e={e} ocupado={ocupado} rodar={rodar} />)}
    </div>
  );
}
