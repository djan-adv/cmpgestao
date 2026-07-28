// Botão "✅ Confirmo que recebi este aviso" dos e-mails de audiência.
// O cliente clica, cai aqui, e o sistema:
//   1. marca o evento da agenda como confirmado pelo cliente;
//   2. lança no histórico do processo que o cliente confirmou;
//   3. mostra uma página simpática de "presença confirmada".
// Sem login — o token único do rastreio é a credencial. Clicar de novo não
// duplica nada: a segunda visita só mostra "já estava confirmado".

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

function pagina(titulo, msg, ok) {
  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + titulo + ' — CMP Advogados</title></head>'
    + '<body style="margin:0;font-family:system-ui,Arial,sans-serif;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh">'
    + '<div style="background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.08);padding:34px 30px;max-width:420px;margin:16px;text-align:center">'
    + '<div style="font-size:52px;line-height:1">' + (ok ? '✅' : '⚠️') + '</div>'
    + '<h1 style="font-size:21px;color:#1e2733;margin:14px 0 8px">' + titulo + '</h1>'
    + '<p style="font-size:14.5px;color:#5b6472;line-height:1.6;margin:0">' + msg + '</p>'
    + '<p style="font-size:12px;color:#9aa1ab;margin:22px 0 0">Crispim Mendonça e Pinheiro Advogados</p>'
    + '</div></body></html>'
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return pagina('Indisponível', 'O sistema está temporariamente indisponível. Tente novamente mais tarde.', false)
  const { searchParams } = new URL(request.url)
  const token = String(searchParams.get('t') || '').replace(/[^a-f0-9]/gi, '')
  if (!token) return pagina('Link inválido', 'Este link de confirmação não é válido. Se precisar, responda o e-mail que recebeu.', false)

  const sb = admin()
  const r = await sb.from('email_rastreio').select('id,evento_id,numero,para,confirmado_em,aberto_em').eq('token', token).single()
  if (r.error || !r.data) return pagina('Link inválido', 'Este link de confirmação não é válido ou expirou. Se precisar, responda o e-mail que recebeu.', false)
  const ras = r.data

  // abrir o link também vale como abertura do e-mail
  try { await sb.from('email_rastreio').update({ aberto_em: ras.aberto_em || new Date().toISOString(), ultima_abertura: new Date().toISOString() }).eq('id', ras.id) } catch (e) {}

  if (!ras.evento_id) return pagina('Recebido!', 'Registramos que você recebeu nosso e-mail. Obrigado!', true)

  if (ras.confirmado_em) {
    const dbr = new Date(ras.confirmado_em)
    return pagina('Já estava confirmado', 'Sua confirmação já havia sido registrada em ' + String(dbr.getDate()).padStart(2, '0') + '/' + String(dbr.getMonth() + 1).padStart(2, '0') + '. Está tudo certo — não precisa fazer mais nada.', true)
  }

  const agora = new Date().toISOString()
  const ev = await sb.from('agenda_eventos').select('id,titulo,data,hora,processo_numero,confirmado_em').eq('id', ras.evento_id).single()

  await sb.from('email_rastreio').update({ confirmado_em: agora }).eq('id', ras.id)
  if (ev.data && !ev.data.confirmado_em) {
    await sb.from('agenda_eventos').update({ confirmado_em: agora, confirmado_por: 'cliente (botão do e-mail: ' + ras.para + ')' }).eq('id', ras.evento_id)
  }

  // histórico do processo
  try {
    const dig = String((ev.data && ev.data.processo_numero) || ras.numero || '').replace(/\D/g, '')
    if (dig) {
      const p = await sb.from('processos').select('id').or('numero_digitos.eq.' + dig + ',numero.eq.' + ((ev.data && ev.data.processo_numero) || dig)).limit(1).single()
      if (p.data) {
        const dbr = ev.data && ev.data.data ? String(ev.data.data).slice(0, 10).split('-').reverse().join('/') : ''
        const texto = '[AGENDA] Cliente CONFIRMOU o recebimento do aviso' + (ev.data ? (' — ' + (ev.data.titulo || 'audiência') + (dbr ? (' de ' + dbr) : '') + ((ev.data.hora && ev.data.hora !== 'Dia todo') ? (' às ' + ev.data.hora) : '')) : '') + ' — pelo botão do e-mail (' + ras.para + ').'
        await sb.from('andamentos').insert({ processo_id: p.data.id, data: agora.slice(0, 10), texto, fonte: 'manual' })
      }
    }
  } catch (e) {}

  const dbrEv = ev.data && ev.data.data ? String(ev.data.data).slice(0, 10).split('-').reverse().join('/') : ''
  return pagina('Presença confirmada!',
    'Obrigado! Registramos que você recebeu o aviso' + (dbrEv ? (' da audiência de <b>' + dbrEv + '</b>' + ((ev.data.hora && ev.data.hora !== 'Dia todo') ? (' às <b>' + ev.data.hora + '</b>') : '')) : '') + '. O escritório já foi informado — não precisa responder o e-mail.', true)
}
