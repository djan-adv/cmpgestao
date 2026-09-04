// Convite do cliente para o app (portal) — usado em dois lugares:
//   • enviar-email/enviar.js  → todo e-mail que vai para CLIENTE já leva o convite
//   • cron/app-convite        → cobra de novo a cada 2 dias ÚTEIS quem não entrou
//
// Regra que o escritório pediu: antes de mandar qualquer e-mail ao cliente,
// conferir se aquela pessoa já usa o app. Se não usa, o próprio e-mail convida.
// E se faltar telefone na ficha, o mesmo e-mail pede o número — a resposta do
// cliente é lida pelo robô da caixa (email/receber) e cai na ficha sozinha.
//
// O que NÃO se faz aqui, de propósito: criar acesso sozinho. Conceder acesso é
// ato do escritório (portal/admin, ação 'conceder'), que tem trava de nome para
// não deixar um e-mail digitado errado enxergar processo de outro cliente.
// Convite é convite; a senha continua saindo pela mão de quem confere.

import { createClient } from '@supabase/supabase-js'

export const URL_PORTAL = (process.env.PUBLIC_URL || 'https://gestao.cmpadvogados.com.br').replace(/\/+$/, '') + '/portal.html'

// O endereço do aplicativo DO ESCRITÓRIO.
//
// URL_PORTAL acima é o endereço da instalação — o do dono do sistema. Mandar
// esse link para o cliente de um escritório vendido é pior do que um link
// quebrado: ele chega numa porta com a marca de outro escritório de advocacia, e
// o login dele nem funciona lá. Cada escritório tem o próprio host cadastrado;
// é dele que sai o convite. Sem host cadastrado, cai no endereço da instalação,
// que é onde ele realmente entra hoje.
export async function urlPortalDoEscritorio(sb, escritorioId) {
  try {
    const { data } = await sb.from('escritorios').select('hosts').eq('id', escritorioId).maybeSingle()
    const host = (data && Array.isArray(data.hosts) && data.hosts.find(h => h && !/^localhost/i.test(h))) || ''
    if (host) return 'https://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/portal.html'
  } catch (e) {}
  return URL_PORTAL
}

// O endereço público DO ESCRITÓRIO (sem /portal.html): é a base dos links que
// saem nos e-mails dele — confirmação de leitura, pixel de abertura, convite.
// Com a base fixa da instalação, o cliente de um escritório recebia link
// apontando para o domínio de outro.
export async function baseDoEscritorio(sb, escritorioId) {
  try {
    if (sb && escritorioId) {
      const { data } = await sb.from('escritorios').select('hosts').eq('id', escritorioId).maybeSingle()
      const host = (data && Array.isArray(data.hosts) && data.hosts.find(h => h && !/^localhost/i.test(h))) || ''
      if (host) return 'https://' + host.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    }
  } catch (e) {}
  return (process.env.PUBLIC_URL || '').replace(/\/+$/, '') || URL_PORTAL.replace(/\/portal\.html$/, '')
}

// Nome do escritório que assina o que vai para o cliente dele.
export async function nomeDoEscritorio(sb, escritorioId) {
  try {
    const { data } = await sb.from('escritorios').select('nome').eq('id', escritorioId).maybeSingle()
    if (data && data.nome) return data.nome
  } catch (e) {}
  return 'Seu escritório'
}

export function svcOpcional() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!k) return null
  try { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, k, { auth: { persistSession: false } }) } catch (e) { return null }
}

function soDig(s) { return String(s || '').replace(/\D/g, '') }

