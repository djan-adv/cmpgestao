// Gera o hash da senha do painel admin do site do corretor (djan.net.br).
// Uso:  node scripts/hash-senha-imoveis.mjs "a-senha-escolhida"
// Cola o resultado em IMOVEIS_ADMIN_SENHA_HASH no .env.local da VPS — a senha em
// texto puro não fica em nenhum arquivo.

import crypto from 'crypto'

const senha = process.argv[2]
if (!senha) {
  console.error('Uso: node scripts/hash-senha-imoveis.mjs "a-senha-escolhida"')
  process.exit(1)
}

const sal = crypto.randomBytes(16).toString('hex')
const h = crypto.scryptSync(senha, sal, 32).toString('hex')
console.log('s2$' + sal + '$' + h)
