'use client'
// Tela PÚBLICA de CONFIRMAÇÃO da assinatura (dupla verificação por e-mail).
// Após assinar, o cliente recebe um e-mail com o botão "Confirmar minha assinatura",
// que abre esta página (?d=documento&s=token). Aqui registramos a confirmação e
// avisamos o escritório (equivalente ao confirmar.html do site antigo).
//
// SELFIE (20/08/2026, pedido do dono): depois da confirmação oferecemos o envio
// de uma selfie como prova extra de autoria. É OPCIONAL — a assinatura já vale
// sem ela; quem não enviar não perde nada. A imagem fica só com o escritório
// (entra na via A4 interna da pasta do processo), nunca na cópia do cliente.
import { useEffect, useRef, useState } from 'react'
import { signSb } from '../../../lib/supabaseAssinatura'

const NAVY = '#2E3A4B'

export default function ConfirmarAssinatura() {
  const [estado, setEstado] = useState({ fase: 'carregando' }) // carregando | ok | ja | erro
  const [selfie, setSelfie] = useState({ fase: 'idle', preview: '', msg: '' }) // idle | pronta | enviando | ok | erro
  const tokRef = useRef('')
  const blobRef = useRef(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const tok = q.get('s')
    if (!tok) { setEstado({ fase: 'erro', msg: 'Link inválido.' }); return }
    tokRef.current = tok
    signSb.rpc('confirmar_assinatura', { tok }).then(({ data, error }) => {
      if (error) { setEstado({ fase: 'erro', msg: error.message }); return }
      const r = (data && data[0]) || {}
      if (r.ja_confirmado) { setEstado({ fase: 'ja', titulo: r.titulo }); return }
      setEstado({ fase: 'ok', titulo: r.titulo })
      // avisa o escritório que a dupla verificação foi concluída (best-effort)
      try {
        signSb.functions.invoke('enviar-confirmacao', {
          body: { modo: 'avisar', nome: r.nome, email: r.email, titulo: r.titulo, quando: new Date().toLocaleString('pt-BR'), ip: r.ip || '' },
        })
      } catch { /* segue */ }
    })
  }, [])

  // reduz a foto no aparelho (câmera solta arquivos enormes) e guarda o blob
  function aoEscolherFoto(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const img = new Image()
    img.onload = () => {
      const MAX = 900
      const esc = Math.min(1, MAX / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      c.toBlob((blob) => {
        if (!blob) { setSelfie({ fase: 'erro', preview: '', msg: 'Não consegui ler a foto. Tente de novo.' }); return }
        blobRef.current = blob
        setSelfie({ fase: 'pronta', preview: c.toDataURL('image/jpeg', 0.8), msg: '' })
      }, 'image/jpeg', 0.85)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => setSelfie({ fase: 'erro', preview: '', msg: 'Arquivo não parece ser uma foto. Tente de novo.' })
    img.src = URL.createObjectURL(file)
  }

  async function enviarSelfie() {
    if (!blobRef.current || !tokRef.current) return
    setSelfie(s => ({ ...s, fase: 'enviando', msg: '' }))
    try {
      const path = tokRef.current + '-selfie.jpg'
      const up = await signSb.storage.from('assinaturas').upload(path, blobRef.current, { contentType: 'image/jpeg', upsert: true })
      if (up.error && !/exist|duplicate/i.test(up.error.message || '')) throw new Error(up.error.message)
      const { error } = await signSb.rpc('registrar_selfie', { tok: tokRef.current, p_path: path })
      if (error) throw new Error(error.message)
      setSelfie(s => ({ ...s, fase: 'ok' }))
    } catch (e) {
      setSelfie(s => ({ ...s, fase: 'erro', msg: (e && e.message) || 'Não deu certo. Tente de novo.' }))
    }
  }

  const icone = { carregando: '⏳', ok: '✅', ja: '✅', erro: '⚠️' }[estado.fase]
  const titulo = {
    carregando: 'Confirmando sua assinatura…',
    ok: 'Assinatura confirmada!',
    ja: 'Assinatura já confirmada',
    erro: 'Não foi possível confirmar',
  }[estado.fase]
  const texto = {
    carregando: 'Aguarde um instante.',
    ok: 'Obrigado! Sua confirmação reforça a segurança do documento' + (estado.titulo ? ' "' + estado.titulo + '"' : '') + '.',
    ja: 'Esta assinatura já havia sido confirmada antes' + (estado.titulo ? ' para o documento "' + estado.titulo + '"' : '') + '. Nenhuma ação é necessária.',
    erro: estado.msg || 'Link inválido.',
  }[estado.fase]

  const mostraSelfie = (estado.fase === 'ok' || estado.fase === 'ja') && selfie.fase !== 'ok'

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7', fontFamily: "'Segoe UI',system-ui,Arial,sans-serif" }}>
      <header style={{ background: NAVY, color: '#fff', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>CMP Advogados · Assinatura eletrônica</div>
        <div style={{ marginLeft: 'auto', fontSize: 11, background: 'rgba(255,255,255,.12)', padding: '6px 10px', borderRadius: 20 }}>🔒 Dupla verificação</div>
      </header>
      <div style={{ maxWidth: 440, margin: '40px auto', padding: '0 16px' }}>
        <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 28, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>{icone}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 17, color: NAVY }}>{titulo}</h2>
          <p style={{ fontSize: 14, color: '#5b6673', margin: 0 }}>{texto}</p>

          {selfie.fase === 'ok' && (
            <div style={{ marginTop: 18, background: '#e7f4ec', border: '1px solid #bfe0cf', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, color: '#1f7a44' }}>
              📸 Selfie recebida — obrigado! Sua assinatura ficou ainda mais protegida. Pode fechar esta página.
            </div>
          )}

          {mostraSelfie && (
            <div style={{ marginTop: 20, borderTop: '1px dashed #d9dde3', paddingTop: 16, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, color: NAVY, fontSize: 14.5, marginBottom: 4 }}>📸 Um passo extra de segurança (opcional)</div>
              <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 10px' }}>
                Se quiser, envie uma selfie sua agora: ela serve como prova adicional de que foi você quem assinou.
                <b> Sua assinatura já está valendo</b> — este passo é opcional. A foto fica guardada apenas com o
                escritório, para sua proteção (LGPD), e não aparece na sua cópia do documento.
              </p>
              {selfie.preview && <img src={selfie.preview} alt="Prévia da selfie" style={{ width: '100%', maxWidth: 220, borderRadius: 10, display: 'block', margin: '0 auto 10px' }} />}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <label style={{ background: '#eef1f5', border: '1px solid #d9dde3', borderRadius: 22, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
                  {selfie.preview ? 'Tirar outra' : 'Tirar/escolher selfie'}
                  <input type="file" accept="image/*" capture="user" onChange={aoEscolherFoto} style={{ display: 'none' }} />
                </label>
                {selfie.fase === 'pronta' && (
                  <button onClick={enviarSelfie} style={{ background: '#1f7a44', color: '#fff', border: 0, borderRadius: 22, padding: '10px 20px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                    Enviar selfie
                  </button>
                )}
                {selfie.fase === 'enviando' && <span style={{ fontSize: 13, color: '#5b6673', alignSelf: 'center' }}>Enviando…</span>}
              </div>
              {selfie.fase === 'erro' && <p style={{ fontSize: 12.5, color: '#b3261e', marginTop: 8 }}>{selfie.msg}</p>}
            </div>
          )}

          {(estado.fase === 'ok' || estado.fase === 'ja') && (
            <p style={{ fontSize: 12, color: '#8a94a3', marginTop: 18 }}>
              Crispim, Mendonça e Pinheiro Advogados · 0800 591 7259
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
