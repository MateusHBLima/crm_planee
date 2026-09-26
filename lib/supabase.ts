import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lê o .env.local (ou as variáveis da Vercel). Sem chave configurada, devolve null e o app segue abrindo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function supabaseCliente(): SupabaseClient<any, any, any> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !chave) return null;
  return createClient(url, chave, {
    db: { schema: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'teste' },
  });
}

export function supabaseConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
