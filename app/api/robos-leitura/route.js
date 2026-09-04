// Os robôs de leitura DO ESCRITÓRIO.
//
// O painel de Robôs que já existia é do operador do sistema: lista as trinta e
// tantas rotinas da instalação, a conta de IA, a conta bancária. Nada disso é do
// escritório cliente — e a rodada que ele mostra é a do fornecedor, não a dele.
// Por isso ficava escondido, e o cliente ficava sem resposta para a única
// pergunta que importa: "o sistema está buscando as minhas publicações?".
//
// Aqui ficam só os robôs que LEEM para fora e rodam uma vez por escritório, com
// a linha do próprio escritório (robo_exec_esc) e um botão para rodar na hora.
//
//   GET  /api/robos-leitura           -> estado dos robôs deste escritório
//   POST /api/robos-leitura {nome}    -> roda um agora, só para este escritório
//
// Robô que depende de algo que o escritório ainda não cadastrou não aparece
// como "quebrado": aparece como "falta cadastrar X", com o que fazer. É a
// diferença entre um sistema que parece com defeito e um que está esperando.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BASE_LOCAL = 'http://127.0.0.1:' + (process.env.PORT || 3000)

const ROBOS = [
  {
    nome: 'djen',
    rotulo: 'Diário de Justiça — publicações',
    faz: 'Procura de duas em duas horas, nas OAB do escritório, o que saiu no Diário de Justiça de todos os tribunais, e leva a publicação para o histórico do processo.',
    url: '/api/cron/djen?dias=7',
    precisa: 'oab',
  },
  {
    nome: 'email_receber',
    rotulo: 'Caixa de e-mail — respostas das varas e dos clientes',
    faz: 'Lê a caixa do escritório de dez em dez minutos e leva cada resposta para o histórico do processo certo. O que não casa com nenhum processo fica na caixa, para classificar à mão.',
    url: '/api/email/receber',
    precisa: 'email',
  },
  {
    nome: 'jusbr_movimentos',
    rotulo: 'jus.br — movimentos do processo',
    faz: 'Com o certificado digital conectado, acompanha os movimentos em todos os graus direto no jus.br — inclusive de processo que não teve publicação no diário.',
    url: '/api/jusbr/movimentos/robo',
    precisa: 'jusbr',
  },
  {
    nome: 'minuta_triagem',
    rotulo: 'Estagiário Virtual — triagem das intimações',
    faz: 'Lê cada intimação que o diário trouxe, decide se ela exige peça, abre o prazo no Kanban e monta o dossiê dos autos para a peça ser redigida. Todo ato decisório também ganha, por segurança, o prazo de embargos.',
    url: '/api/robo/minutas?fase=triagem',
    precisa: 'estagiario',
  },
  {
    nome: 'secretaria_audiencias',
    rotulo: 'Secretária Virtual — audiências na agenda',
    faz: 'Na mesma leitura do Estagiário, reconhece a publicação que designa, redesigna ou adia audiência e coloca o compromisso na agenda, com dia, hora, modalidade e local — marcado como recado da Secretária, para você conferir. A partir daí o aviso ao cliente sai sozinho.',
    url: '/api/robo/minutas?fase=triagem',
    precisa: 'estagiario',
  },
]

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

async function quem(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return { erro: 'não autenticado', status: 401 }
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return { semEsc: true }
  return { user, esc, sb: admin() }
}

// O que falta para cada robô poder rodar. Devolve null quando está tudo pronto.
async function pendencia(sb, esc, precisa) {
  const { data: e } = await sb.from('escritorios').select('oabs,modulos,raiz').eq('id', esc).maybeSingle()
  if (precisa === 'oab') {
    const oabs = Array.isArray(e?.oabs) ? e.oabs : []
    if (!oabs.length) return 'Cadastre as inscrições na OAB do escritório (⚙ → Inscrições na OAB). É por elas que o diário é varrido.'
    return null
  }
  if (precisa === 'email') {
    if (e?.raiz === true) return null
    if ((e?.modulos || {}).email !== true) {
      return 'Cadastre a conta de e-mail do escritório (⚙ → Conta de e-mail) e passe no teste de envio. Só depois disso o sistema lê a caixa.'
    }
    return null
  }
  if (precisa === 'estagiario') {
    // A triagem consome IA, e a chave da API é de quem opera o sistema. Por isso
    // ela é liberada escritório por escritório, junto com o plano — não por
    // quem usa. Dizer isso é melhor do que um botão que não faz nada.
    if (e?.raiz === true) return null
    if ((e?.modulos || {}).estagiario !== true) {
      return 'O Estagiário Virtual e a Secretária Virtual ainda não estão liberados para este escritório — os dois saem da mesma leitura, e por isso da mesma liberação. Peça em "Solicitar funcionalidades": eles entram pelo plano.'
    }
    const oabs = Array.isArray(e?.oabs) ? e.oabs : []
    if (!oabs.length) return 'Cadastre as inscrições na OAB (⚙): a triagem só existe sobre as publicações que o robô do diário traz.'
    return null
  }
  if (precisa === 'jusbr') {
    const { data: s } = await sb.from('jusbr_sessao').select('escritorio_id').eq('escritorio_id', esc).maybeSingle()
    if (!s) return 'Conecte o certificado digital ao jus.br. Sem a sessão ativa, o sistema não entra no processo — o diário continua funcionando normalmente.'
    return null
  }
  return null
}

export async function GET(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc } = q

  const { data: execs } = await sb.from('robo_exec_esc')
    .select('nome,ultima_exec,ultimo_ok,ultimo_resultado').eq('escritorio_id', esc)
  const porNome = {}
  for (const r of (execs || [])) porNome[r.nome] = r

  const lista = []
  for (const r of ROBOS) {
    const falta = await pendencia(sb, esc, r.precisa)
    const e = porNome[r.nome] || {}
    lista.push({
      nome: r.nome, rotulo: r.rotulo, faz: r.faz,
      pendencia: falta,
      ultima_exec: e.ultima_exec || null,
      ultimo_ok: e.ultimo_ok === undefined ? null : e.ultimo_ok,
      ultimo_resultado: e.ultimo_resultado || null,
    })
  }
  return Response.json({ ok: true, robos: lista })
}

export async function POST(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc } = q

  let body = {}
  try { body = await request.json() } catch (e) {}
  const robo = ROBOS.find(r => r.nome === String(body.nome || ''))
  if (!robo) return Response.json({ erro: 'robô desconhecido' }, { status: 400 })

  const falta = await pendencia(sb, esc, robo.precisa)
  if (falta) return Response.json({ erro: falta }, { status: 400 })

  // O robô roda só para ESTE escritório: sem o `esc`, um clique do cliente
  // dispararia a varredura de todos os escritórios da instalação — inclusive a
  // do fornecedor, que ele não tem por que mandar rodar.
  const url = BASE_LOCAL + robo.url + (robo.url.includes('?') ? '&' : '?') + 'esc=' + encodeURIComponent(esc)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(280000) })
    const d = await r.json().catch(() => ({}))
    return Response.json({ ok: r.ok && d.ok !== false, resultado: d })
  } catch (e) {
    return Response.json({ erro: 'O robô não respondeu: ' + String((e && e.message) || e) }, { status: 502 })
  }
}
