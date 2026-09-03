// Endereço PÚBLICO do userscript — serve para a ATUALIZAÇÃO AUTOMÁTICA do
// Tampermonkey (@updateURL/@downloadURL), que busca o arquivo sem sessão.
// Protegido por uma chave de distribuição imprevisível na URL: quem não tem o
// link não chega no arquivo. A chave é gerada e guardada sozinha.
//   GET /api/jusbr/userscript/pub?k=<chave>

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { montarScript, basePublica } from '../gerar.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 15

import { ESCRITORIO_PADRAO as ESCRITORIO_CMP } from '../../../../../lib/escritorio.js'
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

// chave de distribuição (cria na primeira vez)
export async function garantirChaveDist(sb) {
  const { data } = await sb.from('produtividade_config').select('valor').eq('escritorio_id', ESCRITORIO_CMP).eq('chave', 'userscript_dist_key').maybeSingle()
  if (data && data.valor) return data.valor
  const k = 'dk_' + crypto.randomBytes(20).toString('hex')
  await sb.from('produtividade_config').upsert({ escritorio_id: ESCRITORIO_CMP, chave: 'userscript_dist_key', valor: k }, { onConflict: 'escritorio_id,chave' })
  return k
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response('servidor sem service key', { status: 500 })
  const k = new URL(request.url).searchParams.get('k') || ''
  const sb = admin()
  const esperado = await garantirChaveDist(sb)
  if (!k || k !== esperado) return new Response('// chave inválida', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  const texto = await montarScript(sb, request)
  return new Response(texto, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