// ——— estado do convite ———————————————————————————————————————————————
// Devolve o que o e-mail precisa saber sobre este destinatário:
//   situacao: 'usa'      → tem acesso ativo e já entrou pelo menos uma vez
//             'parado'   → tem acesso (senha já enviada) mas nunca entrou
//             'sem'      → não tem acesso nenhum
//             'bloqueado'→ acesso revogado/bloqueado pelo escritório (não convida)
//   falta_telefone: true quando o contato ligado ao processo está sem telefone
// Best-effort: qualquer erro devolve situacao 'usa' (= não incomoda o cliente),
// porque é melhor deixar de convidar do que travar/poluir um e-mail processual.
export async function estadoConvite(sb, { email, numero }) {
  const vazio = { situacao: 'usa', falta_telefone: false, nome: '', contato_id: null, processo_id: null, escritorio_id: null, numero: soDig(numero) }
  const mail = String(email || '').trim().toLowerCase()
  if (!sb || !mail) return vazio
  try {
    const { data: ac } = await sb.from('portal_acessos')
      .select('id,escritorio_id,contato_id,nome,ativo,bloqueado_em,senha_enviada_em,primeiro_login_em')
      .eq('email', mail).maybeSingle()

    // processo/contato: dá o nome, o telefone da ficha e o escritório
    let proc = null
    const num = soDig(numero)
    if (num) {
      const { data: p } = await sb.from('processos')
        .select('id,numero,escritorio_id,cliente_id,cliente_nome').eq('numero', num).maybeSingle()
      proc = p || null
    }
    let contatoId = (ac && ac.contato_id) || (proc && proc.cliente_id) || null
    let contato = null
    if (contatoId) {
      const { data: c } = await sb.from('contatos').select('id,nome,telefone,telefones,email,tipo').eq('id', contatoId).maybeSingle()
      contato = c || null
    }
    if (!contato) {
      // sem vínculo pelo processo: tenta achar o contato pelo próprio e-mail
      const { data: c } = await sb.from('contatos').select('id,nome,telefone,telefones,email,tipo').eq('email', mail).limit(1).maybeSingle()
      if (c) { contato = c; contatoId = c.id }
    }
    // Vara, cartório, perito, parte contrária: não são clientes do app — nunca
    // recebem convite, mesmo que o chamador tenha esquecido de marcar destino.
    if (contato && contato.tipo && !['cliente', 'parte', ''].includes(String(contato.tipo).toLowerCase())) return vazio

    const temTelefone = !!(contato && (String(contato.telefone || '').trim() || (Array.isArray(contato.telefones) && contato.telefones.some(t => soDig(t).length >= 10))))
    const nome = (ac && ac.nome) || (contato && contato.nome) || (proc && proc.cliente_nome) || ''
    const escritorio_id = (ac && ac.escritorio_id) || (proc && proc.escritorio_id) || null

    // Convite só faz sentido para quem o escritório reconhece: ou já tem acesso,
    // ou está ligado a um processo/ficha. Endereço solto (terceiro, colega,
    // e-mail avulso) não recebe propaganda do app.
    let situacao = 'sem'
    if (!ac && !contatoId && !proc) return vazio
    if (ac) {
      if (!ac.ativo || ac.bloqueado_em) situacao = 'bloqueado'
      else if (ac.primeiro_login_em) situacao = 'usa'
      else situacao = 'parado'
    }
    return {
      situacao, falta_telefone: !temTelefone && situacao !== 'bloqueado',
      nome, contato_id: contatoId, processo_id: (proc && proc.id) || null,
      escritorio_id, numero: num, acesso_id: (ac && ac.id) || null,
    }
  } catch (e) { return vazio }
}

// ——— o bloco que entra no e-mail ————————————————————————————————————
// Texto curto e sem jargão — vai no fim de um e-mail que o cliente já esperava.
export function blocoConviteHtml(est) {
  if (!est || est.situacao === 'bloqueado') return ''
  if (est.situacao === 'usa' && !est.falta_telefone) return ''
  const primeiroNome = String(est.nome || '').trim().split(/\s+/)[0] || ''
  const ola = primeiroNome ? (primeiroNome + ', v') : 'V'
  const linhaTel = est.falta_telefone
    ? '<div style="font-size:13.5px;color:#3d4756;margin-top:10px;padding-top:10px;border-top:1px dashed #e0d6b8">' +
        '<strong>Um pedido r&aacute;pido:</strong> o seu telefone/WhatsApp ainda n&atilde;o consta no nosso cadastro. ' +
        'Basta <strong>responder este e-mail com o n&uacute;mero</strong> (com DDD) que registramos na sua ficha — ' +
        'assim conseguimos avisar de audi&ecirc;ncia com anteced&ecirc;ncia.' +
      '</div>'
    : ''
  // Já usa o app e só falta o telefone: pede o número e pronto — nada de
  // convidar para o que a pessoa já usa todo dia.
  if (est.situacao === 'usa') {
    return '<div style="background:#fbf7ea;border:1px solid #e6d9ae;border-radius:10px;padding:14px 16px;margin:16px 0">' +
        '<div style="font-size:14px;font-weight:700;color:#7a5f12;margin-bottom:6px">&#128222; Cadastro</div>' +
        '<div style="font-size:13.5px;color:#3d4756;line-height:1.5">' +
          'O seu telefone/WhatsApp ainda n&atilde;o consta no nosso cadastro. Basta <strong>responder este e-mail ' +
          'com o n&uacute;mero</strong> (com DDD) que registramos na sua ficha — &eacute; por ele que avisamos ' +
          'de audi&ecirc;ncia com anteced&ecirc;ncia.' +
        '</div>' +
      '</div>'
  }
  const miolo = est.situacao === 'parado'
    ? ola + 'oc&ecirc; j&aacute; tem acesso ao nosso aplicativo, mas ainda n&atilde;o entrou nenhuma vez. ' +
      'Nele voc&ecirc; acompanha o andamento do processo, recebe os avisos de audi&ecirc;ncia e fala direto com o escrit&oacute;rio. ' +
      'O login &eacute; o seu e-mail (<strong>' + escapa(est.email_destino || '') + '</strong>) com a senha que enviamos. ' +
      'Perdeu a senha? &Eacute; s&oacute; responder este e-mail que mandamos outra.'
    : ola + 'oc&ecirc; pode acompanhar este processo pelo nosso aplicativo — andamento atualizado, avisos de audi&ecirc;ncia ' +
      'e conversa direta com o escrit&oacute;rio, sem precisar ligar. ' +
      '<strong>Responda este e-mail pedindo o acesso</strong> que liberamos e enviamos a sua senha.'
  return '<div style="background:#fbf7ea;border:1px solid #e6d9ae;border-radius:10px;padding:14px 16px;margin:16px 0">' +
      '<div style="font-size:14px;font-weight:700;color:#7a5f12;margin-bottom:6px">&#128241; Aplicativo do cliente</div>' +
      '<div style="font-size:13.5px;color:#3d4756;line-height:1.5">' + miolo + '</div>' +
      '<div style="text-align:center;margin-top:12px">' +
        '<a href="' + URL_PORTAL + '" style="display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:11px 24px;border-radius:22px;font-size:14px;font-weight:700">Abrir o aplicativo</a>' +
      '</div>' +
      linhaTel +
    '</div>'
}

