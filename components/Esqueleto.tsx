import p from '@/app/pagina.module.css';

// Esqueleto da tela enquanto os dados chegam (09/10): a navegação não espera o banco, que fica em outra região.
export function Esqueleto({ titulo }: { titulo: string }) {
  return (
    <div className={p.carregando} aria-busy="true" aria-live="polite">
      <h1 className={p.titulo}>{titulo}</h1>
      <span className={p.carregandoLinha} style={{ width: '38%' }} />
      <div className={p.carregandoGrade}>
        {Array.from({ length: 8 }, (_, i) => <span key={i} className={p.carregandoBloco} />)}
      </div>
      <span className={p.dica}>Carregando…</span>
    </div>
  );
}

export function ErroDaTela({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <>
      <h1 className={p.titulo}>{titulo}</h1>
      <div className={p.cartao} role="alert"><p className={p.texto}>{texto}</p></div>
    </>
  );
}
