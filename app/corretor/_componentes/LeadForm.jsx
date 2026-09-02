'use client'
import { useState } from 'react'
import { COR } from './tema'

const campo = { width: '100%', padding: 11, border: `1px solid ${COR.borda}`, borderRadius: 8, boxSizing: 'border-box', fontSize: 14.5, fontFamily: 'inherit' }
const rotulo = { fontSize: 12.5, color: COR.textoSuave, display: 'block', margin: '0 0 4px' }

export default function LeadForm({ tipo, imovelId, tituloEnderecoImovel, tituloBotao = 'Enviar', mensagemPlaceholder = 'Como posso ajudar?' }) {
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [enderecoImovel, setEnderecoImovel] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [status, setStatus] = useState('idle') // idle | enviando | ok | erro
  const [erroMsg, setErroMsg] = useState('')

  async function enviar(e) {
    e.preventDefault()
    setStatus('enviando'); setErroMsg('')
    try {
      const r = await fetch('/api/imoveis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao: 'lead', tipo, nome, telefone, email,
          imovel_id: imovelId || undefined,
          endereco_imovel: enderecoImovel || undefined,
          mensagem,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setStatus('erro'); setErroMsg(d.erro || 'Não foi possível enviar. Tente novamente.'); return }
      setStatus('ok')
    } catch (e) {
      setStatus('erro'); setErroMsg('Falha de conexão. Tente novamente.')
    }
  }

  if (status === 'ok') {
    return (
      <div style={{ background: COR.destaqueClaro, border: `1px solid ${COR.destaque}`, borderRadius: 10, padding: 18, color: COR.escuro, fontSize: 14.5 }}>
        Recebido! Retorno em breve pelo telefone ou e-mail informado.
      </div>
    )
  }

  return (
    <form onSubmit={enviar} style={{ display: 'grid', gap: 12 }}>
      <div>
        <label style={rotulo}>Nome</label>
        <input style={campo} value={nome} onChange={e => setNome(e.target.value)} required />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={rotulo}>Telefone / WhatsApp</label>
          <input style={campo} value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(00) 00000-0000" />
        </div>
        <div>
          <label style={rotulo}>E-mail</label>
          <input style={campo} type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
      </div>
      {(tipo === 'avaliacao' || tipo === 'certidao') && (
        <div>
          <label style={rotulo}>{tituloEnderecoImovel || 'Endereço do imóvel'}</label>
          <input style={campo} value={enderecoImovel} onChange={e => setEnderecoImovel(e.target.value)} />
        </div>
      )}
      <div>
        <label style={rotulo}>Mensagem</label>
        <textarea style={{ ...campo, minHeight: 90, resize: 'vertical' }} value={mensagem} onChange={e => setMensagem(e.target.value)} placeholder={mensagemPlaceholder} />
      </div>
      {status === 'erro' && <div style={{ color: COR.erro, fontSize: 13.5 }}>{erroMsg}</div>}
      <button type="submit" disabled={status === 'enviando'}
        style={{ padding: '12px 18px', background: COR.escuro, color: COR.branco, border: 0, borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
        {status === 'enviando' ? 'Enviando…' : tituloBotao}
      </button>
    </form>
  )
}
