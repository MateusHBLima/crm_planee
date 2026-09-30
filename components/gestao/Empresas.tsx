'use client';

import { useState, useTransition } from 'react';
import { MODELOS, PERMISSOES } from '@/lib/permissoes';
import {
  adicionarAdmin, adicionarDominio, atualizarEmpresa, criarEmpresa, definirBancoEmpresa, removerDominio,
} from '@/lib/painel/acoes-gestao';
import type { LinhaEmpresa } from '@/lib/painel/gestao';
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

function CartaoEmpresa({ e, ocupado, rodar }: {
  e: LinhaEmpresa; ocupado: boolean; rodar: (fn: () => Promise<Resposta<LinhaEmpresa[]>>, ok: string, depois?: () => void) => void;
}) {
  const [modulos, setModulos] = useState<string[]>(e.modulos);
  const [dominio, setDominio] = useState('');
  const [admin, setAdmin] = useState({ nome: '', email: '' });
  const [banco, setBanco] = useState('');
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
        <form className={g.linha} onSubmit={(ev) => { ev.preventDefault(); rodar(() => adicionarAdmin(e.id, admin.nome, admin.email), `${admin.nome.trim()} é admin de ${e.nome}.`, () => setAdmin({ nome: '', email: '' })); }}>
          <input aria-label="Nome do admin" className={g.entrada} placeholder="Nome" value={admin.nome} onChange={(ev) => setAdmin({ ...admin, nome: ev.target.value })} required maxLength={80} />
          <input aria-label="E-mail do admin" type="email" className={g.entrada} placeholder="e-mail" value={admin.email} onChange={(ev) => setAdmin({ ...admin, email: ev.target.value })} required maxLength={200} />
          <button type="submit" className={g.botaoSec} disabled={ocupado}>Adicionar admin</button>
        </form>
      </div>

      <div className={g.bloco}>
        <h3 className={g.blocoTitulo}>Banco de dados</h3>
        <p className={g.dica}>{e.banco_proprio ? 'Banco próprio (endereço guardado cifrado).' : 'Usa o banco padrão do painel.'}</p>
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
