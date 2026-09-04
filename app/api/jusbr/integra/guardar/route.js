// Íntegra dos autos SOB PEDIDO, guardada na pasta do processo.
//   POST /api/jusbr/integra/guardar  { numero, quem }
//   (Authorization: Bearer <jwt do Supabase>)
//
// Nasceu de uma observação do dono (31/08/2026): "o melhor momento para pedir a
// íntegra é quando pedimos à IA o resumo na tarefa". Faz sentido — é o instante
// em que alguém vai de fato ler os autos. Até aqui a íntegra só existia dentro
// do robô das minutas, presa a uma linha de robo_minutas; a tarefa comum não
// tinha como pedir.
//
// O PDF sai em ordem CRESCENTE: começa na petição inicial e termina na peça mais
// recente — ler os autos é ler a história na ordem em que aconteceu. O nome tem
// prefixo "000 - " para ficar em primeiro na pasta, e a íntegra anterior é
// substituída (é o que segura o disco).

import fs from 'fs'
import { escritorioDoUsuario, raizDocs, pastaProcesso } from '../../../_lib/inquilino.js'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { coletarPecas, ordenarPecas, pdfUnico, salvarNaPasta, INTEGRA_PREFIXO } from '../core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

// A íntegra é baixada com a sessão do jus.br do escritório de quem pediu e
// guardada na pasta do processo.
const VALIDADE_DIAS = 7   // íntegra recém-baixada não é baixada de novo

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'servidor sem service key' }, { status: 500 })

  let b = {}
  try { b = await request.json() } catch (e) { return Response.json({ erro: 'corpo inválido' }, { status: 400 }) }
  const dig = String(b.numero || '').replace(/\D/g, '')
  const quem = String(b.quem || '').slice(0, 80)
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return Response.json({ erro: 'usuário sem escritório vinculado' }, { status: 403 })
  const sb = admin()
  const pasta = pastaProcesso(esc, dig)

  // já tem uma íntegra recente? devolve ela — baixar de novo custa minutos e disco
  try {
    for (const nome of fs.readdirSync(pasta).filter(n => n.startsWith(INTEGRA_PREFIXO))) {
      const st = fs.statSync(path.join(pasta, nome))
      if (Date.now() - st.mtimeMs < VALIDADE_DIAS * 86400000) {
        return Response.json({ ok: true, ja_existia: true, arquivo: nome, bytes: st.size, dias: Math.floor((Date.now() - st.mtimeMs) / 86400000) })
      }
    }
  } catch (e) { /* pasta ainda não existe — segue e baixa */ }

  const col = await coletarPecas(sb, dig, { esc })
  if (col.erro) {
    const semSessao = col.motivo === 'expirado' || col.motivo === 'sem_token'
    return Response.json({ erro: col.erro, motivo: col.motivo || null, sem_sessao: semSessao }, { status: semSessao ? 409 : 502 })
  }
  if (!col.files || !col.files.length) return Response.json({ erro: 'o jus.br não devolveu nenhuma peça deste processo' }, { status: 404 })

  ordenarPecas(col.files, { ordem: 'asc' })   // da inicial para a mais recente
  let r
  try { r = await pdfUnico(col.files) } catch (e) { r = { erro: String((e && e.message) || e) } }
  if (r.erro) return Response.json({ erro: r.erro }, { status: 502 })

  const nome = salvarNaPasta(fs, path, raizDocs(esc), dig, r.bytes, true)
  if (!nome) return Response.json({ erro: 'não consegui gravar o arquivo na pasta do processo' }, { status: 500 })

  // registra no histórico com o marcador de sempre: a linha conta a história,
  // mas NÃO conta como movimentação do processo (ver _andamentoNaoOficial)
  try {
    const { data: proc } = await sb.from('processos').select('id').eq('escritorio_id', esc).eq('numero_digitos', dig).maybeSingle()
    if (proc && proc.id) {
      await sb.from('andamentos').insert({
        processo_id: proc.id, data: new Date().toISOString().slice(0, 10), fonte: 'minuta',
        texto: '[ESTAGIÁRIO VIRTUAL] Íntegra dos autos guardada em "' + nome + '" a pedido' + (quem ? (' de ' + quem) : '') + ', ' +
          r.juntados + ' de ' + r.total + ' peça(s) da mais antiga para a mais recente' +
          (r.falhos ? (', ' + r.falhos + ' não converteram') : '') + '. ' +
          (col.pulados ? ('Íntegra parcial: ' + col.pulados + ' peça(s) ficaram de fora por tamanho/formato. ') : '') +
          'Substitui a íntegra anterior.',
      })
    }
  } catch (e) {}

  return Response.json({
    ok: true, arquivo: nome, bytes: r.bytes.length,
    pecas: r.juntados, total: r.total, falhos: r.falhos || 0, parcial: col.pulados || 0,
  })
}
