// Roda uma vez quando o servidor do painel sobe (Next.js). Liga o vigia dos avisos automáticos (lib/painel/vigia.ts).
// PAINEL_VIGIA=0 desliga; sem banco configurado, não liga. O import fica dentro do "if" do runtime Node para o
// Next não levar o pg (que usa fs e net) para o runtime edge.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.PAINEL_VIGIA === '0' || !(process.env.CENTRAL_DATABASE_URL || process.env.DATABASE_URL)) return;
    const { iniciarVigia } = await import('./lib/painel/vigia');
    iniciarVigia();
  }
}
