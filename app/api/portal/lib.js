// Miolo compartilhado do Portal do Cliente — usado pela API do cliente
// (app/api/portal/route.js) e pela API do escritório (app/api/portal/admin/route.js).
// Fica num arquivo próprio porque route.js não pode exportar nada além dos handlers.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { enviarEmailCore, URL_PUBLICA } from '../enviar-email/enviar.js'

export function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

/* ---------- senha (scrypt, sem dependência nova) ---------- */
export function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(String(senha), sal, 32).toString('hex')
  return 's2$' + sal + '$' + h
}
export function confereSenha(senha, guardado) {
  try {
    const [v, sal, h] = String(guardado || '').split('$')
    if (v !== 's2' || !sal || !h) return false
    const calc = crypto.scryptSync(String(senha), sal, 32)
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'))
  } catch (e) { return false }
}

// senha legível para o e-mail: 8 caracteres sem ambíguos (0/O, 1/I/l), em 2 blocos
export function gerarSenha() {
  const alf = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  const bytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i++) s += alf[bytes[i] % alf.length]
  return s.slice(0, 4) + '-' + s.slice(4)
}

/* ---------- sessão do cliente (Bearer token do portal) ---------- */
// Quanto tempo a sessão dura SEM USO. Antes o prazo era contado do login: quem
// instalou o app e continuou usando era deslogado no 60º dia do mesmo jeito, e
// aí precisava lembrar a senha — que o escritório havia mandado meses antes.
// Agora o relógio reinicia a cada uso: quem abre o app de vez em quando não sai
// nunca; quem abandonou por 60 dias cai, que é o que protege o aparelho perdido.
export const SESSAO_DIAS = 60

export async function sessao(sb, token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return null
  const { data: s } = await sb.from('portal_sessoes').select('token,acesso_id,expira_em').eq('token', token).maybeSingle()
  if (!s) return null
  if (new Date(s.expira_em) < new Date()) { try { await sb.from('portal_sessoes').delete().eq('token', token) } catch (e) {} ; return null }
  const { data: a } = await sb.from('portal_acessos').select('*').eq('id', s.acesso_id).maybeSingle()
  if (!a || !a.ativo || a.bloqueado_em) return null
  const agora = new Date()
  const novoFim = new Date(agora.getTime() + SESSAO_DIAS * 86400000).toISOString()
  try { await sb.from('portal_sessoes').update({ ultimo_uso_em: agora.toISOString(), expira_em: novoFim }).eq('token', token) } catch (e) {}
  return a
}
/* ---------- o e-mail é de alguém da EQUIPE deste escritório? ----------
   Devolve o nome da pessoa (ou o e-mail) quando for; null quando não.

   O app do cliente é pessoal e a tela toda fala com o titular ("Olá, Fulano!",
   "seus processos"). Com o e-mail de um advogado virando login de cliente, ele
   entra no app como se fosse o cliente do cadastro — e foi o que aconteceu: a
   varredura de convites achou o e-mail do próprio escritório no cadastro de um
   contato e criou o acesso sozinha. Quem conferir isso é sempre esta função;
   quem cria acesso (botão, varredura, primeiro acesso sem senha) pergunta aqui
   antes. */
export async function membroDaEquipe(sb, escritorioId, email) {
  const alvo = String(email || '').trim().toLowerCase()
  if (!alvo || !escritorioId) return null
  try {
    const { data } = await sb.from('usuarios').select('nome,email')
      .eq('escritorio_id', escritorioId).ilike('email', alvo).limit(1)
    const u = (data || [])[0]
    return u ? (u.nome || u.email) : null
  } catch (e) { return null }
}

