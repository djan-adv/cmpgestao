// Atualizar a ficha do processo pela BASE PÚBLICA — sem certificado nenhum.
//
// O caminho completo (jus.br/PDPJ) exige o certificado digital do escritório e
// a sessão sincronizada. Um escritório que acabou de contratar não tem isso no
// primeiro dia — e, até aqui, o botão "atualizar" só sabia dizer que faltava
// token. O DataJud do CNJ é público: devolve classe, assunto, órgão julgador e
// a íntegra das movimentações, em todas as instâncias em que o processo
// tramita. É o suficiente para a ficha nascer preenchida.
//
//   POST /api/processo/publico  (Authorization: Bearer <jwt>)
//   body: { numero }
//
// Grava sempre DENTRO do escritório de quem pediu (robot_add_andamento_esc):
// número de processo se repete entre tribunais, e sem isso a movimentação de um
// escritório entraria na ficha de outro.

import { createClient } from '@supabase/supabase-js'
import { consultaDataJud } from '../route.js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return semEscritorio()

  let body = {}
  try { body = await request.json() } catch (e) {}
  const numero = String(body.numero || '')
  const dig = numero.replace(/\D/g, '')
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const dados = await consultaDataJud(numero)
  if (dados.erro) return Response.json({ erro: 'DataJud: ' + dados.erro, motivo: 'datajud' }, { status: 502 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // a ficha: classe, assunto e órgão só entram se vierem preenchidos — não se
  // apaga o que o advogado já corrigiu à mão com um campo vazio da consulta
  const patch = {}
  if (dados.classe) patch.classe = dados.classe
  if (dados.assunto) patch.assunto = dados.assunto
  if (dados.orgao) patch.orgao = dados.orgao
  const ands = Array.isArray(dados.andamentos) ? dados.andamentos : []
  if (ands[0] && ands[0].data) patch.ultima_movimentacao = String(ands[0].data).slice(0, 10)

  let ficha = false
  if (Object.keys(patch).length) {
    const { error } = await sb.from('processos').update(patch)
      .eq('escritorio_id', esc).eq('numero_digitos', dig)
    if (!error) ficha = true
  }

  let novos = 0, jaTinha = 0, semProcesso = 0, erros = 0
  for (const a of ands) {
    if (!a || !a.texto) continue
    const { data: res, error } = await sb.rpc('robot_add_andamento_esc', {
      p_esc: esc, p_num: dig,
      p_data: a.data ? String(a.data).slice(0, 10) : null,
      p_texto: String(a.texto), p_fonte: 'datajud', p_tipo: 'movimento',
    })
    if (error) { erros++; continue }
    if (res === 'inserido') novos++
    else if (res === 'existe') jaTinha++
    else semProcesso++
  }

  return Response.json({
    ok: true, fonte: 'DataJud (base pública do CNJ)',
    novos, jaTinha, semProcesso, erros,
    ficha_atualizada: ficha,
    meta: { classe: dados.classe || null, assunto: dados.assunto || null, orgao: dados.orgao || null },
    instancias: dados.instancias || null,
  })
}
