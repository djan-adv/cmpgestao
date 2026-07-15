// Chama a API interna do módulo de assinatura autenticado pelo login do CMPGestão.
// O token da sessão vai no header e o servidor valida antes de tocar no banco do assinador.
import { supabase } from './supabase'

export async function apiAssinatura(body) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  const r = await fetch('/api/assinatura', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  })
  return r.json()
}
