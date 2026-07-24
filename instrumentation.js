// Agendador interno do CMPGestão — roda os robôs sem depender de crontab.
// O Next chama register() uma vez quando o servidor sobe (next start). Aqui
// disparamos o maestro /api/cron/tick a cada 5 min; ele decide o que está na
// hora. Assim o escritório não precisa colar nada no terminal.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (globalThis.__cmpCronStarted) return
  globalThis.__cmpCronStarted = true

  const port = process.env.PORT || 3000
  const url = 'http://127.0.0.1:' + port + '/api/cron/tick'
  const tick = async () => {
    try { await fetch(url, { cache: 'no-store' }) } catch (e) { /* silencioso */ }
  }
  // primeira execução 25s após subir (dá tempo do servidor ficar pronto)
  setTimeout(tick, 25000)
  setInterval(tick, 5 * 60 * 1000)
}
