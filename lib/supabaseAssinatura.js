// Cliente Supabase do ASSINADOR de documentos (projeto separado do banco do CMPGestão).
// Usa a URL e a chave publishable — valores PÚBLICOS, seguros no navegador (as chaves
// secretas ficam só no servidor/Vercel). As telas públicas /assinar e /assinar-doc e o
// módulo /assinatura usam este cliente; o banco do CMP continua em lib/supabase.js.
import { createClient } from '@supabase/supabase-js'

export const SIGN_URL = process.env.NEXT_PUBLIC_SIGN_SUPABASE_URL || 'https://fjboytucivmdykkfpdhs.supabase.co'
export const SIGN_KEY = process.env.NEXT_PUBLIC_SIGN_SUPABASE_ANON_KEY || 'sb_publishable_9K2-GBTRb7ZYd5dkjPoeZA_kPPNElex'

export const signSb = createClient(SIGN_URL, SIGN_KEY, { auth: { persistSession: false } })
