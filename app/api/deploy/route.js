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
import { exec, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const REPO_DIR = '/opt/cmpgestao'
const STATE_FILE = path.join(REPO_DIR, '.deploy-build.state')
const LOG_FILE = path.join(REPO_DIR, '.deploy-build.log')
// e-mails autorizados a publicar (coordenador). Pode acrescentar outros depois.
const DEPLOY_ALLOW = ['djan.adv@gmail.com']

// Recompila o servidor em segundo plano (npm install se preciso -> npm run build ->
// pm2 restart) e registra o estado em .deploy-build.state (building/done/error).
// Roda destacado para sobreviver ao restart do próprio processo da API.
function iniciarBuild(needInstall) {
  const inst = needInstall ? 'npm install --no-audit --no-fund' : 'true'
  const cmd =
    'echo building > ' + JSON.stringify(STATE_FILE) + '; ' +
    '{ ' + inst + ' && npm run build; } > ' + JSON.stringify(LOG_FILE) + ' 2>&1; ' +
    'if [ $? -eq 0 ]; then echo done > ' + JSON.stringify(STATE_FILE) + '; ' +
    '(pm2 restart cmpgestao || npx pm2 restart cmpgestao || /usr/bin/pm2 restart cmpgestao) >> ' + JSON.stringify(LOG_FILE) + ' 2>&1; ' +
    'else echo error > ' + JSON.stringify(STATE_FILE) + '; fi'
  try {
    const child = spawn('/bin/sh', ['-c', cmd], { cwd: REPO_DIR, detached: true, stdio: 'ignore', env: process.env })
    child.unref()
    return true
  } catch (e) { return false }
}

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

  // Decide o que a mudança exige: se mexeu em algo ALÉM de public/ (rota de API,
  // package.json, libs), precisa recompilar (npm run build). Só arquivos estáticos
  // (public/*.html) precisam apenas de restart.
  let build = 'nenhum'
  if (ok && !jaAtual) {
    const diff = await run('git diff --name-only ' + de + ' ' + para)
    const arquivos = (diff.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
    const needInstall = arquivos.includes('package.json') || arquivos.includes('package-lock.json')
    const soEstatico = arquivos.length > 0 && arquivos.every(f => f.startsWith('public/'))
    const precisaBuild = arquivos.length > 0 && !soEstatico
    if (precisaBuild) {
      build = iniciarBuild(needInstall) ? 'iniciado' : 'falhou_iniciar'
    } else {
      // só estático: restart leve após responder (o build detached faria isso, aqui não é preciso)
      try {
        try { fs.writeFileSync(STATE_FILE, 'done') } catch (e) {}
        setTimeout(() => {
          try { exec('pm2 restart cmpgestao || npx pm2 restart cmpgestao || /usr/bin/pm2 restart cmpgestao', { timeout: 20000 }, () => {}) } catch (e) {}
        }, 1500)
      } catch (e) {}
      build = 'nao_necessario'
    }
  }

  return Response.json({
    ok,
    atualizou: ok && de !== para,
    jaAtualizado: ok && jaAtual,
    de,
    para,
    build,   // 'iniciado' (recompilando) | 'nao_necessario' (só estático) | 'nenhum' | 'falhou_iniciar'
    saida: (pull.stdout || pull.stderr || '').slice(-1200),
  }, { status: ok ? 200 : 500 })
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('status') !== null) {
    let state = 'desconhecido', saida = ''
    try { state = fs.readFileSync(STATE_FILE, 'utf8').trim() } catch (e) {}
    if (state === 'error') { try { saida = fs.readFileSync(LOG_FILE, 'utf8').slice(-1500) } catch (e) {} }
    return Response.json({ state, saida })
  }
  return Response.json({ info: 'Use POST autenticado para publicar. Rota de deploy do CMPGestão.' })
}
