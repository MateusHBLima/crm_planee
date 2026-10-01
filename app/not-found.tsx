import Link from 'next/link';
import p from './pagina.module.css';

export default function NaoEncontrado() {
  return (
    <main className={p.erroPagina}>
      <h1 className={p.titulo}>Página não encontrada</h1>
      <p className={p.texto}>O endereço pode estar errado ou a tela não existe mais.</p>
      <div className={p.erroAcoes}><Link className={p.link} href="/">Voltar ao início</Link></div>
    </main>
  );
}
