// O cadastro do próprio escritório, editado por quem contratou.
//
// É a peça que faltava para o sistema deixar de ser "de um escritório só": o
// nome que aparece na tela, e principalmente os dados que entram na PROCURAÇÃO
// e no CONTRATO que o cliente dele assina — nome do advogado, OAB, sociedade,
// CNPJ, endereço. Enquanto isso estava escrito no código, o cliente de um
// escritório assinava procuração nomeando o advogado de outro.
//
//   GET  /api/meu-escritorio   -> devolve o cadastro (qualquer pessoa do escritório)
//   POST /api/meu-escritorio   -> grava (só contratante ou sócio)
//
// O que NÃO se edita aqui, de propósito: plano, limites, endereço de acesso e
// módulos. Isso é contrato — muda no painel de quem vende, não no do cliente.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// Campos aceitos. Lista fechada: sem isso, qualquer chave enviada pelo
// navegador entraria no cadastro e apareceria nos documentos.
const CAMPOS = [
  'socio_nome', 'socio_oab', 'socio_nacionalidade', 'socio_estado_civil', 'socio_cpf',
  'nome_sociedade', 'oab_sociedade', 'cnpj',
  'endereco', 'cidade', 'uf', 'cep',
  'telefone', 'whatsapp', 'email', 'site',
]

export async function GET(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return semEscritorio()

  const sb = admin()
  const { data } = await sb.from('escritorios')
    .select('id,nome,raiz,marca,dados,plano_codigo,limite_acessos,limite_processos,limite_gb,mensalidade')
    .eq('id', esc).maybeSingle()
  if (!data) return Response.json({ erro: 'escritório não encontrado' }, { status: 404 })

  const { data: perfil } = await sb.from('usuarios').select('papel').eq('id', user.id).maybeSingle()
  const podeEditar = ['contratante', 'socio'].includes(String(perfil?.papel || ''))

  const { count: usoProc } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)
  const { count: usoAcc } = await sb.from('usuarios').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)

  return Response.json({
    ok: true,
    pode_editar: podeEditar,
    escritorio: {
      id: data.id, nome: data.nome, raiz: data.raiz,
      marca: data.marca || {}, dados: data.dados || {},
    },
    plano: {
      codigo: data.plano_codigo, mensalidade: data.mensalidade,
      limite_acessos: data.limite_acessos, limite_processos: data.limite_processos, limite_gb: data.limite_gb,
      uso_processos: usoProc || 0, uso_acessos: usoAcc || 0,
    },
  })
}

export async function POST(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return semEscritorio()

  const sb = admin()
  const { data: perfil } = await sb.from('usuarios').select('papel').eq('id', user.id).maybeSingle()
  if (!['contratante', 'socio'].includes(String(perfil?.papel || ''))) {
    return Response.json({ erro: 'Só o contratante ou um sócio altera o cadastro do escritório.' }, { status: 403 })
  }

  let body = {}
  try { body = await request.json() } catch (e) {}

  const patch = {}
  if (typeof body.nome === 'string' && body.nome.trim()) patch.nome = body.nome.trim().slice(0, 160)

  if (body.marca && typeof body.marca === 'object') {
    const { data: atual } = await sb.from('escritorios').select('marca').eq('id', esc).maybeSingle()
    patch.marca = {
      ...(atual?.marca || {}),
      sistema: String(body.marca.sistema || '').slice(0, 60) || null,
      cor: String(body.marca.cor || '').slice(0, 20) || null,
      logo: String(body.marca.logo || '').slice(0, 500) || null,
    }
  }

  if (body.dados && typeof body.dados === 'object') {
    const { data: atual } = await sb.from('escritorios').select('dados').eq('id', esc).maybeSingle()
    const dados = { ...(atual?.dados || {}) }
    for (const c of CAMPOS) {
      if (c in body.dados) dados[c] = String(body.dados[c] == null ? '' : body.dados[c]).slice(0, 300)
    }
    patch.dados = dados
  }

  if (!Object.keys(patch).length) return Response.json({ erro: 'nada a salvar' }, { status: 400 })

  const { error } = await sb.from('escritorios').update(patch).eq('id', esc)
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
