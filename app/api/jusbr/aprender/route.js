// "Modo aprendizado" do peticionamento do jus.br/PDPJ.
// O userscript observa o que o PRÓPRIO portal envia quando o advogado protocola
// e manda para cá apenas a FORMA da requisição (URL, nomes de cabeçalhos e o
// esqueleto do JSON — sem o conteúdo dos arquivos e sem o token). Com isso
// implementamos o protocolo pela API com fidelidade, sem gastar um protocolo
// de teste às cegas.
//   POST /api/jusbr/aprender   (header x-jusbr-relay: <segredo>)

import { createClient } from '@supabase/supabase-js'
import { ESCRITORIO_RAIZ, usuarioDoRequest, escritorioDoUsuario } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 20

// A captura é a FORMA da requisição, não dado de cliente — mas ela chega pela
// mesma chave de pareamento do token, e cada escritório tem a sua. Guardar tudo
// na linha da raiz misturaria a base técnica de escritórios diferentes e, pior,
// obrigaria a rota a conhecer um segredo só. Aqui também o segredo é a identidade.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-jusbr-relay',
  'Access-Control-Max-Age': '86400',
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }
function j(b, s) { return Response.json(b, { status: s || 200, headers: CORS }) }
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

export async function POST(request) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return j({ erro: 'sem service key' }, 500)
    const sb = admin()
    const relay = request.headers.get('x-jusbr-relay') || ''
    let esc = null
    if (relay) {
      const { data } = await sb.from('produtividade_config').select('escritorio_id')
        .eq('chave', 'jusbr_relay_secret').eq('valor', relay).maybeSingle()
      if (data && data.escritorio_id) esc = data.escritorio_id
      else if ((process.env.JUSBR_RELAY_SECRET || '') === relay) esc = ESCRITORIO_RAIZ
    }
    if (!esc) return j({ erro: 'segredo inválido' }, 401)

    let b = {}
    try { b = await request.json() } catch (e) { return j({ erro: 'json inválido' }, 400) }
    const { error } = await sb.from('pdpj_capturas').insert({
      escritorio_id: esc,
      metodo: String(b.metodo || '').slice(0, 10),
      url: String(b.url || '').slice(0, 500),
      cabecalhos: b.cabecalhos || null,
      corpo_forma: b.corpo_forma || null,
      resposta_status: b.resposta_status || null,
      resposta_forma: b.resposta_forma || null,
    })
    if (error) return j({ erro: error.message }, 500)
    return j({ ok: true })
  } catch (e) { return j({ erro: String((e && e.message) || e) }, 500) }
}

// GET: lista o que já foi aprendido (para o painel/diagnóstico), só do próprio
// escritório e só para quem está logado — a captura traz endereços e cabeçalhos
// do peticionamento de quem protocolou.
export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'sem service key' }, { status: 500 })
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return Response.json({ erro: 'usuário sem escritório vinculado' }, { status: 403 })
  const sb = admin()
  const { data } = await sb.from('pdpj_capturas').select('*').eq('escritorio_id', esc).order('criado_em', { ascending: false }).limit(20)
  return Response.json({ ok: true, total: (data || []).length, capturas: data || [] })
}
