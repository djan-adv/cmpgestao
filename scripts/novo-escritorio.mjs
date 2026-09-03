// Cria um ESCRITÓRIO NOVO na mesma raiz — a versão autônoma para testes.
//
// Um escritório criado aqui roda sozinho: entra pelo mesmo endereço, com login
// próprio, e por RLS só enxerga os dados dele (processos, tarefas, contatos,
// agenda, chat, documentos). Nada da CMP aparece; nada que ele fizer aparece
// para a CMP.
//
// Existe como script, e não como tela, porque o primeiro acesso de um escritório
// novo não tem quem o crie: ninguém dele está logado ainda.
//
// Roda na VPS, em /opt/cmpgestao:
//
//   node scripts/novo-escritorio.mjs listar
//   node scripts/novo-escritorio.mjs criar "Escritório Teste" fulano@exemplo.com "Fulano de Tal"
//   node scripts/novo-escritorio.mjs acesso <escritorio_id> outro@exemplo.com "Outro Nome"
//   node scripts/novo-escritorio.mjs senha fulano@exemplo.com
//
// A senha é sorteada aqui e mostrada UMA vez — o banco guarda só o hash do
// Supabase Auth.

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// O Next.js lê o .env sozinho; um `node scripts/…` avulso NÃO.
function carregaEnv() {
  const doShell = new Set(Object.keys(process.env))
  for (const arq of ['.env.local', '.env']) {
    const caminho = path.join(RAIZ, arq)
    if (!fs.existsSync(caminho)) continue
    for (const linha of fs.readFileSync(caminho, 'utf8').split('\n')) {
      const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
      if (!m || doShell.has(m[1])) continue
      process.env[m[1]] = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
    }
    break
  }
}
carregaEnv()

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
if (!URL_SB || !SERVICE) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente (.env.local).')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(URL_SB, SERVICE, { auth: { persistSession: false } })

const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PASTA_BASE = process.env.CMPDOCS_ROOT || '/opt/cmpdocs'

function senhaNova() {
  // legível de ler no telefone e forte o bastante (sem 0/O/1/l)
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let s = ''
  for (const b of crypto.randomBytes(14)) s += alfa[b % alfa.length]
  return s
}

function ajuda(msg) {
  if (msg) console.error('\n' + msg)
  console.error(`
uso:
  node scripts/novo-escritorio.mjs listar
  node scripts/novo-escritorio.mjs criar "Nome do Escritório" email "Nome da Pessoa"
  node scripts/novo-escritorio.mjs acesso <escritorio_id> email "Nome da Pessoa"
  node scripts/novo-escritorio.mjs senha email
`)
  process.exit(msg ? 1 : 0)
}

async function listar() {
  const { data: escs, error } = await sb.from('escritorios').select('id,nome,plano,criado_em').order('criado_em')
  if (error) { console.error('erro:', error.message); process.exit(1) }
  for (const e of escs || []) {
    const { count: nu } = await sb.from('usuarios').select('id', { count: 'exact', head: true }).eq('escritorio_id', e.id)
    const { count: np } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', e.id)
    console.log([e.id, (e.plano || '').padEnd(6), String(nu || 0).padStart(3) + ' acessos', String(np || 0).padStart(5) + ' processos', e.nome].join('  '))
  }
}

/* cria o login no Supabase Auth e a linha em usuarios; devolve a senha sorteada */
async function criarAcesso(escId, email, nome, papel) {
  const senha = senhaNova()
  const cri = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (cri.error) { console.error('erro ao criar o login:', cri.error.message); process.exit(1) }
  const uid = cri.data.user.id
  const ins = await sb.from('usuarios').insert({ id: uid, escritorio_id: escId, nome, email, papel })
  if (ins.error) {
    await sb.auth.admin.deleteUser(uid).catch(() => {})
    console.error('erro ao registrar o usuário:', ins.error.message)
    process.exit(1)
  }
  return senha
}

async function criar(nomeEsc, email, nomePessoa) {
  if (!nomeEsc || !email || !nomePessoa) ajuda('faltou algum dado: nome do escritório, e-mail e nome da pessoa.')
  if (!RE_EMAIL.test(email)) ajuda('e-mail inválido: ' + email)

  const nova = await sb.from('escritorios').insert({ nome: nomeEsc, plano: 'teste' }).select('id').single()
  if (nova.error) { console.error('erro ao criar o escritório:', nova.error.message); process.exit(1) }
  const escId = nova.data.id

  const senha = await criarAcesso(escId, email, nomePessoa, 'socio')

  const pasta = path.join(PASTA_BASE, '_esc', escId)
  try { fs.mkdirSync(pasta, { recursive: true }) } catch (e) { console.error('aviso: não consegui criar ' + pasta + ' — crie na mão.') }

  console.log('\nEscritório criado e pronto para uso:\n')
  console.log('  escritório : ' + nomeEsc)
  console.log('  id         : ' + escId)
  console.log('  documentos : ' + pasta)
  console.log('  login      : ' + email)
  console.log('  senha      : ' + senha)
  console.log('\nA senha aparece só desta vez. Entre pelo mesmo endereço do sistema.')
  console.log('Este escritório não vê nada da CMP, e a CMP não vê nada dele.\n')
}

async function acesso(escId, email, nomePessoa) {
  if (!RE_UUID.test(String(escId || ''))) ajuda('escritorio_id inválido — veja em "listar".')
  if (!RE_EMAIL.test(String(email || ''))) ajuda('e-mail inválido: ' + email)
  if (!nomePessoa) ajuda('faltou o nome da pessoa.')
  const { data: esc } = await sb.from('escritorios').select('id,nome').eq('id', escId).maybeSingle()
  if (!esc) { console.error('escritório não encontrado: ' + escId); process.exit(1) }
  const senha = await criarAcesso(escId, email, nomePessoa, 'membro')
  console.log('\nAcesso criado em "' + esc.nome + '":\n  login: ' + email + '\n  senha: ' + senha + '\n')
}

async function trocarSenha(email) {
  if (!RE_EMAIL.test(String(email || ''))) ajuda('e-mail inválido: ' + email)
  const { data: u } = await sb.from('usuarios').select('id,nome').eq('email', email).maybeSingle()
  if (!u) { console.error('não há usuário com esse e-mail: ' + email); process.exit(1) }
  const senha = senhaNova()
  const r = await sb.auth.admin.updateUserById(u.id, { password: senha })
  if (r.error) { console.error('erro:', r.error.message); process.exit(1) }
  console.log('\nSenha nova de ' + (u.nome || email) + ': ' + senha + '\n')
}

const [, , cmd, ...args] = process.argv
if (cmd === 'listar') await listar()
else if (cmd === 'criar') await criar(args[0], args[1], args[2])
else if (cmd === 'acesso') await acesso(args[0], args[1], args[2])
else if (cmd === 'senha') await trocarSenha(args[0])
else ajuda(cmd ? 'comando desconhecido: ' + cmd : '')