export function tokenDo(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

export function digitos(s) { return String(s || '').replace(/\D/g, '') }

// Movimentações que o cliente vê: só as de origem oficial. As fontes internas
// ('manual', 'email', 'minuta', 'captura') guardam anotações do escritório — do tipo
// "[MENSAGEM AGENDADA…]" ou a cópia do e-mail enviado — e NÃO podem ir para o app.
export const FONTES_OFICIAIS = ['djen', 'datajud', 'jusbr', 'protocolo']

// Filtro para usar no lugar de .in('fonte', FONTES_OFICIAIS): também deixa
// passar o andamento manual que o escritório LIBEROU um a um pelo botão do
// histórico (andamentos.visivel_cliente) — é como a solicitação ao cartório
// chega a aparecer no app, mesmo sendo fonte='manual'.
export const FILTRO_HIST_CLIENTE = `fonte.in.(${FONTES_OFICIAIS.join(',')}),visivel_cliente.eq.true`

/* ---------- quais processos um acesso enxerga ----------
   Resolvido no banco (função portal_processos_ids): grants explícitos +
   processos do contato vinculado + processos cujo cliente_nome bate com o nome do
   acesso, comparando sem acento e sem diferença de maiúsculas — muitos processos têm
   cliente_id nulo e o nome aparece como "Mendonça" ou "Mendonca". Sempre restrito ao
   escritório do acesso. */
export async function processosPermitidos(sb, acesso) {
  const { data, error } = await sb.rpc('portal_processos_ids', { p_acesso: acesso.id })
  if (error || !data) return []
  return data.map(r => (typeof r === 'string' ? r : r.processo_id)).filter(Boolean)
}

/* ---------- e-mail com as credenciais do app ----------
   Movido para cá (fora de admin/route.js) porque um arquivo route.js só pode
   exportar os handlers HTTP — nada mais sai dele. Usado tanto pelo botão
   "Dar acesso ao app" (admin/route.js, ação 'conceder') quanto pela varredura
   em lote (cron/portal-varredura). */
/* Nome, endereço e conta de envio do escritório que está convidando. Sem isto
   o convite sai com o nome, o endereço e o e-mail de quem VENDEU o sistema —
   e o cliente tenta entrar pela porta errada. */
export async function dadosDaCasa(sb, escritorioId) {
  try {
    const { data } = await sb.from('escritorios')
      .select('nome,raiz,marca,hosts').eq('id', escritorioId).maybeSingle()
    if (!data) return {}
    const host = (data.hosts || [])[0]
    return {
      escritorioId,
      escritorioRaiz: data.raiz === true,
      escritorioNome: (data.marca && data.marca.sistema) || data.nome || '',
      endereco: (data.raiz === true || !host) ? null : ('https://' + host),
    }
  } catch (e) { return {} }
}

export async function emailCredenciais({ nome, email, senha, numero, novoProcesso, escritorioId, escritorioNome, escritorioRaiz, endereco }) {
  const linhaSenha = senha
    ? ('LOGIN (seu e-mail): ' + email + '\nSENHA: ' + senha + '\n')
    : ('LOGIN (seu e-mail): ' + email + '\nSENHA: a mesma que você já usa no portal (se esqueceu, peça ao escritório uma nova).\n')
  const corpo =
    'Olá' + (nome ? ', ' + nome : '') + '!\n\n' +
    (novoProcesso
      ? 'Um novo processo foi liberado no seu acesso ao aplicativo do escritório.\n\n'
      : 'Seu acesso ao aplicativo do escritório está pronto!\n\n') +
    'Pelo aplicativo você acompanha seu processo em tempo real: as movimentações, os documentos oficiais (despachos, sentenças e acordos), as petições que protocolamos e o contato do cartório da Vara. E, se precisar falar com a gente sobre o processo, é só usar o chat de dentro do próprio processo.\n\n' +
    /* o endereço é o do PRÓPRIO escritório: mandar o cliente dele para o
       endereço de quem vendeu o sistema o faria tentar entrar na porta errada */
    'ENDEREÇO: ' + (endereco || URL_PUBLICA) + '/portal.html\n' +
    linhaSenha + '\n' +
    'COMO COLOCAR NA TELA DO CELULAR (recomendado):\n' +
    '• Android: abra o endereço acima no Chrome e toque no botão "Instalar o aplicativo".\n' +
    '• iPhone: abra no Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".\n' +
    'Dentro do portal também há um botão que mostra o passo a passo certinho para o seu aparelho.\n\n' +
    'IMPORTANTE:\n' +
    '• O acesso é pessoal e protegido por senha — não compartilhe.\n' +
    '• Por segurança, o uso em muitos aparelhos diferentes bloqueia o acesso automaticamente.\n' +
    '• Qualquer dúvida, é só responder este e-mail.'
  return enviarEmailCore({
    para: email,
    // o assunto trazia o nome de um escritório só; agora é o de quem convida
    assunto: 'Seu acesso ao aplicativo do escritório' + (escritorioNome ? ' — ' + escritorioNome : ''),
    // sai pela conta de e-mail DO ESCRITÓRIO: o cliente dele não pode receber
    // convite vindo do endereço de outra banca
    escritorioId: escritorioRaiz ? null : (escritorioId || null),
    // convidarApp: false — este e-mail JÁ é o convite (leva login e senha);
    // o bloco automático repetiria a mesma conversa dentro dela mesma.
    corpo, numero: numero || '', dedup: false, convidarApp: false,
  })
}
