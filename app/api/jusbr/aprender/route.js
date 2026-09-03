// "Modo aprendizado" do peticionamento do jus.br/PDPJ.
// O userscript observa o que o PRÓPRIO portal envia quando o advogado protocola
// e manda para cá apenas a FORMA da requisição (URL, nomes de cabeçalhos e o
// esqueleto do JSON — sem o conteúdo dos arquivos e sem o token). Com isso
// implementamos o protocolo pela API com fidelidade, sem gastar um protocolo
// de teste às cegas.
//   POST /api/jusbr/aprender   (header x-jusbr-relay: <segredo>)

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 20

import { ESCRITORIO_PADRAO as ESCRITORIO_CMP } from '../../../../lib/escritorio.js'
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
    let ok = (process.env.JUSBR_RELAY_SECRET || '') === relay
    if (!ok && relay) {
      const { data } = await sb.from('produtividade_config').select('valor').eq('escritorio_id', ESCRITORIO_CMP).eq('chave', 'jusbr_relay_secret').maybeSingle()
      ok = !!(data && data.valor && data.valor === relay)
    }
    if (!ok) return j({ erro: 'segredo inválido' }, 401)

    let b = {}
    try { b = await request.json() } catch (e) { return j({ erro: 'json inválido' }, 400) }
    const { error } = await sb.from('pdpj_capturas').insert({
      escritorio_id: ESCRITORIO_CMP,
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

// GET: lista o que já foi aprendido (para o painel/diagnóstico)
export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'sem service key' }, { status: 500 })
  const sb = admin()
  const { data } = await sb.from('pdpj_capturas').select('*').eq('escritorio_id', ESCRITORIO_CMP).order('criado_em', { ascending: false }).limit(20)
  return Response.json({ ok: true, total: (data || []).length, capturas: data || [] })
}
