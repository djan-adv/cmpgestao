// Varredura ÚNICA "totalidade dos clientes" — pedida em 13/08/2026 para rodar
// no dia seguinte às 08:00. NÃO é um job recorrente como os de cron/tick: é
// chamada à mão (ou por um agendamento externo) até `restantes` zerar.
//
// Cobre todo cliente (contatos.tipo='cliente') com e-mail válido, UM POR
// E-MAIL — é assim que um cliente com vários processos recebe um e-mail só:
//   • nunca teve acesso ao portal → cria o login (senha nova) e manda o
//     e-mail de credenciais, o mesmo que sai pelo botão "Dar acesso ao app".
//   • tem acesso mas nunca entrou → manda um lembrete e abre/atualiza a fila
//     do robô de cobrança (cron/app-convite), que segue insistindo sozinho.
//   • já entrou pelo menos uma vez → manda só um aviso simples de atualização.
//
// Idempotente: cada e-mail só é tratado uma vez (tabela
// portal_varredura_avisos, única por escritório+e-mail) — reexecutar (ou
// rodar em vários lotes) nunca duplica envio.
//
//   GET /api/cron/portal-varredura                    → processa até 40 clientes
//   GET /api/cron/portal-varredura?limite=80           → outro tamanho de lote
//   GET /api/cron/portal-varredura?somente_contagem=1  → só conta, não envia nada

import { createClient } from '@supabase/supabase-js'
import { hashSenha, gerarSenha, emailCredenciais, dadosDaCasa } from '../../portal/lib.js'
import { enviarEmailCore } from '../../enviar-email/enviar.js'
import { registrarConvite, URL_PORTAL } from '../../portal/convite-lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

const LOTE_PADRAO = 40

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function emailValido(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()) }

