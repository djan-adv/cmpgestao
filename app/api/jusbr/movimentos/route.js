// jus.br / PDPJ — importar a LINHA DE MOVIMENTOS do processo (todos os graus) e
// preencher os dados da ficha (classe, assunto, vara, distribuição).
//   POST /api/jusbr/movimentos   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero: "0812803-38.2019.8.15.2001", debug?: true }
// O DJEN só traz publicações; movimentos internos ("Conclusos para despacho",
// "Juntada de Petição") só existem na consulta do PDPJ.
//
// Esta rota é o caminho do CLIQUE (botão "↻ atualizar" da ficha). A varredura
// automática de todos os processos ativos é o robô em ./robo — os dois usam o
// mesmo ./core.js para não divergirem.

import { createClient } from '@supabase/supabase-js'
import { getFreshToken } from '../lib.js'
import { buscarProcesso, movimentosDoProcesso, aplicarMeta, gravarMovimentos } from './core.js'
import { escritorioDoUsuario, semEscritorio } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const numero = String(body.numero || '').replace(/\D/g, '')
  if (numero.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = admin()
  // a sessão do jus.br é a DO ESCRITÓRIO de quem pediu, não a da casa
  const esc = await escritorioDoUsuario(user.id, sb)
  if (!esc) return semEscritorio()
  // usa a sessão com renovação automática (refresh_token) — ver ../lib.js
  const tk = await getFreshToken(sb, null, esc)
  if (tk.erro === 'sem_chave') return Response.json({ erro: 'servidor sem JUSBR_ENC_KEY (chave de cifragem)' }, { status: 500 })
  if (tk.erro) return Response.json({ erro: 'jus.br: ' + (tk.erro === 'expirado' ? 'token expirado — sincronize novamente' : 'sem token — sincronize a sessão do jus.br'), motivo: tk.erro }, { status: 409 })

  const busca = await buscarProcesso(tk.token, numero)
  if (busca.erro) {
    const st = (busca.motivo === 'rede' || busca.motivo === 'http') ? 502 : 409
    return Response.json({ erro: busca.erro, motivo: busca.motivo, detalhe: busca.detalhe }, { status: st })
  }
  const proc = busca.proc

  const { movs, arrays, lista, chaves, chavesVistas } = movimentosDoProcesso(busca.procs)

  // atualiza os dados da ficha (classe/assunto/vara/distribuição) — faz o selo virar "vinculado"
  const { meta, trilha, origem, atual, atualizada } = await aplicarMeta(sb, numero, busca.procs)

  const g = await gravarMovimentos(sb, numero, movs, 'jusbr', esc)

  // carimba a rodada para o robô não repetir este processo tão cedo
  try { await sb.from('processos').update({ jusbr_mov_em: new Date().toISOString() }).eq('numero_digitos', numero) } catch (e) {}

  const out = {
    ok: true, numero, movimentos: movs.length,
    novos: g.inseridos, jaTinha: g.jaTinha, semProcesso: g.semProcesso, erros: g.erros,
    ficha_atualizada: atualizada, meta,
    tramitacoes: trilha, origem, local_atual: atual,
  }
  if (body.debug) {
    out.diag = {
      topKeys: proc && typeof proc === 'object' ? Object.keys(proc).slice(0, 40) : [],
      tramitacaoAtualKeys: proc && proc.tramitacaoAtual ? Object.keys(proc.tramitacaoAtual).slice(0, 40) : [],
      arraysEncontrados: arrays.map(a => a.length),
      chavesUsadas: chaves,
      chavesVistas,
      amostraMov: lista.slice(0, 2),
    }
  }
  return Response.json(out)
}
