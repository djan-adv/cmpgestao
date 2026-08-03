// Service worker do Portal do Cliente — existe para o portal poder ser
// instalado na tela de início (Android) e, no futuro, receber push de novas
// mensagens/movimentações. Não faz cache: o portal é sempre ao vivo.

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('push', (event) => {
  let dados = {}
  try { dados = event.data ? event.data.json() : {} } catch (e) {}
  const titulo = dados.titulo || 'CMP Advogados'
  const corpo = dados.corpo || 'Novidade no seu processo'
  const url = dados.url || '/portal.html'
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: corpo,
      icon: '/icone-cmp-512.png',
      badge: '/icone-cmp-512.png',
      data: { url },
      tag: 'cmp-portal',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/portal.html'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.indexOf('/portal') !== -1 && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
