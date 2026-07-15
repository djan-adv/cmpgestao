// jus.br / PDPJ — servir um arquivo já baixado (visualizar/baixar no sistema).
//   GET /api/jusbr/arquivo?id=<uuid>[&dl=1]   (Authorization: Bearer <jwt> OU ?jwt=)
// Devolve o PDF guardado (jusbr_arquivos). Aceita o JWT no header ou na query
// (a query é útil para abrir o PDF direto numa nova aba / <embed>).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const dl = searchParams.get('dl')
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || searchParams.get('jwt') || ''
  if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
  if (!jwt) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await auth.auth.getUser(jwt)
  if (!(u && u.data && u.data.user)) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const sb = admin()
  const { data } = await sb.from('jusbr_arquivos').select('doc_nome,doc_tipo,conteudo_b64').eq('escritorio_id', ESCRITORIO_CMP).eq('id', id).maybeSingle()
  if (!data || !data.conteudo_b64) return Response.json({ erro: 'arquivo não encontrado (pode ter expirado)' }, { status: 404 })

  let buf = Buffer.from(data.conteudo_b64, 'base64')
  const tipo = data.doc_tipo || 'application/pdf'
  const ext = tipo.indexOf('html') > -1 ? '.html' : (tipo.indexOf('pdf') > -1 ? '.pdf' : '')
  const nome = (data.doc_nome || 'documento').replace(/[^\w.\- ]+/g, '_')
  const nomeFinal = /\.\w+$/.test(nome) ? nome : (nome + ext)
  // HTML do jus.br (expediente/decisão): tira o <script> (que travava em "Carregando")
  // e as <img> quebradas (logo/spinner), e aponta o <base> para o PDPJ. Assim o TEXTO
  // da intimação/decisão aparece limpo, sem quadro quebrado. Só ao visualizar (inline).
  if (!dl && tipo.indexOf('html') > -1) {
    try {
      let h = buf.toString('utf8')
      h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<img\b[^>]*>/gi, '')
      if (!/<base\b/i.test(h)) h = h.replace(/<head([^>]*)>/i, '<head$1><base href="https://portaldeservicos.pdpj.jus.br/">')
      buf = Buffer.from(h, 'utf8')
    } catch (e) {}
  }
  const disp = (dl ? 'attachment' : 'inline') + '; filename="' + nomeFinal + '"'
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': tipo,
      'Content-Disposition': disp,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
