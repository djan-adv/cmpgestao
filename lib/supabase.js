// Cliente Supabase (navegador). Usa a URL e a chave pública (publishable/anon)
// definidas em .env.local — a chave secreta NUNCA entra aqui.
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