export function blocoConviteTexto(est) {
  if (!est || est.situacao === 'bloqueado') return ''
  if (est.situacao === 'usa' && !est.falta_telefone) return ''
  if (est.situacao === 'usa') {
    return '\n\n--- Cadastro ---\nSeu telefone/WhatsApp ainda não consta no nosso cadastro. '
      + 'Responda este e-mail com o número (com DDD) que registramos na sua ficha — é por ele que avisamos de audiência com antecedência.'
  }
  const base = est.situacao === 'parado'
    ? '\n\n--- Aplicativo do cliente ---\nVocê já tem acesso ao nosso aplicativo, mas ainda não entrou nenhuma vez. '
      + 'Nele você acompanha o processo, recebe os avisos de audiência e fala direto com o escritório.\n'
      + 'Endereço: ' + URL_PORTAL + '\nLogin: ' + (est.email_destino || 'seu e-mail') + ' — se perdeu a senha, responda este e-mail que mandamos outra.'
    : '\n\n--- Aplicativo do cliente ---\nVocê pode acompanhar este processo pelo nosso aplicativo: andamento atualizado, '
      + 'avisos de audiência e conversa direta com o escritório.\nEndereço: ' + URL_PORTAL
      + '\nResponda este e-mail pedindo o acesso que liberamos e enviamos a sua senha.'
  const tel = est.falta_telefone
    ? '\n\nUm pedido rápido: seu telefone/WhatsApp ainda não consta no nosso cadastro. Responda este e-mail com o número (com DDD) que registramos na sua ficha.'
    : ''
  return base + tel
}

