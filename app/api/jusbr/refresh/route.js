// jus.br / PDPJ — renovação automática do token via refresh_token guardado.
//   GET /api/jusbr/refresh            -> renova se estiver perto de expirar
//   GET /api/jusbr/refresh?forcar=1   -> renova já (teste)
//   GET /api/jusbr/refresh?debug=1    -> detalha o resultado
// Aberta (sem login) para poder rodar no crontab do VPS; não expõe o token.

import { jusbrAdmin, lerSessao, renovar, getFreshToken } from '../lib.js'
import { escritoriosAtivos } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 30

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  if (!process.env.JUSBR_ENC_KEY) return Response.json({ erro: 'falta JUSBR_ENC_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const forcar = searchParams.get('forcar') != null
  const debug = searchParams.get('debug') != null
  const sb = jusbrAdmin()

  // Uma sessão por escritório: o cron renova TODAS. Renovar só a da raiz deixava
  // a sessão do escritório cliente vencer sozinha de madrugada — e os robôs dele
  // amanheciam parados sem erro nenhum na tela.
  let escs = await escritoriosAtivos('jusbr')
  const soEste = searchParams.get('esc')
  if (soEste) escs = escs.filter(e => e.id === soEste)
  if (!escs.length) return Response.json({ ok: true, nada: true, motivo: 'nenhum escritório com sessão do jus.br' })

  const linhas = []
  for (const esc of escs) {
    const sess = await lerSessao(sb, esc.id)
    if (sess.erro) { linhas.push({ escritorio: esc.nome, ok: false, motivo: sess.erro }); continue }
    const temRefresh = !!sess.refresh
    const restaMin = sess.expira ? Math.round((new Date(sess.expira).getTime() - Date.now()) / 60000) : null
    if (forcar) {
      const nov = await renovar(sb, sess, esc.id)
      linhas.push({ escritorio: esc.nome, ok: !!nov.token, forcado: true, tem_refresh: temRefresh, antes_min: restaMin, expira: nov.expira || null, erro: nov.erro || null, detalhe: debug ? (nov.detalhe || null) : undefined })
      continue
    }
    // fluxo normal do cron: só renova se faltar pouco (margem 35 min)
    const res = await getFreshToken(sb, 35, esc.id)
    linhas.push({
      escritorio: esc.nome, ok: !!res.token, tem_refresh: temRefresh, antes_min: restaMin,
      renovou: !!(res.expira && restaMin != null && restaMin <= 35 && !res.erro),
      expira: res.expira || null, erro: res.erro || res.aviso || null, detalhe: debug ? (res.detalhe || null) : undefined,
    })
  }
  return Response.json({ ok: linhas.some(l => l.ok), escritorios: linhas.length, por_escritorio: linhas })
}
