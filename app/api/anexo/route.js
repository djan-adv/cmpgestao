// Serve um anexo (captura) guardado no Storage 'capturas'.
//   GET /api/anexo?id=<uuid>[&dl=1]   (Authorization: Bearer <jwt> | ?jwt= | ?k=<chave>)

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

import { ESCRITORIO_PADRAO, escritorioDoUsuario } from '../../../lib/escritorio.js'
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const dl = searchParams.get('dl')
  const k = searchParams.get('k') || ''
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || searchParams.get('jwt') || ''
  if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })

  let ok = false
  // O anexo é do escritório de QUEM PEDE — não do escritório da instalação. Sem
  // isto, um segundo escritório na mesma raiz abriria anexo alheio pelo id.
  let esc = ESCRITORIO_PADRAO
  const secret = process.env.CAPTURA_SECRET || ''
  if (secret && k && k === secret) ok = true
  else if (jwt) {
    try {
      const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      const u = await auth.auth.getUser(jwt)
      const user = (u && u.data && u.data.user) || null
      ok = !!user
      if (user) esc = await escritorioDoUsuario(user)
    } catch (e) {}
  }
  if (!ok) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  const sb = admin()
  const { data: meta } = await sb.from('anexos').select('nome,tipo,path').eq('escritorio_id', esc).eq('id', id).maybeSingle()
  if (!meta || !meta.path) return Response.json({ erro: 'anexo não encontrado' }, { status: 404 })

  const dlRes = await sb.storage.from('capturas').download(meta.path)
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
