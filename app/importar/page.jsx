'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Importar() {
  const router = useRouter()
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const add = (m) => setLog((l) => [...l, m])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setLog([])
    try {
      add('Lendo o arquivo…')
      const data = JSON.parse(await file.text())
      const procs = data.processos || []
      add(procs.length + ' processos no arquivo.')

      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) { add('Você não está logado — faça login antes.'); setBusy(false); return }
      const { data: perfil } = await supabase.from('usuarios').select('escritorio_id').eq('id', userData.user.id).single()
      const esc = perfil?.escritorio_id
      if (!esc) { add('Escritório não encontrado para o seu usuário. Rode o SQL de vínculo primeiro.'); setBusy(false); return }

      add('Limpando processos anteriores (para reimportar do zero)…')
      const del = await supabase.from('processos').delete().eq('escritorio_id', esc)
      if (del.error) { add('Erro ao limpar: ' + del.error.message); setBusy(false); return }

      const mapId = {}
      const procRows = procs.map((p) => ({
        escritorio_id: esc,
        numero: p.numero,
        cliente_nome: p.cliente_nome || null,
        oponente: p.oponente || null,
        assunto: p.assunto || null,
        classe: p.classe || null,
        orgao: p.orgao || null,
        foro: p.foro || null,
        status: p.status || null,
        valor_causa: p.valor_causa ?? null,
        ultima_movimentacao: p.ultima_movimentacao || null,
        fonte: 'astrea',
      }))
      const B = 500
      let done = 0
      for (let i = 0; i < procRows.length; i += B) {
        const chunk = procRows.slice(i, i + B)
        const { data: ins, error } = await supabase.from('processos').insert(chunk).select('id, numero')
        if (error) { add('Erro ao inserir processos: ' + error.message); setBusy(false); return }
        ins.forEach((r) => { mapId[r.numero] = r.id })
        done += chunk.length
        add('Processos: ' + done + '/' + procRows.length)
      }

      const andRows = []
      for (const p of procs) {
        const pid = mapId[p.numero]
        if (!pid) continue
        for (const a of (p.andamentos || [])) {
          if (!a.texto) continue
          andRows.push({ processo_id: pid, data: a.data || null, texto: a.texto, fonte: 'datajud' })
        }
      }
      add(andRows.length + ' andamentos para inserir…')
      let ad = 0
      for (let i = 0; i < andRows.length; i += 1000) {
        const chunk = andRows.slice(i, i + 1000)
        const { error } = await supabase.from('andamentos').insert(chunk)
        if (error) { add('Erro ao inserir andamentos: ' + error.message); setBusy(false); return }
        ad += chunk.length
        add('Andamentos: ' + ad + '/' + andRows.length)
      }
      add('✅ Importação concluída! ' + done + ' processos e ' + ad + ' andamentos.')
    } catch (err) {
      add('Falha: ' + err.message)
    }
    setBusy(false)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>CMP<span style={{ color: '#c8a24a' }}>Gestão</span> · Importar dados</div>
        <button onClick={() => router.push('/painel')} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Ir ao painel</button>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, padding: 20 }}>
        <p style={{ fontSize: 14, color: '#475569', marginTop: 0 }}>
          Selecione o arquivo <b>cmp_dados_importar.json</b> do seu computador. Os dados vão direto para o seu banco (isolado por escritório). Reimportar substitui os processos anteriores.
        </p>
        <input type="file" accept="application/json,.json" disabled={busy} onChange={handleFile}
          style={{ display: 'block', margin: '10px 0 16px' }} />
        <div style={{ background: '#0b1220', color: '#a7f3d0', fontFamily: 'ui-monospace, monospace', fontSize: 12, borderRadius: 8, padding: 12, minHeight: 120, maxHeight: 360, overflowY: 'auto' }}>
          {log.length === 0 ? <span style={{ color: '#64748b' }}>Aguardando o arquivo…</span> : log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
    </div>
  )
}
