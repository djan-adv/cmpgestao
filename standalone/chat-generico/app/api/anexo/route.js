// Serve uma imagem/anexo do chat guardado no bucket privado 'chat-anexos'.
//   GET /api/anexo?id=<uuid>[&dl=1]   (Authorization: Bearer <jwt> | ?jwt=)

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const BUCKET = 'chat-anexos'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const dl = searchParams.get('dl')
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || searchParams.get('jwt') || ''
  if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })

  let ok = false
  if (jwt) {
    try {
      const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      const u = await auth.auth.getUser(jwt)
      ok = !!(u && u.data && u.data.user)
    } catch (e) {}
  }
  if (!ok) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  const sb = admin()
  const { data: meta } = await sb.from('chat_anexos').select('nome,tipo,path').eq('id', id).maybeSingle()
  if (!meta || !meta.path) return Response.json({ erro: 'anexo não encontrado' }, { status: 404 })

  const dlRes = await sb.storage.from(BUCKET).download(meta.path)
  if (dlRes.error || !dlRes.data) return Response.json({ erro: 'falha ao ler o arquivo' }, { status: 502 })
  const buf = Buffer.from(await dlRes.data.arrayBuffer())
  const nome = (meta.nome || 'anexo').replace(/[^\w.\- ]+/g, '_')
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': meta.tipo || 'application/octet-stream',
      'Content-Disposition': (dl ? 'attachment' : 'inline') + '; filename="' + nome + '"',
      'Cache-Control': 'private, max-age=300',
    },
  })
}
