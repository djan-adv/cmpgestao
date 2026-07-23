// jus.br / PDPJ — renovação automática do token via refresh_token guardado.
//   GET /api/jusbr/refresh            -> renova se estiver perto de expirar
//   GET /api/jusbr/refresh?forcar=1   -> renova já (teste)
//   GET /api/jusbr/refresh?debug=1    -> detalha o resultado
// Aberta (sem login) para poder rodar no crontab do VPS; não expõe o token.

import { jusbrAdmin, lerSessao, renovar, getFreshToken } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  if (!process.env.JUSBR_ENC_KEY) return Response.json({ erro: 'falta JUSBR_ENC_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const forcar = searchParams.get('forcar') != null
  const debug = searchParams.get('debug') != null
  const sb = jusbrAdmin()

  const sess = await lerSessao(sb)
  if (sess.erro) return Response.json({ ok: false, motivo: sess.erro })
  const temRefresh = !!sess.refresh
  const restaMin = sess.expira ? Math.round((new Date(sess.expira).getTime() - Date.now()) / 60000) : null

  if (forcar) {
    const nov = await renovar(sb, sess)
    return Response.json({ ok: !!nov.token, forcado: true, tem_refresh: temRefresh, antes_min: restaMin, expira: nov.expira || null, erro: nov.erro || null, detalhe: debug ? (nov.detalhe || null) : undefined })
  }
  // fluxo normal do cron: só renova se faltar pouco (margem 35 min)
  const res = await getFreshToken(sb, 35)
  return Response.json({
    ok: !!res.token, tem_refresh: temRefresh, antes_min: restaMin,
    renovou: !!(res.expira && restaMin != null && restaMin <= 35 && !res.erro),
    expira: res.expira || null, erro: res.erro || res.aviso || null, detalhe: debug ? (res.detalhe || null) : undefined,
  })
}
