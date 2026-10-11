'use client';

import { useState, useTransition } from 'react';
import { MODELOS, NOME_NIVEL, PERMISSOES } from '@/lib/permissoes';
import { adicionarPessoa, atualizarPessoa, cancelarLinkConvite, gerarLinkConvite, novoConvite } from '@/lib/painel/acoes-gestao';
import type { LinkConvite, Pessoa } from '@/lib/painel/gestao';
import type { Resposta } from '@/lib/painel/acoes';
import { Icone } from '@/components/Icone';
import g from './gestao.module.css';

type Props = {
  inicial: Pessoa[]; empresa: { id: string; nome: string; modulos: string[] };
  souMaster: boolean; meuId: string; endereco: string; links: LinkConvite[];
};

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// Nome do acesso de um link: "Nenhum", o nome do modelo, ou a quantidade de permissões.
function nomeAcesso(perms: string[], modulos: string[]) {
  if (!perms.length) return 'Nenhum (você libera depois)';
  for (const m of Object.values(MODELOS)) {
    const doModelo = m.permissoes.filter((x) => modulos.includes(x));
    if (doModelo.length === perms.length && doModelo.every((x) => perms.includes(x))) return m.nome;
  }
  return `${perms.length} permissões`;
}

// Link de convite de uso único: a pessoa cria o próprio acesso e entra como membro com o acesso escolhido aqui.
function ConvidarPorLink({ modulos, inicial, aoErro }: { modulos: string[]; inicial: LinkConvite[]; aoErro: (t: string, sair?: boolean) => void }) {
  const [links, setLinks] = useState(inicial);
  const [modelo, setModelo] = useState<'' | keyof typeof MODELOS>('');
  const [gerado, setGerado] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const modelos = (Object.keys(MODELOS) as (keyof typeof MODELOS)[]).filter((m) => MODELOS[m].permissoes.some((p) => modulos.includes(p)));

  const gerar = () => iniciar(async () => {
    const perms = modelo ? MODELOS[modelo].permissoes.filter((p) => modulos.includes(p)) : [];
    const r = await gerarLinkConvite(perms);
    if (!r.ok) { aoErro(r.erro, r.sair); return; }
    setGerado(r.dados.url); setLinks(r.dados.links); setCopiado(false);
  });
  const cancelar = (id: string) => iniciar(async () => {
    const r = await cancelarLinkConvite(id);
    if (!r.ok) { aoErro(r.erro, r.sair); return; }
    setLinks(r.dados);
  });
  const copiar = async () => {
    if (!gerado) return;
    try { await navigator.clipboard.writeText(gerado); setCopiado(true); } catch { setCopiado(false); }
  };

  return (
    <section className={g.cartao} aria-labelledby="titulo-link">
      <h2 id="titulo-link" className={g.blocoTitulo}>Convidar por link</h2>
      <p className={g.dica}>
        Gere um link e mande para a pessoa (WhatsApp ou e-mail). Ela mesma cria o acesso com nome, e-mail e senha.
        Cada link vale para uma pessoa só, por 7 dias. Depois que ela entrar, aumente o acesso em &quot;Permissões&quot;, aqui embaixo.
      </p>
      <div className={g.linha}>
        <label className={g.campo}>Acesso ao entrar
          <select id="link-acesso" value={modelo} onChange={(e) => setModelo(e.target.value as '' | keyof typeof MODELOS)}>
            <option value="">Nenhum (eu libero depois)</option>
            {modelos.map((m) => <option key={m} value={m}>{MODELOS[m].nome}</option>)}
          </select>
        </label>
        <button type="button" className={g.botao} disabled={ocupado} onClick={gerar}>Gerar link</button>
      </div>
      {gerado && (
        <div className={g.bloco}>
          <div className={g.linha}>
            <input className={g.entrada} id="link-gerado" readOnly value={gerado} onFocus={(e) => e.currentTarget.select()} aria-label="Link de convite" data-link />
            <button type="button" className={g.botaoSec} onClick={copiar}>{copiado ? 'Copiado' : 'Copiar'}</button>
          </div>
          <p className={g.dica}>Este link aparece só agora. Se perder, gere outro.</p>
        </div>
      )}
      {links.length > 0 && (
        <div className={g.bloco} aria-label="Links ativos">
          <span className={g.dica}>Links ainda não usados:</span>
          {links.map((l) => (
            <div key={l.id} className={g.linha} data-link-ativo={l.id}>
              <span className={g.dica}>
                Criado em {dia(l.criado_em)}{l.criado_por ? ` por ${l.criado_por}` : ''} · vale até {dia(l.expira_em)} · acesso: {nomeAcesso(l.permissoes, modulos)}
              </span>
              <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado} onClick={() => cancelar(l.id)}>Cancelar link</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Permissões que a empresa tem, com modelos prontos. O servidor confere tudo de novo.
function Permissoes({ modulos, valor, onChange, prefixo }: { modulos: string[]; valor: string[]; onChange: (v: string[]) => void; prefixo: string }) {
  const lista = PERMISSOES.filter((p) => modulos.includes(p.id));
  const marcar = (id: string, sim: boolean) => onChange(sim ? [...valor, id] : valor.filter((x) => x !== id));
  const aplicar = (m: keyof typeof MODELOS) => onChange(MODELOS[m].permissoes.filter((p) => modulos.includes(p)));
  if (!lista.length) return <p className={g.dica}>A empresa ainda não tem módulos liberados. Peça à Planee.</p>;
  return (
    <div className={g.bloco}>
      <div className={g.linha}>
        <span className={g.dica}>Modelo:</span>
        {(Object.keys(MODELOS) as (keyof typeof MODELOS)[]).map((m) => (
          <button key={m} type="button" className={`${g.botaoSec} ${g.botaoPeq}`} onClick={() => aplicar(m)}>{MODELOS[m].nome}</button>
        ))}
      </div>
      <div className={g.checks}>
        {lista.map((p) => (
          <label key={p.id} className={g.check}>
            <input type="checkbox" id={`${prefixo}-${p.id}`} checked={valor.includes(p.id)} onChange={(e) => marcar(p.id, e.target.checked)} />
            <span>{p.nome}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function Equipe({ inicial, empresa, souMaster, meuId, endereco, links }: Props) {
  const [pessoas, setPessoas] = useState(inicial);
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [novo, setNovo] = useState({ nome: '', email: '', nivel: 'membro', permissoes: MODELOS.secretaria.permissoes.filter((p) => empresa.modulos.includes(p)) as string[] });
  const [editando, setEditando] = useState<string | null>(null);
  const [permsEdit, setPermsEdit] = useState<string[]>([]);
  const [convite, setConvite] = useState<{ nome: string; codigo: string } | null>(null);

  const rodar = (fn: () => Promise<Resposta<Pessoa[]>>, ok: string, depois?: () => void) => iniciar(async () => {
    const r = await fn();
    if (!r.ok) { if (r.sair) window.location.href = '/entrar?motivo=sessao'; setAviso({ tipo: 'erro', texto: r.erro }); return; }
    setPessoas(r.dados); setAviso({ tipo: 'ok', texto: ok }); depois?.();
  });

  // Código de primeiro acesso: aparece uma vez, aqui, para o admin enviar à pessoa (só o hash fica no banco).
  const gerarCodigo = (id: string, nome: string) => iniciar(async () => {
    const r = await novoConvite(id);
    if (!r.ok) { if (r.sair) window.location.href = '/entrar?motivo=sessao'; setAviso({ tipo: 'erro', texto: r.erro }); return; }
    setConvite({ nome, codigo: r.dados }); setAviso(null);
  });

  const r0 = (nome: string) => `${nome} foi adicionada à equipe.`;
  const nomeDe = (id: string) => PERMISSOES.find((p) => p.id === id)?.nome ?? id;

  return (
    <div className={g.tela}>
      <div className={g.topo}>
        <div>
          <p className={g.rotulo}>{empresa.nome}</p>
          <h1 className={g.titulo}>Equipe</h1>
          <p className={g.sub}>
            Quem entra no painel desta empresa e o que cada pessoa pode fazer. A pessoa entra em {endereco} com o e-mail
            cadastrado. No primeiro acesso, ela cria a senha em &quot;Primeiro acesso&quot; com o código que aparece aqui
            quando você a adiciona (vale 7 dias; dá para gerar outro).
          </p>
        </div>
      </div>

      {aviso && (
        <div className={`${g.aviso} ${aviso.tipo === 'erro' ? g.avisoErro : g.avisoOk}`} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>
          <span>{aviso.texto}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setAviso(null)}><Icone nome="fechar" tamanho={14} /></button>
        </div>
      )}

      {convite && (
        <div className={`${g.aviso} ${g.avisoOk}`} role="status">
          <span>
            Código de primeiro acesso de {convite.nome}: <strong className={g.codigo} data-convite>{convite.codigo}</strong>. Vale 7 dias.
            Envie para a pessoa: ela cria a senha em &quot;Primeiro acesso&quot;. Este código não aparece de novo.
          </span>
          <button type="button" aria-label="Fechar código" onClick={() => setConvite(null)}><Icone nome="fechar" tamanho={14} /></button>
        </div>
      )}

      <ConvidarPorLink modulos={empresa.modulos} inicial={links} aoErro={(texto, sair) => {
        if (sair) window.location.href = '/entrar?motivo=sessao';
        setAviso({ tipo: 'erro', texto });
      }} />

      <form className={g.cartao} aria-labelledby="titulo-novo" onSubmit={(e) => {
        e.preventDefault();
        const nome = novo.nome.trim();
        rodar(async () => {
          const r = await adicionarPessoa(novo);
          if (!r.ok) return r;
          setConvite(r.dados.codigo ? { nome, codigo: r.dados.codigo } : null);
          return { ok: true as const, dados: r.dados.pessoas };
        }, r0(nome), () => setNovo({ ...novo, nome: '', email: '' }));
      }}>
        <h2 id="titulo-novo" className={g.blocoTitulo}>Adicionar pessoa pelo e-mail</h2>
        <div className={g.linha}>
          <label className={g.campo}>Nome<input id="novo-nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required maxLength={80} /></label>
          <label className={g.campo}>E-mail<input id="novo-email" type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} required maxLength={200} /></label>
          {souMaster && (
            <label className={g.campo}>Nível
              <select id="novo-nivel" value={novo.nivel} onChange={(e) => setNovo({ ...novo, nivel: e.target.value })}>
                <option value="membro">Membro</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          )}
        </div>
        {novo.nivel === 'membro'
          ? <Permissoes prefixo="novo" modulos={empresa.modulos} valor={novo.permissoes} onChange={(v) => setNovo({ ...novo, permissoes: v })} />
          : <p className={g.dica}>Admin tem tudo o que a empresa tem e cuida da equipe.</p>}
        <div className={g.linha}><button type="submit" className={g.botao} disabled={ocupado}>Adicionar</button></div>
      </form>

      <section className={g.cartao} aria-label="Pessoas da equipe">
        {pessoas.length === 0 && <p className={g.dica}>Ninguém cadastrado nesta empresa ainda.</p>}
        <div className={g.lista}>
          {pessoas.map((p) => {
            const eu = p.id === meuId;
            const podeMexer = !eu && (souMaster || p.nivel === 'membro');
            return (
              <div key={p.id} className={`${g.pessoa} ${p.ativo ? '' : g.inativa}`} data-email={p.email}>
                <div>
                  <div className={g.pessoaNome}>{p.nome}{eu ? ' (você)' : ''}</div>
                  <div className={g.pessoaEmail}>{p.email}</div>
                  <div className={g.linha} style={{ marginTop: 6 }}>
                    <span className={g.selo}>{NOME_NIVEL[p.nivel]}</span>
                    {!p.ativo && <span className={`${g.selo} ${g.seloOff}`}>Desativada</span>}
                    {p.ativo && !p.ja_entrou && <span className={g.selo}>Ainda não entrou</span>}
                  </div>
                </div>
                <div className={g.chips}>
                  {p.nivel === 'admin'
                    ? <span className={`${g.chip} ${g.chipSo}`}>Tudo o que a empresa tem</span>
                    : p.permissoes.length
                      ? p.permissoes.map((x) => <span key={x} className={`${g.chip} ${g.chipSo}`}>{nomeDe(x)}</span>)
                      : <span className={`${g.chip} ${g.chipSemAcesso}`} data-sem-acesso>Sem acesso ainda: clique em Permissões</span>}
                </div>
                <div className={g.pessoaAcoes}>
                  {podeMexer && p.nivel === 'membro' && p.ativo && (
                    <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} onClick={() => { setEditando(editando === p.id ? null : p.id); setPermsEdit(p.permissoes); }}>
                      Permissões
                    </button>
                  )}
                  {podeMexer && souMaster && p.ativo && (
                    <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado}
                      onClick={() => rodar(() => atualizarPessoa(p.id, { nivel: p.nivel === 'admin' ? 'membro' : 'admin' }), `${p.nome} agora é ${p.nivel === 'admin' ? 'membro' : 'admin'}.`)}>
                      {p.nivel === 'admin' ? 'Tornar membro' : 'Tornar admin'}
                    </button>
                  )}
                  {podeMexer && p.ativo && !p.ja_entrou && (
                    <button type="button" className={`${g.botaoSec} ${g.botaoPeq}`} disabled={ocupado} onClick={() => gerarCodigo(p.id, p.nome)}>
                      Novo código
                    </button>
                  )}
                  {podeMexer && (
                    <button type="button" className={`${p.ativo ? g.botaoPerigo : g.botaoSec} ${g.botaoPeq}`} disabled={ocupado}
                      onClick={() => rodar(() => atualizarPessoa(p.id, { ativo: !p.ativo }), p.ativo ? `${p.nome} não entra mais nesta empresa.` : `${p.nome} voltou a ter acesso.`)}>
                      {p.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  )}
                </div>
                {editando === p.id && (
                  <div className={g.editor}>
                    <Permissoes prefixo={`ed-${p.id}`} modulos={empresa.modulos} valor={permsEdit} onChange={setPermsEdit} />
                    <div className={g.linha}>
                      <button type="button" className={g.botao} disabled={ocupado}
                        onClick={() => rodar(() => atualizarPessoa(p.id, { permissoes: permsEdit }), `Permissões de ${p.nome} salvas.`, () => setEditando(null))}>
                        Salvar permissões
                      </button>
                      <button type="button" className={g.botaoSec} onClick={() => setEditando(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
