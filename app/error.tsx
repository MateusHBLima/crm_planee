'use client';

import p from './pagina.module.css';

// Erro inesperado numa tela (banco fora do ar, por exemplo): mensagem em português com saída, em vez da página
// genérica do Next em inglês (auditoria 01/10, U6).
export default function Erro({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={p.erroPagina} role="alert">
      <h1 className={p.titulo}>Não foi possível abrir esta tela agora</h1>
      <p className={p.texto}>Pode ser uma instabilidade de conexão. Tente de novo em alguns segundos; se continuar, avise a Planee.</p>
      <div className={p.erroAcoes}>
        <button type="button" className={p.botao} onClick={() => reset()}>Tentar de novo</button>
        <a className={p.link} href="/">Voltar ao início</a>
      </div>
    </main>
  );
}
