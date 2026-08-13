// Service worker do Chat da equipe — só cuida do "alarme" (push notification).
// Não faz cache de nada (não é um app offline), só precisa ficar vivo em
// segundo plano pra receber o evento push mesmo com o /chat fechado.

self.addEventListener('install', (event) => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let dados = {}
  try { dados = event.data ? event.data.json() : {} } catch (e) {}
  const titulo = dados.titulo || '💬 Chat CMPGestão'
  const corpo = dados.corpo || 'Nova mensagem'
  const url = dados.url || '/chat'
  const ehChamada = dados.tipo === 'chamada'
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: corpo,
      icon: '/chat/icon.svg',
      badge: '/chat/icon.svg',
      data: { url },
      // chamada tem etiqueta própria: uma mensagem chegando depois não pode
      // apagar o aviso da ligação tocando (e vice-versa)
      tag: ehChamada ? 'cmp-chamada' : 'cmp-chat',
      renotify: true,
      // ligação fica na tela até a pessoa tocar (mensagem some sozinha) e
      // vibra no padrão de toque — isso o sistema operacional faz sozinho,
      // mesmo com o app fechado, sem depender de JS da página rodando
      requireInteraction: ehChamada,
      vibrate: ehChamada ? [400, 180, 400, 180, 600] : undefined,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/chat'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.indexOf(url) !== -1 && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
