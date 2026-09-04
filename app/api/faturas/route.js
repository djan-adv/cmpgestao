// Fatura do escritório para o cliente dele — sem banco no meio.
//
// O Financeiro nasceu em cima do Cora: toda linha era um boleto emitido lá. Isso
// serve a quem tem a conta configurada e não serve a mais ninguém — e a conta do
// Cora é de quem opera o sistema, não do escritório que comprou. Resultado: o
// escritório cliente ficava sem financeiro nenhum, e a tela inteira ficava
// escondida dele.
//
// A fatura resolve o intervalo. É a mesma linha do financeiro (mesma tabela,
// mesma lista, mesmos totais, mesma aba de recebidas), só que emitida à mão: o
// escritório lança o que cobrou, manda a fatura para o cliente e dá baixa quando
// receber — por PIX próprio, transferência, dinheiro, o que for. Quando ele
// tiver conta de banco integrada, o boleto entra por cima disso sem migrar nada.
//
//   POST /api/faturas  { acao: 'criar',   contato_id | nome, descricao, valor_centavos, vencimento, processo_numero }
//   POST /api/faturas  { acao: 'pagar',   id, valor_pago_centavos?, pago_em? }
//   POST /api/faturas  { acao: 'reabrir', id }
//
// Tudo passa pelo JWT de quem pediu (RLS): a fatura de um escritório não é
// alcançável por outro, nem para ler nem para baixar.

import { sbUsuario, usuarioDoToken } from '../cora/lib.js'

export const dynamic = 'force-dynamic'

function soDigitos(s) { return String(s || '').replace(/\D/g, '') }

export async function POST(request) {
  const { jwt, user } = await usuarioDoToken(request)
  if (!user) return Response.json({ erro: 'Faça login para emitir faturas.' }, { status: 401 })
  const sb = sbUsuario(jwt)

  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || 'criar')

  // ---- dar baixa -----------------------------------------------------------
  // Sem banco integrado, quem sabe que o dinheiro entrou é o escritório. A baixa
  // é manual e reversível: marcar pago por engano não pode ser irreversível.
  if (acao === 'pagar' || acao === 'reabrir') {
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ erro: 'informe a fatura' }, { status: 400 })
    const { data: f } = await sb.from('cora_cobrancas')
      .select('id,cora_invoice_id,valor_centavos,status').eq('id', id).maybeSingle()
    if (!f) return Response.json({ erro: 'Fatura não encontrada.' }, { status: 404 })
    // linha de boleto tem baixa própria (o banco confirma): não se mexe nela aqui
    if (f.cora_invoice_id) {
      return Response.json({ erro: 'Esta cobrança tem boleto emitido — a baixa dela vem do banco, em "Conferir pagamentos".' }, { status: 400 })
    }

    if (acao === 'reabrir') {
      const { error } = await sb.from('cora_cobrancas')
        .update({ status: 'aberta', pago_em: null, valor_pago_centavos: null, atualizado_em: new Date().toISOString() })
        .eq('id', id)
      if (error) return Response.json({ erro: error.message }, { status: 500 })
      return Response.json({ ok: true, reaberta: true })
    }

    const pagoEm = /^\d{4}-\d{2}-\d{2}/.test(String(body.pago_em || ''))
      ? String(body.pago_em).slice(0, 10) + 'T12:00:00Z'
      : new Date().toISOString()
    const valorPago = parseInt(body.valor_pago_centavos, 10)
    const { error } = await sb.from('cora_cobrancas').update({
      status: 'paga',
      pago_em: pagoEm,
      valor_pago_centavos: valorPago > 0 ? valorPago : f.valor_centavos,
      atualizado_em: new Date().toISOString(),
    }).eq('id', id)
    if (error) return Response.json({ erro: error.message }, { status: 500 })
    return Response.json({ ok: true, paga: true })
  }

  // ---- emitir --------------------------------------------------------------
  const descricao = String(body.descricao || '').trim()
  const vencimento = String(body.vencimento || '').trim()
  const centavos = parseInt(body.valor_centavos, 10)
  if (!descricao) return Response.json({ erro: 'Descreva o que está sendo cobrado.' }, { status: 400 })
  if (!(centavos > 0)) return Response.json({ erro: 'Informe o valor da fatura.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return Response.json({ erro: 'Informe a data de vencimento.' }, { status: 400 })

  // o escritório de quem pediu — é ele que assina a fatura e recebe por ela
  const { data: perfil } = await sb.from('usuarios').select('escritorio_id').eq('id', user.id).maybeSingle()
  const esc = perfil && perfil.escritorio_id
  if (!esc) return Response.json({ erro: 'Usuário sem escritório vinculado.' }, { status: 403 })

  // Cliente: o já cadastrado, ou um novo criado na hora. Fatura sem destinatário
  // não é fatura — mas obrigar a cadastrar antes faria o escritório desistir no
  // meio, então o cadastro acontece aqui, com o que ele digitou.
  let contatoId = String(body.contato_id || '').trim() || null
  const nome = String(body.nome || '').trim()
  if (!contatoId) {
    if (!nome) return Response.json({ erro: 'Informe o cliente que vai receber a fatura.' }, { status: 400 })
    const doc = soDigitos(body.cpf_cnpj)
    let achado = null
    if (doc) {
      const { data } = await sb.from('contatos').select('id').eq('escritorio_id', esc).eq('cpf_cnpj', doc).limit(1)
      achado = (data || [])[0] || null
    }
    if (!achado) {
      const { data } = await sb.from('contatos').select('id').eq('escritorio_id', esc).ilike('nome', nome).limit(1)
      achado = (data || [])[0] || null
    }
    if (achado) contatoId = achado.id
    else {
      const { data, error } = await sb.from('contatos').insert({
        escritorio_id: esc, nome, tipo: 'cliente',
        cpf_cnpj: doc || null,
        email: String(body.email || '').trim() || null,
        telefone: String(body.telefone || '').trim() || null,
      }).select('id').single()
      if (error) return Response.json({ erro: 'Não consegui cadastrar o cliente: ' + error.message }, { status: 500 })
      contatoId = data.id
    }
  }

  const { data, error } = await sb.from('cora_cobrancas').insert({
    escritorio_id: esc,
    contato_id: contatoId,
    descricao,
    valor_centavos: centavos,
    vencimento,
    status: 'aberta',
    processo_numero: String(body.processo_numero || '').trim() || null,
    // sem cora_invoice_id: é o que distingue a fatura do boleto na tela
  }).select('id').single()
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  return Response.json({ ok: true, id: data.id })
}
