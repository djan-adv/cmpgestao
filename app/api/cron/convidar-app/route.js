// Convida para o aplicativo quem AINDA NÃO TEM acesso.
//
// Não dispara sozinho: sem cada_min/diario_hora no catálogo do tick, só roda no
// botão "▶ rodar agora" do painel Robôs. Criar login e mandar senha para a base
// inteira é decisão de quem assina o escritório.
//
//   GET /api/cron/convidar-app              -> só CONTA (não cria nem envia nada)
//   GET /api/cron/convidar-app?liberar=sim  -> cria os acessos e manda o e-mail
//   GET /api/cron/convidar-app?liberar=sim&limite=15
//
// QUEM RECEBE — e por que o alvo é este:
// A varredura antiga (cron/portal-varredura) foi SUSPENSA em 15/08/2026 porque
// convidava todo contato do tipo cliente que tivesse e-mail, inclusive gente sem
// processo em andamento: e-mail saía para quem não tinha o que acompanhar. Aqui
// o alvo é estreito de propósito:
//   • contato do tipo cliente, com e-mail válido;
//   • que tem PELO MENOS UM PROCESSO ATIVO (não encerrado/arquivado/baixado);
//   • que ainda NÃO tem acesso ao aplicativo com aquele e-mail;
//   • e o e-mail não é de ninguém da equipe (senão o advogado vira "cliente").
// Cadastro que começa com "teste" fica de fora, como no robô antigo.
//
// Idempotente por dois caminhos: depois de criado, o acesso existe e a pessoa
// sai do alvo; e cada convite enviado vira linha em portal_avisos_novidade
// (campanha 'convite-app'), que é o registro de que o e-mail saiu.

import { createClient } from '@supabase/supabase-js'
import { hashSenha, gerarSenha, emailCredenciais, dadosDaCasa, membroDaEquipe } from '../../portal/lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const CAMPANHA = 'convite-app'
const LOTE_PADRAO = 40
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const RE_ENCERRADO = /encerrad|arquivad|baixad/i

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

/* nome comparável: sem acento, sem pontuação, minúsculo — o mesmo tratamento
   que a tela do escritório usa para casar cliente com contato */
export function chaveNome(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** quem entra no convite: cliente com processo ativo e sem acesso ainda */
export function alvoDoConvite({ contatos, processos, acessos }) {
  const comAcesso = new Set((acessos || []).map(a => String(a.email || '').trim().toLowerCase()))
  const ativos = (processos || []).filter(p => !RE_ENCERRADO.test(p.status || ''))
  const idsComProcesso = new Set()
  const nomesComProcesso = new Set()
  for (const p of ativos) {
    if (p.cliente_id) idsComProcesso.add(String(p.cliente_id))
    if (p.cliente_nome) nomesComProcesso.add(chaveNome(p.cliente_nome))
  }
  const porEmail = new Map()
  for (const c of (contatos || [])) {
    const email = String(c.email || '').trim().toLowerCase()
    if (!RE_EMAIL.test(email)) continue
    if (/^teste/i.test(String(c.nome || '').trim())) continue
    if (comAcesso.has(email)) continue
    const temProcesso = idsComProcesso.has(String(c.id)) || nomesComProcesso.has(chaveNome(c.nome))
    if (!temProcesso) continue
    if (!porEmail.has(email)) porEmail.set(email, c)   // um convite por e-mail
  }
  return [...porEmail.values()]
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const enviar = searchParams.get('liberar') === 'sim'
  const limite = Math.max(1, Math.min(200, parseInt(searchParams.get('limite') || String(LOTE_PADRAO), 10) || LOTE_PADRAO))
  const sb = admin()

  const { data: raiz } = await sb.from('escritorios').select('id,nome,marca').eq('raiz', true).maybeSingle()
  if (!raiz) return Response.json({ erro: 'escritório raiz não encontrado' }, { status: 500 })

  const [ct, pr, ac] = await Promise.all([
    sb.from('contatos').select('id,nome,email').eq('escritorio_id', raiz.id).eq('tipo', 'cliente'),
    sb.from('processos').select('cliente_id,cliente_nome,status').eq('escritorio_id', raiz.id),
    sb.from('portal_acessos').select('email').eq('escritorio_id', raiz.id),
  ])
  const alvo = alvoDoConvite({ contatos: ct.data, processos: pr.data, acessos: ac.data })

  if (!enviar) {
    return Response.json({
      ok: true, simulacao: true, campanha: CAMPANHA, a_convidar: alvo.length,
      aviso: 'Nada foi criado nem enviado. Para convidar de verdade, chame com ?liberar=sim.',
    })
  }

  const casa = await dadosDaCasa(sb, raiz.id)
  const lote = alvo.slice(0, limite)
  const rel = { ok: true, campanha: CAMPANHA, convidados: 0, pulados_equipe: 0, falhas: 0, detalhe: [] }

  for (const c of lote) {
    const email = String(c.email).trim().toLowerCase()
    try {
      // e-mail da equipe não vira login de cliente (a mesma regra do botão)
      if (await membroDaEquipe(sb, raiz.id, email)) { rel.pulados_equipe++; continue }

      const senha = gerarSenha()
      const ins = await sb.from('portal_acessos').insert({
        escritorio_id: raiz.id, contato_id: c.id, nome: c.nome, email,
        senha_hash: hashSenha(senha), criado_por: 'convite em lote',
        senha_enviada_em: new Date().toISOString(),
      }).select('id').single()
      if (ins.error) throw new Error(ins.error.message)

      const env = await emailCredenciais({
        nome: c.nome, email, senha, numero: '', novoProcesso: false, ...casa,
      })
      if (env && env.erro) {
        // sem e-mail, o acesso ficaria criado e a pessoa sem a senha: desfaz
        await sb.from('portal_acessos').delete().eq('id', ins.data.id)
        rel.falhas++
        rel.detalhe.push({ email, erro: String(env.erro).slice(0, 140) })
        continue
      }
      await sb.from('portal_avisos_novidade').insert({
        escritorio_id: raiz.id, acesso_id: ins.data.id, campanha: CAMPANHA, email, canal: 'email',
      })
      rel.convidados++
    } catch (e) {
      rel.falhas++
      rel.detalhe.push({ email, erro: String((e && e.message) || e).slice(0, 140) })
    }
  }

  rel.restantes = alvo.length - lote.length
  rel.resumo = rel.convidados + ' convidado(s), ' + rel.pulados_equipe + ' da equipe pulado(s), ' +
    rel.falhas + ' falha(s), ' + rel.restantes + ' restante(s)'
  return Response.json(rel)
}
