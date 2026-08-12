// Service worker do Chat da Equipe — só cuida do "alarme" (push notification).
// Não faz cache de nada (não é um app offline), só precisa ficar vivo em
// segundo plano pra receber o evento push mesmo com o chat fechado.

self.addEventListener('install', (event) => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let dados = {}
  try { dados = event.data ? event.data.json() : {} } catch (e) {}
  const titulo = dados.titulo || '💬 Chat da Equipe'
  const corpo = dados.corpo || 'Nova mensagem'
  const url = dados.url || '/chat'
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: corpo,
      icon: '/chat/icon.svg',
      badge: '/chat/icon.svg',
      data: { url },
      tag: 'chat-equipe',
      renotify: true,
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
