'use client'
// Carga inicial por arquivo JSON — ferramenta interna, de uso único.
//
// Ela LIMPA os processos do escritório antes de inserir. Isso fazia sentido
// quando o sistema era de um escritório só e a carga era feita uma vez, à mão.
// Num sistema vendido é uma armadilha: qualquer pessoa logada de um escritório
// cliente chegava a este endereço e apagava o acervo inteiro sem confirmação
// nenhuma. Agora só a raiz abre; escritório cliente é mandado para a área de
// migração, que confere antes, não apaga nada e pode ser desfeita.
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Importar() {
  const router = useRouter()
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [liberado, setLiberado] = useState(null)   // null = ainda checando
  const add = (m) => setLog((l) => [...l, m])

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) { router.push('/'); return }
      const { data: perfil } = await supabase
        .from('usuarios').select('escritorio_id').eq('id', s.session.user.id).maybeSingle()
      if (!perfil?.escritorio_id) { setLiberado(false); return }
      const { data: esc } = await supabase
        .from('escritorios').select('raiz').eq('id', perfil.escritorio_id).maybeSingle()
      setLiberado(esc?.raiz === true)
    })()
  }, [router])

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

  if (liberado === null) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#697180' }}>Carregando…</div>
  }
  if (!liberado) {
    return (
      <div style={{ maxWidth: 620, margin: '40px auto', padding: 24, background: '#fff', borderRadius: 12, border: '1px solid #e4e8ef' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#2E3A4B' }}>Para trazer o seu acervo, use a área de migração</div>
        <p style={{ fontSize: 13.5, color: '#697180', lineHeight: 1.6 }}>
          Lá você envia a planilha exportada do sistema que usa hoje (CSV ou XLSX), confere
          o que vai entrar antes de gravar e pode desfazer depois. Esta página é uma
          ferramenta interna antiga, que substitui o acervo em vez de completá-lo.
        </p>
        <button onClick={() => router.push('/migracao')}
          style={{ background: '#2E3A4B', color: '#fff', border: 0, borderRadius: 8, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>
          Ir para a migração de acervo
        </button>
      </div>
    )
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
