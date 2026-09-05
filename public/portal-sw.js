// Service worker do Portal do Cliente — existe para o portal poder ser
// instalado na tela de início (Android) e, no futuro, receber push de novas
// mensagens/movimentações. Não faz cache: o portal é sempre ao vivo.

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

/* De quem é este endereço — para a notificação sair com a marca do escritório
   DO CLIENTE. O aviso do chat aparecia na tela de bloqueio com o nome e o ícone
   de quem vendeu o sistema, mesmo no app de outro escritório. */
let _marca = null
async function marcaDaCasa() {
  if (_marca) return _marca
  try {
    const r = await fetch('/api/inquilino', { cache: 'no-store' })
    const d = await r.json()
    if (d && d.ok && d.conhecido) {
      _marca = {
        nome: (d.marca && d.marca.sistema) || d.nome || '',
        icone: d.raiz === true ? '/icone-cmp-512.png?v=2' : ((d.marca && d.marca.logo) || '/api/portal/icone.svg'),
      }
      return _marca
    }
  } catch (e) {}
  return { nome: '', icone: '/api/portal/icone.svg' }
}

self.addEventListener('push', (event) => {
  let dados = {}
  try { dados = event.data ? event.data.json() : {} } catch (e) {}
  const url = dados.url || '/portal.html'
  event.waitUntil((async () => {
    const casa = await marcaDaCasa()
    // o título vem pronto do servidor (já com o nome do escritório certo);
    // o padrão é neutro, nunca o nome de uma banca
    const titulo = dados.titulo || casa.nome || 'Seu processo'
    const corpo = dados.corpo || 'Novidade no seu processo'
    const icone = dados.icone || casa.icone
    return self.registration.showNotification(titulo, {
      body: corpo,
      icon: icone,
      badge: icone,
      data: { url },
      tag: 'portal-cliente',
      renotify: true,
    })
  })())
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
