// Volta da autorização do Google — troca o "code" pelos tokens (access +
// refresh) e grava cifrado. Só precisa acontecer UMA vez; o resto do sistema
// renova sozinho a partir daqui (ver ../lib.js:getFreshGoogleToken).
//
//   GET /api/google/callback?code=...  (chamado pelo próprio Google)

import { createClient } from '@supabase/supabase-js'
import { trocarCodePorTokens } from '../lib.js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

function pagina(titulo, msg, ok) {
  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + titulo + ' — CMP Advogados</title></head>'
    + '<body style="margin:0;font-family:system-ui,Arial,sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh">'
    + '<div style="background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.08);padding:34px 30px;max-width:440px;margin:16px;text-align:center">'
    + '<div style="font-size:52px;line-height:1">' + (ok ? '✅' : '⚠️') + '</div>'
    + '<h1 style="font-size:21px;color:#1e2733;margin:14px 0 8px">' + titulo + '</h1>'
    + '<p style="font-size:14.5px;color:#5b6472;line-height:1.6;margin:0">' + msg + '</p>'
    + '<p style="font-size:12px;color:#9aa1ab;margin:22px 0 0">Crispim Mendonça e Pinheiro Advogados</p>'
    + '</div></body></html>'
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const erroGoogle = searchParams.get('error')
  if (erroGoogle) {
    return pagina('Autorização cancelada', 'O Google devolveu: <b>' + erroGoogle + '</b>. Se foi engano, abra <code>/api/google/auth</code> de novo.', false)
  }
  const code = searchParams.get('code')
  if (!code) return pagina('Link inválido', 'Faltou o código de autorização. Abra <code>/api/google/auth</code> de novo.', false)
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return pagina('Indisponível', 'O sistema está temporariamente indisponível. Tente novamente mais tarde.', false)

  const sb = admin()
  const r = await trocarCodePorTokens(sb, code)
  if (r.erro) return pagina('Falha na autorização', 'Não consegui concluir: ' + r.erro, false)

  return pagina('Google Calendar conectado!', 'A partir de agora, audiências e reuniões marcadas no CMPGestão vão aparecer sozinhas no seu Google Calendar — as que já existem entram na próxima sincronização automática. Pode fechar esta aba.', true)
}
