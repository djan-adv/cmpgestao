// Endereço PÚBLICO do userscript — serve para a ATUALIZAÇÃO AUTOMÁTICA do
// Tampermonkey (@updateURL/@downloadURL), que busca o arquivo sem sessão.
// Protegido por uma chave de distribuição imprevisível na URL: quem não tem o
// link não chega no arquivo. A chave é gerada e guardada sozinha.
//   GET /api/jusbr/userscript/pub?k=<chave>

import crypto from 'crypto'
import { ESCRITORIO_RAIZ } from '../../../_lib/inquilino.js'
import { createClient } from '@supabase/supabase-js'
import { montarScript, basePublica } from '../gerar.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 15

// A chave da URL é a identidade: cada escritório tem a sua, e é por ela que
// esta rota sabe qual userscript montar. Sem isso, o Tampermonkey de qualquer
// escritório se atualizaria com o script — e o segredo — da casa.
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

// chave de distribuição (cria na primeira vez)
export async function garantirChaveDist(sb, esc) {
  const alvo = esc || ESCRITORIO_RAIZ
  const { data } = await sb.from('produtividade_config').select('valor').eq('escritorio_id', alvo).eq('chave', 'userscript_dist_key').maybeSingle()
  if (data && data.valor) return data.valor
  const k = 'dk_' + crypto.randomBytes(20).toString('hex')
  await sb.from('produtividade_config').upsert({ escritorio_id: alvo, chave: 'userscript_dist_key', valor: k }, { onConflict: 'escritorio_id,chave' })
  return k
}

// De quem é a chave que veio na URL. Nada de comparar com a chave de um
// escritório fixo: quem procura é o valor, e ele diz o dono.
async function escritorioDaChave(sb, k) {
  if (!k) return null
  const { data } = await sb.from('produtividade_config').select('escritorio_id')
    .eq('chave', 'userscript_dist_key').eq('valor', k).maybeSingle()
  return (data && data.escritorio_id) || null
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response('servidor sem service key', { status: 500 })
  const k = new URL(request.url).searchParams.get('k') || ''
  const sb = admin()
  const esc = await escritorioDaChave(sb, k)
  if (!esc) return new Response('// chave inválida', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  const texto = await montarScript(sb, request, esc)
  return new Response(texto, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
