// Atualização imediata do histórico de UM processo — consulta o DJEN (Comunica/CNJ)
// pelo número e insere só os andamentos novos. Leve: não sincroniza tudo.
//   POST /api/djen/processo   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero: "0802587-41.2021.8.15.2003", dias?: 90 }
// Grava via robot_add_andamento (SECURITY DEFINER) — mesma função do robô diário.

import { createClient } from '@supabase/supabase-js'
import { escritorioDoUsuario, semEscritorio } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

async function consultaDjenNumero(numeroDigits, dias) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  let itens = [], pagina = 1
  while (pagina <= 5) {
    const url = `${DJEN}?numeroProcesso=${numeroDigits}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D&pagina=${pagina}&itensPorPagina=100`
    let r
    try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }) } catch (e) { break }
    if (!r.ok) break
    const d = await r.json().catch(() => null)
    const lote = (d && (d.items || d.content || d.comunicacoes)) || []
    if (!lote.length) break
    itens = itens.concat(lote)
    if (lote.length < 100) break
    pagina++
  }
  return itens
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const dig = String(body.numero || '').replace(/\D/g, '')
  const dias = Math.min(Math.max(parseInt(body.dias || '90', 10) || 90, 7), 365)
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Grava pela chave de serviço: a função de gravar andamento deixou de ser
  // chamável com a chave pública, que ia no navegador de qualquer visitante.
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svcKey) return Response.json({ erro: 'faltam variáveis do Supabase (URL/chave de serviço)' }, { status: 500 })
  const sb = createClient(url, svcKey, { auth: { persistSession: false } })
  // e dentro do escritório de quem pediu — o número do processo vem do
  // navegador e se repete entre tribunais
  const esc = await escritorioDoUsuario(user.id, sb)
  if (!esc) return semEscritorio()

  const pubs = await consultaDjenNumero(dig, dias)
  let inseridos = 0, jaTinha = 0, erros = 0
  for (const p of pubs) {
    const texto = String(p.texto || p.teor || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10) || null
    if (!texto) continue
    const { data: res, error } = await sb.rpc('robot_add_andamento_esc', {
      p_esc: esc, p_num: dig, p_data: data, p_texto: texto, p_fonte: 'djen', p_tipo: 'publicacao',
    })
    if (error) { erros++; continue }
    if (res === 'inserido') inseridos++
    else if (res === 'existe') jaTinha++
  }
  return Response.json({ ok: true, publicacoes: pubs.length, novos: inseridos, jaTinha, erros, dias })
}
