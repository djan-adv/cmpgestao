// Serve um anexo (captura) guardado no Storage 'capturas'.
//   GET /api/anexo?id=<uuid>[&dl=1]   (Authorization: Bearer <jwt> | ?jwt= | ?k=<chave>)

import { createClient } from '@supabase/supabase-js'
import { escritorioDoUsuario, semEscritorio, ESCRITORIO_RAIZ } from '../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

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
  // escritório de quem pede: o anexo só sai se for do escritório dele. A chave
  // de captura (k) é do robô do próprio servidor e não tem usuário — essa
  // continua na raiz, e está anotada como dívida da fase dos robôs.
  let escDoPedido = null
  const secret = process.env.CAPTURA_SECRET || ''
  if (secret && k && k === secret) { ok = true; escDoPedido = ESCRITORIO_RAIZ }
  else if (jwt) {
    try {
      const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      const u = await auth.auth.getUser(jwt)
      ok = !!(u && u.data && u.data.user)
      if (ok) escDoPedido = await escritorioDoUsuario(u.data.user.id)
    } catch (e) {}
  }
  if (!ok) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  if (!escDoPedido) return semEscritorio()
  const sb = admin()
  const { data: meta } = await sb.from('anexos').select('nome,tipo,path').eq('escritorio_id', escDoPedido).eq('id', id).maybeSingle()
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
