// A conta de e-mail DO PRODUTO — separada da conta do escritório que opera a
// instalação.
//
// O problema que isto resolve apareceu no primeiro cadastro real: um advogado
// se interessou pelo sistema em djan.app.br, e o aviso saiu de
// contato@cmpadvogados.com.br para os sócios do escritório. Duas coisas erradas
// de uma vez — quem vende o sistema é o produto, não a banca; e sócio de
// escritório de advocacia não tem por que receber lead de software.
//
// Vale para os dois sentidos:
//   - o que chega ao CLIENTE do sistema (código de confirmação, senha
//     provisória, aviso de fim de teste) tem de vir do produto. Um advogado que
//     nunca ouviu falar da banca recebendo "GestãoJurídica" de um endereço de
//     escritório de advocacia é, na melhor hipótese, confuso;
//   - o que chega a QUEM VENDE (novo teste aberto, novo interessado) também,
//     para não se misturar com o e-mail do escritório.
//
// SEM A CONTA PRÓPRIA CONFIGURADA, o envio continua saindo pela conta do
// servidor — e não há como evitar: trocar só o remetente escrito no cabeçalho,
// autenticando por outra conta, quebra SPF/DKIM e manda a mensagem direto para
// o spam. O que dá para fazer sem a conta é o nome exibido; o endereço depende
// de configurar SMTP_PRODUTO_*. Por isso `propria` volta no retorno: quem chama
// pode dizer, no aviso interno, por qual conta a mensagem saiu.

import nodemailer from 'nodemailer'

export const NOME_PRODUTO = 'GestãoJurídica'

export function contaProduto() {
  const hostP = process.env.SMTP_PRODUTO_HOST
  const userP = process.env.SMTP_PRODUTO_USER
  const passP = process.env.SMTP_PRODUTO_PASS
  if (hostP && userP && passP) {
    const port = parseInt(process.env.SMTP_PRODUTO_PORT || '465', 10)
    return {
      t: nodemailer.createTransport({ host: hostP, port, secure: port === 465, auth: { user: userP, pass: passP } }),
      user: userP,
      nome: process.env.SMTP_PRODUTO_FROM_NAME || NOME_PRODUTO,
      propria: true,
    }
  }

  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  const port = parseInt(process.env.SMTP_PORT || '465', 10)
  return {
    t: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }),
    user,
    // O nome exibido é do produto mesmo na conta emprestada: é o que dá para
    // corrigir sem quebrar a autenticação do domínio.
    nome: NOME_PRODUTO,
    propria: false,
  }
}

export function remetenteProduto() {
  const c = contaProduto()
  return c ? { endereco: c.user, propria: c.propria } : { endereco: null, propria: false }
}

// Envio simples, em texto — para os avisos internos e o código de confirmação.
export async function enviarTextoProduto({ para, assunto, corpo }) {
  const c = contaProduto()
  if (!c) return { erro: 'SMTP não configurado no servidor.' }
  try {
    await c.t.sendMail({
      from: '"' + c.nome + '" <' + c.user + '>',
      to: para, subject: assunto, text: corpo,
    })
    return { ok: true, conta: c.user, propria: c.propria }
  } catch (e) {
    return { erro: String((e && e.message) || e) }
  }
}
