// Cliente Supabase (navegador). Usa a URL e a chave pública (publishable/anon)
// definidas em .env.local — a chave secreta NUNCA entra aqui.
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    // explícito (já é o padrão da lib) — mantém o login salvo entre visitas,
    // até a pessoa clicar em "Sair": é o que faz o /chat no celular continuar
    // logado sem pedir senha de novo a cada abertura.
    auth: { persistSession: true, autoRefreshToken: true },
  }
)