function escapa(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ——— controle da cobrança ————————————————————————————————————————————
// Toda vez que um convite sai (no e-mail comum ou pelo robô) a linha é
// atualizada aqui. É essa tabela que o robô lê para saber de quem cobrar
// daqui a 2 dias úteis — e é ela que fecha quando a pessoa finalmente entra.
export async function registrarConvite(sb, est, email) {
  if (!sb || !est || !est.escritorio_id) return
  if (est.situacao === 'bloqueado') return
  // Quem já usa o app só chega aqui quando o e-mail pediu o telefone que falta.
  // A linha nasce/segue FECHADA (o robô não cobra quem já entrou), mas com
  // pediu_telefone ligado — é esse sinal que autoriza a leitura da caixa a
  // gravar o número que o cliente responder.
  const soTelefone = est.situacao === 'usa'
  if (soTelefone && !est.falta_telefone) return
  const mail = String(email || '').trim().toLowerCase()
  if (!mail) return
  const agora = new Date().toISOString()
  try {
    const { data: atual } = await sb.from('portal_convites').select('id,envios,pediu_telefone')
      .eq('escritorio_id', est.escritorio_id).eq('email', mail).maybeSingle()
    if (atual) {
      await sb.from('portal_convites').update({
        envios: (atual.envios || 0) + 1, ultimo_envio_em: agora,
        tem_acesso: est.situacao !== 'sem',
        pediu_telefone: atual.pediu_telefone || !!est.falta_telefone,
        processo_id: est.processo_id || undefined, processo_numero: est.numero || undefined,
        contato_id: est.contato_id || undefined, nome: est.nome || undefined,
        concluido_em: soTelefone ? agora : null, concluido_motivo: soTelefone ? 'logou' : null,
      }).eq('id', atual.id)
    } else {
      await sb.from('portal_convites').insert({
        escritorio_id: est.escritorio_id, email: mail, processo_id: est.processo_id,
        processo_numero: est.numero || null, contato_id: est.contato_id, nome: est.nome || null,
        tem_acesso: est.situacao !== 'sem', pediu_telefone: !!est.falta_telefone,
        envios: 1, ultimo_envio_em: agora,
        concluido_em: soTelefone ? agora : null, concluido_motivo: soTelefone ? 'logou' : null,
      })
    }
  } catch (e) { /* controle de cobrança é acessório: nunca derruba o envio */ }
}

// Fecha a cobrança (a pessoa entrou, ou o escritório mandou parar).
export async function encerrarConvite(sb, { escritorio_id, email, motivo }) {
  if (!sb || !email) return
  try {
    const q = sb.from('portal_convites').update({ concluido_em: new Date().toISOString(), concluido_motivo: motivo || 'logou' })
      .eq('email', String(email).toLowerCase()).is('concluido_em', null)
    if (escritorio_id) q.eq('escritorio_id', escritorio_id)
    await q
  } catch (e) {}
}

// ——— dias úteis ——————————————————————————————————————————————————————
// "a cada 2 dias, só em dia útil": conta 2 dias ÚTEIS desde o último envio.
// Sábado e domingo não contam; feriado nacional fixo também não (a lista curta
// resolve os que caem em dia de semana e não dependem da Páscoa).
const FERIADOS_FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']

export function ehDiaUtil(d) {
  const local = new Date(d.getTime() - 3 * 3600000)  // Brasília
  const dow = local.getUTCDay()
  if (dow === 0 || dow === 6) return false
  return !FERIADOS_FIXOS.includes(local.toISOString().slice(5, 10))
}

// Quantos dias úteis se passaram entre duas datas (só conta dias completos).
export function diasUteisEntre(de, ate) {
  if (!de) return 999
  const ini = new Date(de), fim = new Date(ate)
  if (isNaN(ini.getTime())) return 999
  let n = 0
  const cur = new Date(ini.getTime())
  cur.setUTCHours(12, 0, 0, 0)
  const alvo = new Date(fim.getTime()); alvo.setUTCHours(12, 0, 0, 0)
  while (cur < alvo) {
    cur.setUTCDate(cur.getUTCDate() + 1)
    if (ehDiaUtil(cur)) n++
  }
  return n
}

// ——— telefone que veio na resposta do cliente ————————————————————————
// Lê um texto de e-mail e devolve o primeiro telefone brasileiro plausível.
// Conservador de propósito: só aceita 10 ou 11 dígitos com DDD válido (11–99)
// e, no caso de 11, exige que comece com 9 — assim número de processo, CPF,
// valor e data não viram telefone na ficha do cliente.
export function acharTelefone(texto) {
  const t = String(texto || '')
  if (!t.trim()) return null
  // corta assinatura/citação para não pegar o telefone DO ESCRITÓRIO no rodapé
  const corte = t.split(/\n\s*(?:>|Em .{0,60}escreveu:|-{2,}\s*Mensagem original)/)[0]
  const cand = corte.match(/(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*\d{4,5}[\s.-]?\d{4}/g) || []
  for (const c of cand) {
    let d = c.replace(/\D/g, '')
    if (d.length === 13 && d.startsWith('55')) d = d.slice(2)
    if (d.length === 12 && d.startsWith('55')) d = d.slice(2)
    if (d.length !== 10 && d.length !== 11) continue
    const ddd = parseInt(d.slice(0, 2), 10)
    if (!(ddd >= 11 && ddd <= 99)) continue
    if (d.length === 11 && d[2] !== '9') continue
    if (d.length === 10 && !'2345678'.includes(d[2])) continue
    return d
  }
  return null
}

// Formata (91) 98888-7777
export function formataTelefone(d) {
  const s = soDig(d)
  if (s.length === 11) return '(' + s.slice(0, 2) + ') ' + s.slice(2, 7) + '-' + s.slice(7)
  if (s.length === 10) return '(' + s.slice(0, 2) + ') ' + s.slice(2, 6) + '-' + s.slice(6)
  return s
}
