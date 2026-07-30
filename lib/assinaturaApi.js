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

// Envia o LINK de assinatura por e-mail PELO SERVIDOR DO CMP (contato@, SMTP que
// funciona) — a edge function do assinador vivia dando 500 e o envio "0 de 1".
// forcar=true pula a trava anti-repetição (reenvio do mesmo link no mesmo dia).
export async function enviarLinkAssinatura({ to, nome, titulo, link, forcar = true }) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    const primeiro = String(nome || '').trim().split(/\s+/)[0] || ''
    const corpo = 'Olá' + (primeiro ? ', ' + primeiro : '') + '!\n\n'
      + 'Segue o link para assinatura eletrônica: ' + (titulo || 'documento') + '\n\n'
      + link + '\n\n'
      + 'Abra pelo celular ou computador, confira os dados e assine. Qualquer dúvida, estamos à disposição.\n\n'
      + 'Crispim, Mendonça e Pinheiro — Advogados\n0800 591 7259 · contato@cmpadvogados.com.br'
    const r = await fetch('/api/enviar-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ para: to, assunto: 'Assinatura eletrônica — ' + (titulo || 'documento'), corpo, forcar: !!forcar }),
    })
    const j = await r.json().catch(() => ({}))
    return r.ok && !j.erro
  } catch { return false }
}
