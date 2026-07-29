// Índices oficiais de correção monetária — direto da API pública do Banco
// Central (SGS). Usado pelo botão "atualizar" do quadro de Honorários.
//
//   GET /api/indices?indice=inpc&de=2024-07   (até = mês atual, ou &ate=YYYY-MM)
//   → { fator, meses_indice, meses_juros, ultimo_mes, parcial }
//
// O fator compõe as variações mensais DEPOIS do mês-base até o mês-alvo
// (base 07/2024 → alvo 07/2026 = 24 variações). Se o índice do mês mais
// recente ainda não foi publicado, devolve o fator até o último disponível e
// marca `parcial` — o painel avisa em vez de fingir precisão.
//
// Cache em memória por 12h: o índice do mês não muda a cada requisição.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 30

// códigos das séries mensais no SGS/Bacen
const SERIES = { inpc: 188, ipca: 433, igpm: 189 }

const cache = {}   // chave → { em, dados }
const TTL = 12 * 3600 * 1000

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  if (!(await usuario(request))) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const indice = String(searchParams.get('indice') || 'inpc').toLowerCase()
  const serie = SERIES[indice]
  if (!serie) return Response.json({ erro: 'índice desconhecido — use inpc, ipca ou igpm' }, { status: 400 })

  const de = String(searchParams.get('de') || '')            // YYYY-MM (mês-base)
  const hoje = new Date()
  const ateDef = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0')
  const ate = String(searchParams.get('ate') || ateDef)
  if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate)) return Response.json({ erro: 'datas no formato YYYY-MM' }, { status: 400 })
  const [deY, deM] = de.split('-').map(Number), [atY, atM] = ate.split('-').map(Number)
  const mesesJuros = (atY - deY) * 12 + (atM - deM)
  if (mesesJuros < 0) return Response.json({ erro: 'mês-base depois do mês-alvo' }, { status: 400 })
  if (mesesJuros > 480) return Response.json({ erro: 'período longo demais (máx. 40 anos)' }, { status: 400 })

  const chave = indice + '|' + de + '|' + ate
  let dados = (cache[chave] && (Date.now() - cache[chave].em) < TTL) ? cache[chave].dados : null
  if (!dados) {
    // busca do 1º dia do mês seguinte ao base até o fim do mês-alvo
    const ini = new Date(deY, deM, 1)          // mês seguinte ao base
    const fim = new Date(atY, atM, 0)          // último dia do mês-alvo
    const dd = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear()
    const url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + serie + '/dados?formato=json&dataInicial=' + dd(ini) + '&dataFinal=' + dd(fim)
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (!r.ok) return Response.json({ erro: 'Banco Central respondeu HTTP ' + r.status + ' — tente de novo em instantes' }, { status: 502 })
      dados = await r.json()
      if (!Array.isArray(dados)) throw new Error('resposta inesperada')
      cache[chave] = { em: Date.now(), dados }
    } catch (e) {
      return Response.json({ erro: 'não foi possível consultar o Banco Central: ' + String((e && e.message) || e) }, { status: 502 })
    }
  }

  let fator = 1, mesesIndice = 0, ultimo = de
  for (const it of dados) {
    const v = parseFloat(String(it.valor || '').replace(',', '.'))
    if (isNaN(v)) continue
    fator *= (1 + v / 100)
    mesesIndice++
    const m = String(it.data || '').split('/')   // dd/MM/yyyy
    if (m.length === 3) ultimo = m[2] + '-' + m[1]
  }

  return Response.json({
    ok: true, indice, de, ate,
    fator: Number(fator.toFixed(8)),
    meses_indice: mesesIndice, meses_juros: mesesJuros,
    ultimo_mes: ultimo, parcial: mesesIndice < mesesJuros,
  })
}
