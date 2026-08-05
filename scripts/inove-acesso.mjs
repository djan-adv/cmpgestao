// Cria e administra os acessos do Portal da Inove pela linha de comando.
//
// Existe porque a tela de acessos do portal exige estar logado — e o primeiro acesso
// não tem quem o crie. Depois do primeiro, a Inove se vira sozinha pela tela.
//
// Roda na VPS, dentro de /opt/cmpgestao, com INOVE_DB_URL no ambiente:
//
//   node scripts/inove-acesso.mjs listar
//   node scripts/inove-acesso.mjs criar "Nome da Pessoa" pessoa@inove.com.br
//   node scripts/inove-acesso.mjs criar "Djan (dev)" djan.adv@gmail.com --oculto
//   node scripts/inove-acesso.mjs senha pessoa@inove.com.br
//   node scripts/inove-acesso.mjs desativar pessoa@inove.com.br
//   node scripts/inove-acesso.mjs ativar pessoa@inove.com.br
//
// A senha é gerada aqui e mostrada UMA vez — não fica guardada em lugar nenhum
// legível, só o hash scrypt vai para o banco.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// O Next.js lê o .env sozinho; um `node scripts/…` avulso NÃO. Sem isto, quem põe a
// INOVE_DB_URL no .env vê o script reclamar que a variável não existe.
function carregaEnv() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  for (const arq of ['.env.local', '.env']) {
    const caminho = path.join(raiz, arq)
    if (!fs.existsSync(caminho)) continue
    for (const linha of fs.readFileSync(caminho, 'utf8').split('\n')) {
      const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m) continue
      const chave = m[1]
      if (process.env[chave] !== undefined) continue   // o que já veio do shell manda
      process.env[chave] = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
    }
  }
}
carregaEnv()

const { q, q1, hashSenha, gerarSenha } = await import('../app/api/inove/lib.js')

const [, , cmd, ...args] = process.argv
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function ajuda(msg) {
  if (msg) console.error('\n' + msg)
  console.error(`
uso:
  node scripts/inove-acesso.mjs listar
  node scripts/inove-acesso.mjs criar "Nome" email [--oculto]
  node scripts/inove-acesso.mjs senha email
  node scripts/inove-acesso.mjs desativar email
  node scripts/inove-acesso.mjs ativar email
`)
  process.exit(msg ? 1 : 0)
}

async function limite() {
  const c = await q1(`select valor from inove.config where chave = 'limite_acessos'`)
  return parseInt((c && c.valor) || '5', 10) || 5
}

async function listar() {
  const linhas = await q(
    `select nome, email, ativo, oculto, primeiro_login_em, ultimo_login_em
       from inove.acessos order by oculto, nome`)
  if (!linhas.length) return console.log('Nenhum acesso cadastrado ainda.')
  const lim = await limite()
  const visiveis = linhas.filter(x => !x.oculto && x.ativo).length
  console.log('\nAcessos da Inove — ' + visiveis + ' ativos de ' + lim + ' do plano\n')
  for (const a of linhas) {
    const marcas = [
      a.ativo ? 'ativo' : 'DESATIVADO',
      a.oculto ? 'oculto (não aparece para eles, não conta na cota)' : null,
      a.ultimo_login_em ? 'último acesso ' + new Date(a.ultimo_login_em).toLocaleString('pt-BR') : 'nunca entrou',
    ].filter(Boolean)
    console.log('  ' + (a.nome || '(sem nome)') + '  <' + a.email + '>')
    console.log('    ' + marcas.join(' · '))
  }
  console.log('')
}

async function criar(nome, email, oculto) {
  if (!nome || !RE_EMAIL.test(email || '')) ajuda('Informe nome e e-mail válido.')
  const existe = await q1('select id from inove.acessos where email = $1', [email])
  if (existe) ajuda('Já existe um acesso com esse e-mail. Para trocar a senha, use: senha ' + email)

  if (!oculto) {
    const lim = await limite()
    const n = await q1('select count(*)::int n from inove.acessos where oculto = false and ativo')
    if (n.n >= lim) ajuda('Limite de ' + lim + ' acessos atingido. Desative um antes, ou altere limite_acessos em inove.config.')
  }

  const senha = gerarSenha()
  await q(
    `insert into inove.acessos (nome, email, senha_hash, oculto, criado_por)
     values ($1, $2, $3, $4, 'script')`,
    [nome, email, hashSenha(senha), !!oculto])

  console.log('\nAcesso criado' + (oculto ? ' (oculto)' : '') + '.')
  console.log('  e-mail: ' + email)
  console.log('  senha:  ' + senha)
  console.log('\nAnote agora — esta senha não é recuperável, só substituível.\n')
}

async function trocarSenha(email) {
  if (!RE_EMAIL.test(email || '')) ajuda('Informe o e-mail.')
  const a = await q1('select id, nome from inove.acessos where email = $1', [email])
  if (!a) ajuda('Não existe acesso com esse e-mail.')
  const senha = gerarSenha()
  await q('update inove.acessos set senha_hash = $1 where id = $2', [hashSenha(senha), a.id])
  await q('delete from inove.sessoes where acesso_id = $1', [a.id])   // derruba quem estava logado
  console.log('\nSenha trocada para ' + (a.nome || email) + '.')
  console.log('  senha nova: ' + senha)
  console.log('\nAs sessões abertas desse acesso foram encerradas.\n')
}

async function ligar(email, ativo) {
  if (!RE_EMAIL.test(email || '')) ajuda('Informe o e-mail.')
  const a = await q1('select id, nome from inove.acessos where email = $1', [email])
  if (!a) ajuda('Não existe acesso com esse e-mail.')
  await q('update inove.acessos set ativo = $1 where id = $2', [ativo, a.id])
  if (!ativo) await q('delete from inove.sessoes where acesso_id = $1', [a.id])
  console.log((ativo ? 'Reativado: ' : 'Desativado: ') + (a.nome || email))
}

try {
  if (!process.env.INOVE_DB_URL) ajuda('Falta INOVE_DB_URL no ambiente (veja ops/PROJETO-INOVE.md, seção 4).')
  if (cmd === 'listar') await listar()
  else if (cmd === 'criar') await criar(args[0], args[1], args.includes('--oculto'))
  else if (cmd === 'senha') await trocarSenha(args[0])
  else if (cmd === 'desativar') await ligar(args[0], false)
  else if (cmd === 'ativar') await ligar(args[0], true)
  else ajuda(cmd ? 'Comando desconhecido: ' + cmd : null)
  process.exit(0)
} catch (e) {
  console.error('\nFalhou: ' + ((e && e.message) || e) + '\n')
  process.exit(1)
}
