'use client'
// Tela PÚBLICA de CONFIRMAÇÃO da assinatura (dupla verificação por e-mail).
// Após assinar, o cliente recebe um e-mail com o botão "Confirmar minha assinatura",
// que abre esta página (?d=documento&s=token). Aqui registramos a confirmação e
// avisamos o escritório (equivalente ao confirmar.html do site antigo).
import { useEffect, useState } from 'react'
import { signSb } from '../../../lib/supabaseAssinatura'

const NAVY = '#2E3A4B'

export default function ConfirmarAssinatura() {
  const [estado, setEstado] = useState({ fase: 'carregando' }) // carregando | ok | ja | erro

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const tok = q.get('s')
    if (!tok) { setEstado({ fase: 'erro', msg: 'Link inválido.' }); return }
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

  const icone = { carregando: '⏳', ok: '✅', ja: '✅', erro: '⚠️' }[estado.fase]
  const titulo = {
    carregando: 'Confirmando sua assinatura…',
    ok: 'Assinatura confirmada!',
    ja: 'Assinatura já confirmada',
    erro: 'Não foi possível confirmar',
  }[estado.fase]
  const texto = {
    carregando: 'Aguarde um instante.',
    ok: 'Obrigado! Sua confirmação reforça a segurança do documento' + (estado.titulo ? ' "' + estado.titulo + '"' : '') + '. Você já pode fechar esta página.',
    ja: 'Esta assinatura já havia sido confirmada antes' + (estado.titulo ? ' para o documento "' + estado.titulo + '"' : '') + '. Nenhuma ação é necessária.',
    erro: estado.msg || 'Link inválido.',
  }[estado.fase]

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7', fontFamily: "'Segoe UI',system-ui,Arial,sans-serif" }}>
      <header style={{ background: NAVY, color: '#fff', padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>CMP Advogados · Assinatura eletrônica</div>
        <div style={{ marginLeft: 'auto', fontSize: 11, background: 'rgba(255,255,255,.12)', padding: '6px 10px', borderRadius: 20 }}>🔒 Dupla verificação</div>
      </header>
      <div style={{ maxWidth: 440, margin: '60px auto', padding: '0 16px' }}>
        <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 28, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>{icone}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 17, color: NAVY }}>{titulo}</h2>
          <p style={{ fontSize: 14, color: '#5b6673', margin: 0 }}>{texto}</p>
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
