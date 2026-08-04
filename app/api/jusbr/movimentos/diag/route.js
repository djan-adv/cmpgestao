// Sonda: o que o PDPJ devolve de METADADOS para um processo.
//
//   POST /api/jusbr/movimentos/diag   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero: "0826454-79.2026.8.15.0001", cru?: true }
//
// Por que existe. No 0826454-79.2026.8.15.0001 o robô gravou seis movimentos e
// deixou a ficha inteira em branco — sem vara, sem classe, sem assunto, sem data
// de distribuição. A causa é uma assimetria antiga: os MOVIMENTOS eram achados
// por varredura da árvore, então funcionam com qualquer formato; os METADADOS
// eram lidos de caminhos fixos, então somem quando o PDPJ aninha um nível
// diferente do esperado.
//
// A varredura agora vale para os dois (achaNo, em core.js). Esta rota existe
// para os casos em que ainda assim vier vazio: mostra o ESQUELETO da resposta —
// que chaves existem, em que profundidade — sem despejar o processo inteiro na
// tela. Com o esqueleto em mãos, ajustar a extração é trivial.
//
// Só leitura: não grava nada, não altera a ficha.

import { createClient } from '@supabase/supabase-js'
import { getFreshToken } from '../../lib.js'
import { buscarProcesso, extraiMeta, tramitacoesDoProcesso, movimentosDoProcesso } from '../core.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// Esqueleto: caminho de cada chave e o tipo do valor. Arrays viram "[n]" e só o
// primeiro item é percorrido — dez mil movimentos não ajudam a entender o
// formato, e o que interessa é ONDE cada coisa mora.
function esqueleto(o, prefixo = '', prof = 0, saida = [], max = 400) {
  if (saida.length >= max || prof > 6 || o == null) return saida
  if (Array.isArray(o)) {
    saida.push(`${prefixo} = [${o.length}]`)
    if (o.length) esqueleto(o[0], prefixo + '[0]', prof + 1, saida, max)
    return saida
  }
  if (typeof o !== 'object') {
    const v = String(o)
    saida.push(`${prefixo} = ${v.length > 70 ? v.slice(0, 70) + '…' : v}`)
    return saida
  }
  for (const k of Object.keys(o)) {
    if (saida.length >= max) break
    esqueleto(o[k], prefixo ? prefixo + '.' + k : k, prof + 1, saida, max)
  }
  return saida
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const numero = String(body.numero || '').replace(/\D/g, '')
  if (numero.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = admin()
  const tk = await getFreshToken(sb)
  if (tk.erro) return Response.json({ erro: 'jus.br sem sessão válida', motivo: tk.erro }, { status: 409 })

  const busca = await buscarProcesso(tk.token, numero)
  if (busca.erro) return Response.json({ erro: busca.erro, motivo: busca.motivo, detalhe: busca.detalhe }, { status: 409 })

  if (body.cru) return Response.json({ ok: true, cru: busca.procs })

  const meta = extraiMeta(busca.procs[0])
  const trilha = tramitacoesDoProcesso(busca.procs)
  const mov = movimentosDoProcesso(busca.procs)

  // Sem isto, "veio vazio" não distingue resposta sem o dado de extração errada.
  const vazios = Object.keys(meta).filter(k => !meta[k])

  return Response.json({
    ok: true,
    numero,
    tramitacoesNaResposta: busca.procs.length,
    meta,
    metaVazios: vazios,
    trilha,
    movimentos: (mov.movs || []).length,
    veredito: vazios.length === 0
      ? 'A ficha tem tudo — se a tela ainda mostra "sem vara", o problema é na gravação, não na leitura.'
      : (trilha.length === 0 && (mov.movs || []).length > 0
          ? 'O PDPJ respondeu e tem movimentos, mas nenhum órgão foi encontrado em lugar nenhum da árvore. Veja "esqueleto" e me diga onde o órgão aparece.'
          : 'Faltou: ' + vazios.join(', ') + '. Veja "esqueleto" para achar onde esses campos moram nesta resposta.'),
    esqueleto: esqueleto(busca.procs[0]),
  })
}
