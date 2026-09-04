// Quem pediu demonstração do sistema.
//
// A página de vendas é pública e não tem login: quem chega ali não é usuário de
// nada ainda. O pedido entra no Comercial de quem VENDE (o escritório raiz), na
// mesma tela de leads que já existe — sem uma fila nova para ninguém aprender.
//
//   POST /api/interesse  { nome, email, telefone, oab, processos, sistema_atual, mensagem }
//
// Rota pública, então três cuidados que rota pública sempre precisa:
//   - lista fechada de campos: o que não está aqui não entra no banco;
//   - tamanho máximo por campo, para o formulário não virar depósito de texto;
//   - um pedido por e-mail a cada 10 minutos, para um robô não encher o CRM.
// O escritorio_id não vem do corpo: é o padrão da tabela (a raiz). Aceitar ele
// de fora seria deixar qualquer um escrever lead dentro de escritório alheio.

import { createClient } from '@supabase/supabase-js'
import { enviarEmailCore } from '../enviar-email/enviar.js'

export const dynamic = 'force-dynamic'

// Para onde vai o aviso de que alguém pediu demonstração.
//
// O lead entrar no CRM não basta: ele fica lá parado até alguém abrir a tela, e
// quem pediu demonstração espera resposta no mesmo dia. O aviso sai da conta do
// próprio servidor para o endereço de quem vende — é e-mail interno, nunca
// resposta automática ao interessado: a conta de envio da instalação tem o
// endereço do escritório que a opera, e uma confirmação saindo dali chegaria ao
// advogado com a marca de outro escritório, não a do produto.
const AVISAR = process.env.VENDAS_EMAIL || 'contato@djan.app.br'

const LIM = { nome: 120, email: 160, telefone: 40, oab: 40, processos: 30, sistema_atual: 80, mensagem: 1200 }

function corta(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max)
}
function emailValido(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim())
}

export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ erro: 'servidor sem chave de serviço' }, { status: 500 })
  }
  let body = {}
  try { body = await request.json() } catch (e) {}

  const nome = corta(body.nome, LIM.nome)
  const email = corta(body.email, LIM.email).toLowerCase()
  if (nome.length < 3) return Response.json({ erro: 'Informe seu nome.' }, { status: 400 })
  if (!emailValido(email)) return Response.json({ erro: 'Informe um e-mail válido.' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // mesmo e-mail pedindo de novo em minutos: quase sempre é duplo clique ou
  // robô. Responde ok — quem é gente não precisa saber que foi barrado.
  try {
    const desde = new Date(Date.now() - 10 * 60000).toISOString()
    const { data: ja } = await sb.from('crm_leads')
      .select('id').eq('email', email).eq('canal', 'site do sistema').gte('criado_em', desde).limit(1)
    if (ja && ja.length) return Response.json({ ok: true, repetido: true })
  } catch (e) {}

  const detalhe = [
    body.oab ? ('OAB: ' + corta(body.oab, LIM.oab)) : '',
    body.processos ? ('Processos hoje: ' + corta(body.processos, LIM.processos)) : '',
    body.sistema_atual ? ('Sistema atual: ' + corta(body.sistema_atual, LIM.sistema_atual)) : '',
    body.mensagem ? ('\n' + corta(body.mensagem, LIM.mensagem)) : '',
  ].filter(Boolean).join(' · ')

  const { error } = await sb.from('crm_leads').insert({
    nome,
    email,
    tel: corta(body.telefone, LIM.telefone) || null,
    canal: 'site do sistema',
    estagio: 'novo',
    prioridade: 'alta',
    obs: detalhe || null,
    capturado_em: new Date().toISOString(),
    ultima_atividade: new Date().toISOString(),
  })
  if (error) return Response.json({ erro: 'Não consegui registrar agora. Tente de novo em instantes.' }, { status: 500 })

  // O lead já está guardado; o aviso é conveniência. Falha aqui não pode
  // devolver erro a quem preencheu — ele fez a parte dele.
  try {
    await enviarEmailCore({
      para: AVISAR,
      assunto: 'Pedido de demonstração — ' + nome,
      corpo:
        'Alguém pediu demonstração pela página do sistema.\n\n' +
        'Nome: ' + nome + '\n' +
        'E-mail: ' + email + '\n' +
        (body.telefone ? ('Telefone: ' + corta(body.telefone, LIM.telefone) + '\n') : '') +
        (detalhe ? ('\n' + detalhe + '\n') : '') +
        '\nO pedido também está no Comercial, como lead novo.',
      dedup: false,
      convidarApp: false,
      escritorioId: null,   // conta do servidor
    })
  } catch (e) {}

  return Response.json({ ok: true })
}
