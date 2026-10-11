'use client';

import { useActionState, useEffect, useState } from 'react';
import { entrarPorConvite, type EstadoConvite } from './acoes';
import e from './entrar.module.css';

export function FormConvite({ token, empresa }: { token: string; empresa: string | null }) {
  const [estado, acao, enviando] = useActionState<EstadoConvite, FormData>(entrarPorConvite, { erro: null, nome: '', email: '', enviado: false });
  // O nome da empresa da primeira vez: depois do cadastro o link já está gasto e a página volta sem ele.
  const [nomeEmpresa] = useState(empresa);
  useEffect(() => { if (estado.destino) window.location.assign(estado.destino); }, [estado.destino]);
  const feito = Boolean(estado.destino) || estado.enviado;

  const marca = (
    <div className={e.marca}>
      <span className={e.logo}>P</span>
      <div>
        <div className={e.marcaNome}>Painel Planee</div>
        {nomeEmpresa && <div className={e.marcaSub}>{nomeEmpresa}</div>}
      </div>
    </div>
  );

  if (!nomeEmpresa && !feito) {
    return (
      <>
        {marca}
        <h1 id="titulo" className={e.titulo}>Link inválido</h1>
        <p className={e.sub}>Este link de convite já foi usado, venceu ou foi cancelado. Peça um link novo a quem convidou você.</p>
      </>
    );
  }
  if (feito) {
    return (
      <>
        {marca}
        <h1 id="titulo" className={e.titulo}>Acesso criado</h1>
        {estado.enviado
          ? <p className={e.ok} role="status">Pronto! Enviamos um e-mail para {estado.email}. Confirme por lá e depois entre com a senha que você criou.</p>
          : <p className={e.ok} role="status">Entrando no painel…</p>}
      </>
    );
  }
  return (
    <>
      {marca}
      <h1 id="titulo" className={e.titulo}>Você foi convidado</h1>
      <p className={e.sub}>Crie o seu acesso ao painel da {nomeEmpresa}. Depois de entrar, o admin libera as telas que você vai usar.</p>
      <form action={acao} className={e.form} noValidate>
        <input type="hidden" name="token" value={token} />
        <label className={e.campo}>
          <span>Seu nome</span>
          <input id="nome" name="nome" type="text" autoComplete="name" required maxLength={80} defaultValue={estado.nome} autoFocus />
        </label>
        <label className={e.campo}>
          <span>E-mail</span>
          <input id="email" name="email" type="email" autoComplete="username" required maxLength={200} defaultValue={estado.email} />
        </label>
        <label className={e.campo}>
          <span>Senha (mínimo 8 caracteres)</span>
          <input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        <label className={e.campo}>
          <span>Repita a senha</span>
          <input id="repete" name="repete" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        {estado.erro && <p className={e.erro} role="alert">{estado.erro}</p>}
        <button type="submit" className={e.botao} disabled={enviando}>{enviando ? 'Criando…' : 'Criar acesso e entrar'}</button>
      </form>
    </>
  );
}
