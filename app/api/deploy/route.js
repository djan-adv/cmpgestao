// API do CMPGestão — publicar atualização (git pull) no próprio servidor.
// Evita depender do terminal da Hostinger: o coordenador clica "Publicar" no sistema
// e esta rota roda `git pull origin main` em /opt/cmpgestao e retorna o resultado.
//
//   POST /api/deploy   (header Authorization: Bearer <jwt do Supabase>)
//
// Segurança:
//  - exige usuário autenticado (JWT do Supabase);
//  - exige que o e-mail do usuário esteja na lista DEPLOY_ALLOW (coordenador);
//  - só executa um git pull no diretório fixo do projeto — nada de comando arbitrário.

import { createClient } from '@supabase/supabase-js'
import { exec } from 'child_process'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REPO_DIR = '/opt/cmpgestao'
// e-mails autorizados a publicar (coordenador). Pode acrescentar outros depois.
const DEPLOY_ALLOW = ['djan.adv@gmail.com']

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: REPO_DIR, timeout: 55000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code || 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const email = String((user.email || '')).toLowerCase()
  if (!DEPLOY_ALLOW.map(e => e.toLowerCase()).includes(email)) {
    return Response.json({ erro: 'sem permissão para publicar' }, { status: 403 })
  }

  // 1) versão antes
  const antes = await run('git rev-parse --short HEAD')
  // 2) sincroniza FORÇADO com o GitHub — descarta edições locais soltas em arquivos
  //    versionados para não travar o deploy. .env.local (senhas), node_modules e .next
  //    NÃO são versionados e, portanto, não são afetados.
  await run('git fetch origin main 2>&1')
  const pull = await run('git reset --hard origin/main 2>&1')
  // 3) versão depois
  const depois = await run('git rev-parse --short HEAD')

  const de = (antes.stdout || '').trim()
  const para = (depois.stdout || '').trim()
  const ok = pull.code === 0
  const jaAtual = ok && de === para

  // Reinicia o processo APÓS responder, para que o Next.js passe a servir os
  // arquivos estáticos novos/alterados (public/*.html) — sem isso, mudanças em
  // arquivos estáticos só aparecem após um restart manual. Detached + delay para
  // a resposta HTTP terminar antes do restart derrubar o processo.
  if (ok && !jaAtual) {
    try {
      setTimeout(() => {
        try {
          exec('pm2 restart cmpgestao || npx pm2 restart cmpgestao || /usr/bin/pm2 restart cmpgestao',
            { timeout: 20000 }, () => {})
        } catch (e) { /* best-effort */ }
      }, 1500)
    } catch (e) { /* best-effort */ }
  }

  return Response.json({
    ok,
    atualizou: ok && de !== para,
    jaAtualizado: ok && jaAtual,
    de,
    para,
    saida: (pull.stdout || pull.stderr || '').slice(-1200),
  }, { status: ok ? 200 : 500 })
}

export async function GET() {
  return Response.json({ info: 'Use POST autenticado para publicar. Rota de deploy do CMPGestão.' })
}