function corpoLembrete({ nome, email }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || ''
  const ola = primeiro ? ('Olá, ' + primeiro + '!') : 'Olá!'
  return ola + '\n\n' +
    'Passando para lembrar que o seu acesso ao aplicativo do escritório já está liberado, mas ainda não foi usado nenhuma vez.\n\n' +
    'No aplicativo você acompanha o andamento do processo em tempo real, recebe os avisos de audiência e fala direto com o escritório — sem precisar ligar ou esperar retorno.\n\n' +
    'Endereço: ' + URL_PORTAL + '\n' +
    'Login: ' + email + '\n' +
    'Senha: a que enviamos no e-mail de acesso. Se não achar ou não funcionar, é só responder esta mensagem que enviamos outra na hora.\n\n' +
    'Atenciosamente,\nCrispim Mendonça e Pinheiro Advogados'
}
function corpoAtualizacao({ nome }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || ''
  const ola = primeiro ? ('Olá, ' + primeiro + '!') : 'Olá!'
  return ola + '\n\n' +
    'Passando para avisar que o chat do aplicativo do escritório recebeu melhorias — ficou mais rápido e estável para você falar com a gente sobre o seu processo.\n\n' +
    'Continue usando pelo mesmo endereço e login de sempre:\n' + URL_PORTAL + '\n\n' +
    'Qualquer dúvida, é só responder este e-mail.\n\nAtenciosamente,\nCrispim Mendonça e Pinheiro Advogados'
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  // SUSPENSA em 15/08/2026 a pedido do dono: o alvo era todo contato tipo
  // 'cliente' com e-mail — e-mail saiu até para gente SEM processo ativo.
  // Nenhum envio automático até revisar o alvo. `somente_contagem` continua
  // liberado (não envia nada); para reativar envio, chamar com ?liberar=sim.
  if (!searchParams.get('somente_contagem') && searchParams.get('liberar') !== 'sim') {
    return Response.json({ suspenso: true, erro: 'Varredura de convites suspensa pelo dono em 15/08/2026 — nenhum e-mail é enviado por aqui. Revise o alvo (só quem tem processo ativo) antes de reativar com ?liberar=sim.' }, { status: 410 })
  }
  const limite = Math.max(1, Math.min(200, parseInt(searchParams.get('limite') || String(LOTE_PADRAO), 10) || LOTE_PADRAO))
  const somenteContagem = !!searchParams.get('somente_contagem')
  const sb = admin()

  // clientes com e-mail válido, um por (escritório, e-mail normalizado) — é
  // isso que garante UM e-mail só por cliente, mesmo com vários processos
  const { data: contatosCliente, error: e1 } = await sb.from('contatos')
    .select('id,nome,email,escritorio_id').eq('tipo', 'cliente')
  if (e1) return Response.json({ erro: e1.message }, { status: 500 })

  const porEmail = new Map()
  for (const c of (contatosCliente || [])) {
    const mail = String(c.email || '').trim().toLowerCase()
    if (!mail || !emailValido(mail)) continue
    if (/^teste/i.test(String(c.nome || '').trim())) continue   // blindagem extra: nunca convida cadastro de teste
    const chave = String(c.escritorio_id) + '|' + mail
    if (!porEmail.has(chave)) porEmail.set(chave, c)   // primeiro contato encontrado com este e-mail
  }

  // já processados nesta varredura (idempotência entre lotes/reexecuções)
  const { data: jaFeitos } = await sb.from('portal_varredura_avisos').select('escritorio_id,email')
  const feitos = new Set((jaFeitos || []).map(x => String(x.escritorio_id) + '|' + String(x.email).toLowerCase()))

  const pendentes = [...porEmail.entries()].filter(([chave]) => !feitos.has(chave))
  const total_alvo = porEmail.size
  const total_pendente = pendentes.length

  if (somenteContagem) {
    return Response.json({ ok: true, total_alvo, total_pendente, ja_processados: total_alvo - total_pendente })
  }

  const lote = pendentes.slice(0, limite)
  const rel = { ok: true, processados: 0, convidados: 0, lembrados: 0, atualizados: 0, falhas: 0, detalhe: [] }

  for (const [chave, c] of lote) {
    const mail = chave.split('|')[1]
    try {
      const { data: acesso } = await sb.from('portal_acessos')
        .select('id,nome,contato_id,primeiro_login_em,ativo,bloqueado_em')
        .eq('escritorio_id', c.escritorio_id).eq('email', mail).maybeSingle()

      let tipo, env
      if (acesso && acesso.primeiro_login_em) {
        // já conectado: só o aviso simples
        tipo = 'atualizacao'
        env = await enviarEmailCore({
          para: mail, assunto: 'O chat do aplicativo foi atualizado — CMP Advogados',
          corpo: corpoAtualizacao({ nome: acesso.nome || c.nome }), numero: '', dedup: false, convidarApp: false,
        })
      } else if (acesso) {
        // tem acesso, nunca entrou: lembrete + entra na fila do robô de cobrança
        tipo = 'lembrete'
        env = await enviarEmailCore({
          para: mail, assunto: 'Seu acesso ao aplicativo do escritório está esperando por você',
          corpo: corpoLembrete({ nome: acesso.nome || c.nome, email: mail }), numero: '', dedup: false, convidarApp: false,
        })
        if (!env.erro) {
          await registrarConvite(sb, {
            situacao: 'parado', falta_telefone: false, nome: acesso.nome || c.nome,
            contato_id: acesso.contato_id || c.id, processo_id: null, escritorio_id: c.escritorio_id, numero: '',
          }, mail)
        }
      } else {
        // nunca teve acesso: cria o login e manda as credenciais (mesmo e-mail
        // que sai pelo botão "Dar acesso ao app")
        tipo = 'convite'
        const senha = gerarSenha()
        const ins = await sb.from('portal_acessos').insert({
          escritorio_id: c.escritorio_id, contato_id: c.id, nome: c.nome, email: mail,
          senha_hash: hashSenha(senha), criado_por: 'varredura 14/08/2026',
          senha_enviada_em: new Date().toISOString(),
        }).select('id').single()
        if (ins.error) throw new Error(ins.error.message)
        env = await emailCredenciais({ nome: c.nome, email: mail, senha, numero: '', novoProcesso: false, ...(await dadosDaCasa(sb, c.escritorio_id)) })
        if (!env.erro) {
          await registrarConvite(sb, {
            situacao: 'sem', falta_telefone: false, nome: c.nome,
            contato_id: c.id, processo_id: null, escritorio_id: c.escritorio_id, numero: '',
          }, mail)
        }
      }

      if (env && env.erro) { rel.falhas++; rel.detalhe.push({ email: mail, erro: String(env.erro).slice(0, 160) }); continue }

      await sb.from('portal_varredura_avisos').insert({ escritorio_id: c.escritorio_id, email: mail, tipo, contato_id: c.id })
      rel.processados++
      if (tipo === 'convite') rel.convidados++
      else if (tipo === 'lembrete') rel.lembrados++
      else rel.atualizados++
    } catch (e) {
      rel.falhas++
      rel.detalhe.push({ email: mail, erro: String((e && e.message) || e).slice(0, 160) })
    }
  }

  rel.total_alvo = total_alvo
  rel.restantes = total_pendente - lote.length
  return Response.json(rel)
}
