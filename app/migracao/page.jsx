'use client'
// Migrar o acervo de outro sistema — a tela.
//
// Quem chega aqui está saindo de outro produto e trouxe uma planilha. Ele não
// sabe (nem tem que saber) o nome das colunas do banco. Então a tela é uma
// conversa em três passos: o que tem no arquivo, para onde vai cada coluna, e o
// que vai acontecer se ele confirmar. Só o terceiro botão grava.
//
// A marca é a do escritório de quem está logado — esta tela é vendida, e o
// escritório que migra o acervo dele não pode ver a marca de outro escritório
// de advocacia no topo.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const NAVY = '#2E3A4B'
const LINHA = '#e4e8ef'
const CINZA = '#697180'

export default function Migracao() {
  const [marca, setMarca] = useState(null)
  const [embutido, setEmbutido] = useState(false)
  const [campos, setCampos] = useState([])
  const [historico, setHistorico] = useState([])
  const [plano, setPlano] = useState(null)
  const [podeEntrar, setPodeEntrar] = useState(null)   // null = ainda checando

  const [arquivo, setArquivo] = useState(null)
  const [analise, setAnalise] = useState(null)         // colunas + amostra + mapa sugerido
  const [mapa, setMapa] = useState({})
  const [conferencia, setConferencia] = useState(null)
  const [resultado, setResultado] = useState(null)
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')

  const [lote, setLote] = useState('')
  const [repetidos, setRepetidos] = useState('completar')
  const [criarContatos, setCriarContatos] = useState(true)

  async function token() {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ''
  }

  const carregar = useCallback(async () => {
    const t = await token()
    if (!t) { window.location.href = '/'; return }
    const r = await fetch('/api/migracao', { headers: { Authorization: 'Bearer ' + t } })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setPodeEntrar(false); setErro(d.erro || 'Sem permissão.'); return }
    setPodeEntrar(true)
    setCampos(d.campos || [])
    setHistorico(d.historico || [])
    setPlano(d.plano || null)
  }, [])

  useEffect(() => {
    try { setEmbutido(new URLSearchParams(window.location.search).get('embed') === '1') } catch (e) {}
    fetch('/api/inquilino').then(r => r.json()).then(d => setMarca(d && d.ok ? d : null)).catch(() => {})
    carregar()
  }, [carregar])

  // O nome do lote sugerido sai do dia, não do nome de nenhum escritório.
  useEffect(() => {
    if (!lote) {
      const h = new Date()
      setLote('Acervo migrado ' + String(h.getDate()).padStart(2, '0') + '/' +
              String(h.getMonth() + 1).padStart(2, '0') + '/' + h.getFullYear())
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function enviar(acao, extra) {
    const t = await token()
    const fd = new FormData()
    fd.append('arquivo', arquivo)
    fd.append('acao', acao)
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    const r = await fetch('/api/migracao', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.erro) throw new Error(d.erro || 'Falhou.')
    return d
  }

  async function analisar(f) {
    setErro(''); setAnalise(null); setConferencia(null); setResultado(null)
    setArquivo(f)
    if (!f) return
    setOcupado('Lendo a planilha…')
    try {
      const t = await token()
      const fd = new FormData()
      fd.append('arquivo', f); fd.append('acao', 'analisar')
      const r = await fetch('/api/migracao', { method: 'POST', headers: { Authorization: 'Bearer ' + t }, body: fd })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.erro) throw new Error(d.erro || 'Não consegui ler o arquivo.')
      setAnalise(d)
      setMapa(d.mapa || {})
    } catch (e) { setErro(e.message) }
    setOcupado('')
  }

  async function conferir() {
    setErro(''); setConferencia(null); setResultado(null)
    setOcupado('Conferindo…')
    try { setConferencia(await enviar('conferir', { mapa: JSON.stringify(mapa) })) }
    catch (e) { setErro(e.message) }
    setOcupado('')
  }

  async function importar() {
    setErro(''); setOcupado('Importando… não feche esta janela.')
    try {
      const d = await enviar('importar', {
        mapa: JSON.stringify(mapa),
        opcoes: JSON.stringify({ lote: lote.trim(), repetidos, contatos: criarContatos }),
      })
      setResultado(d); setConferencia(null)
      carregar()
    } catch (e) { setErro(e.message) }
    setOcupado('')
  }

  async function desfazer(id) {
    if (!window.confirm('Desfazer esta migração apaga as fichas que ela criou e que ninguém movimentou depois. As que já foram trabalhadas ficam. Confirma?')) return
    setErro(''); setOcupado('Desfazendo…')
    try {
      const t = await token()
      const r = await fetch('/api/migracao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ acao: 'desfazer', id }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falhou.')
      setResultado(null)
      window.alert('Desfeito: ' + d.apagados + ' ficha(s) apagada(s).' +
        (d.mantidos ? ' ' + d.mantidos + ' ficaram porque já tinham movimentação.' : ''))
      carregar()
    } catch (e) { setErro(e.message) }
    setOcupado('')
  }

  const cor = (marca && marca.marca && marca.marca.cor) || NAVY
  const nomeCasa = (marca && marca.conhecido && marca.nome) || ''

  if (podeEntrar === false) {
    return (
      <Moldura cor={cor} nomeCasa={nomeCasa} embutido={embutido}>
        <div style={card}>
          <b>Esta área é do contratante e dos sócios.</b>
          <p style={{ color: CINZA, fontSize: 13 }}>{erro}</p>
        </div>
      </Moldura>
    )
  }

  return (
    <Moldura cor={cor} nomeCasa={nomeCasa} embutido={embutido}>
      <div style={card}>
        <p style={{ marginTop: 0, color: CINZA, fontSize: 13.5, lineHeight: 1.6 }}>
          Traga o acervo do sistema que você usa hoje. Exporte a lista de processos em
          <b> CSV</b> ou <b>XLSX</b> e envie o arquivo aqui — não precisa arrumar as colunas antes,
          o sistema mostra o que entendeu e você corrige. Nada é gravado até você confirmar,
          e o que for importado pode ser desfeito.
        </p>
        {plano && plano.limite_processos != null && (
          <p style={{ fontSize: 12.5, color: CINZA, margin: '0 0 10px' }}>
            Seu plano comporta {plano.limite_processos.toLocaleString('pt-BR')} processos.
            Hoje você usa {plano.usados.toLocaleString('pt-BR')}.
          </p>
        )}

        <label style={rotulo}>1. A planilha</label>
        <input type="file" accept=".csv,.txt,.xlsx,.xlsm" disabled={!!ocupado}
          onChange={e => analisar(e.target.files?.[0] || null)}
          style={{ display: 'block', margin: '6px 0 4px' }} />
        <div style={{ fontSize: 12, color: CINZA }}>
          Até 20 MB e 20 mil linhas por vez. Se o arquivo for .xls antigo, abra no Excel e salve como .xlsx.
        </div>
      </div>

      {erro && <div style={{ ...card, borderLeft: '4px solid #b5342b', color: '#b5342b' }}>{erro}</div>}
      {ocupado && <div style={{ ...card, color: cor, fontWeight: 600 }}>{ocupado}</div>}

      {/* ---- passo 2: de onde para onde -------------------------------- */}
      {analise && (
        <div style={card}>
          <label style={rotulo}>2. Para onde vai cada coluna</label>
          <p style={{ fontSize: 12.5, color: CINZA, margin: '4px 0 12px' }}>
            {analise.total.toLocaleString('pt-BR')} linhas em <b>{analise.arquivo}</b>.
            O que está marcado abaixo é um palpite pelo nome da coluna — confira, principalmente
            os valores e as datas. O que você deixar em <i>não importar</i> simplesmente não entra.
          </p>
          <div style={{ overflowX: 'auto', border: '1px solid ' + LINHA, borderRadius: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={th}>Coluna da planilha</th>
                  <th style={th}>Vai para</th>
                  <th style={th}>Exemplo do arquivo</th>
                </tr>
              </thead>
              <tbody>
                {analise.colunas.map((c, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontWeight: 600 }}>{c}</td>
                    <td style={td}>
                      <select value={mapa[i] || ''} onChange={e => {
                        const v = e.target.value
                        setMapa(m => {
                          const novo = { ...m }
                          // um campo do sistema só pode vir de uma coluna
                          if (v) for (const k of Object.keys(novo)) if (novo[k] === v) delete novo[k]
                          if (v) novo[i] = v; else delete novo[i]
                          return novo
                        })
                        setConferencia(null)
                      }} style={selectEstilo}>
                        <option value="">— não importar —</option>
                        {campos.map(f => (
                          <option key={f.chave} value={f.chave}>
                            {f.rotulo}{f.obrigatorio ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...td, color: CINZA }}>
                      {(analise.amostra || []).slice(0, 3).map(l => l[i]).filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14, marginTop: 16 }}>
            <div>
              <label style={rotulo}>Separar num lote</label>
              <input value={lote} onChange={e => setLote(e.target.value)} style={campoTexto}
                placeholder="deixe vazio para não separar" />
              <div style={ajuda}>Um lote só para o acervo migrado facilita conferir depois.</div>
            </div>
            <div>
              <label style={rotulo}>Processo que já existe aqui</label>
              <select value={repetidos} onChange={e => setRepetidos(e.target.value)} style={campoTexto}>
                <option value="completar">Completar só o que está em branco</option>
                <option value="pular">Não mexer</option>
                <option value="substituir">Substituir pelo que veio na planilha</option>
              </select>
              <div style={ajuda}>Em nenhuma opção uma célula vazia da planilha apaga o que já está na ficha.</div>
            </div>
            <div>
              <label style={rotulo}>Clientes</label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 6 }}>
                <input type="checkbox" checked={criarContatos} onChange={e => setCriarContatos(e.target.checked)} />
                <span>Cadastrar os clientes da planilha na agenda de contatos</span>
              </label>
              <div style={ajuda}>Casa pelo CPF/CNPJ quando houver; quem já estiver cadastrado não vira cópia.</div>
            </div>
          </div>

          <button onClick={conferir} disabled={!!ocupado} style={{ ...botao, background: cor, marginTop: 16 }}>
            Conferir antes de importar
          </button>
        </div>
      )}

      {/* ---- passo 3: o que vai acontecer ------------------------------- */}
      {conferencia && (
        <div style={card}>
          <label style={rotulo}>3. O que vai acontecer</label>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '10px 0 4px' }}>
            <Numero n={conferencia.novos} rot="processos novos" cor="#0F6E56" />
            <Numero n={conferencia.ja_existem} rot="já existem aqui" cor={cor} />
            <Numero n={conferencia.recusadas_total} rot="fora da importação" cor={conferencia.recusadas_total ? '#8a6d00' : CINZA} />
            {criarContatos && <Numero n={conferencia.contatos_possiveis} rot="clientes com dados" cor={cor} />}
          </div>

          {!conferencia.plano.cabe && (
            <div style={{ background: '#fdf1f0', border: '1px solid #f0c9c5', color: '#b5342b', padding: 12, borderRadius: 8, fontSize: 13, margin: '10px 0' }}>
              Isso passaria do limite do seu plano ({conferencia.plano.limite_processos.toLocaleString('pt-BR')} processos,
              {' '}{conferencia.plano.usados.toLocaleString('pt-BR')} em uso). A importação não vai deixar gravar pela metade —
              aumente o plano ou divida a planilha.
            </div>
          )}

          {conferencia.recusadas_total > 0 && (
            <details style={{ margin: '10px 0' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#8a6d00' }}>
                {conferencia.recusadas_total} linha(s) não entram — ver por quê
              </summary>
              <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8, fontSize: 12.5 }}>
                {conferencia.recusadas.map((r, i) => (
                  <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid ' + LINHA }}>
                    <b>linha {r.linha}</b> — {r.motivo}{r.amostra ? ' · ' + r.amostra : ''}
                  </div>
                ))}
              </div>
            </details>
          )}

          <details open style={{ margin: '10px 0' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Prévia — as primeiras fichas como vão ficar
            </summary>
            <div style={{ overflowX: 'auto', marginTop: 8, border: '1px solid ' + LINHA, borderRadius: 8 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead><tr>{colunasPrevia(conferencia.previa).map(c => <th key={c} style={th}>{rotuloDe(campos, c)}</th>)}</tr></thead>
                <tbody>
                  {conferencia.previa.map((p, i) => (
                    <tr key={i}>{colunasPrevia(conferencia.previa).map(c => (
                      <td key={c} style={td}>{String(p[c] == null ? '' : p[c])}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <button onClick={importar} disabled={!!ocupado || !conferencia.plano.cabe}
            style={{ ...botao, background: conferencia.plano.cabe ? '#0F6E56' : '#b9c0cb' }}>
            Importar {conferencia.novos.toLocaleString('pt-BR')} processo(s)
          </button>
        </div>
      )}

      {resultado && (
        <div style={{ ...card, borderLeft: '4px solid #0F6E56' }}>
          <b style={{ color: '#0F6E56' }}>Pronto.</b>
          <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.7 }}>
            {resultado.criados.toLocaleString('pt-BR')} ficha(s) criada(s)
            {resultado.atualizados ? ', ' + resultado.atualizados + ' completada(s)' : ''}
            {resultado.contatos ? ', ' + resultado.contatos + ' cliente(s) na agenda' : ''}
            {resultado.lote ? '. Tudo no lote "' + resultado.lote + '"' : ''}.
            {resultado.recusadas_total ? ' ' + resultado.recusadas_total + ' linha(s) ficaram de fora.' : ''}
          </div>
          {resultado.erros && resultado.erros.length > 0 && (
            <div style={{ color: '#b5342b', fontSize: 12.5, marginTop: 8 }}>
              Alguns blocos falharam: {resultado.erros.join(' · ')}
            </div>
          )}
          {resultado.migracao_id && (
            <button onClick={() => desfazer(resultado.migracao_id)} style={{ ...botao, background: '#fff', color: '#b5342b', border: '1px solid #f0c9c5', marginTop: 12 }}>
              Desfazer esta importação
            </button>
          )}
        </div>
      )}

      {/* ---- histórico -------------------------------------------------- */}
      {historico.length > 0 && (
        <div style={card}>
          <label style={rotulo}>Importações anteriores</label>
          <div style={{ marginTop: 8 }}>
            {historico.map(h => (
              <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid ' + LINHA, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600 }}>{h.arquivo}</span>
                <span style={{ color: CINZA }}>
                  {new Date(h.criado_em).toLocaleString('pt-BR')} · {h.criado_por_nome || '—'} ·
                  {' '}{h.criados} criada(s), {h.atualizados} completada(s)
                </span>
                {h.desfeita_em
                  ? <span style={{ marginLeft: 'auto', color: CINZA }}>desfeita — {h.desfeitos} apagada(s)</span>
                  : <button onClick={() => desfazer(h.id)} disabled={!!ocupado}
                      style={{ marginLeft: 'auto', background: 'none', border: '1px solid ' + LINHA, borderRadius: 6, padding: '3px 9px', cursor: 'pointer', color: '#b5342b', fontSize: 12 }}>
                      Desfazer
                    </button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Moldura>
  )
}

// ---------------------------------------------------------------------------
function Moldura({ cor, nomeCasa, embutido, children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f3f5f8' }}>
      {!embutido && (
        <header style={{ background: cor, color: '#fff', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{nomeCasa ? nomeCasa + ' · ' : ''}Migrar acervo</div>
          <a href="/sistema.html" style={{ marginLeft: 'auto', color: '#cdd9ea', fontSize: 12.5 }}>← voltar ao sistema</a>
        </header>
      )}
      <div style={{ maxWidth: 980, margin: '0 auto', padding: embutido ? '14px 16px 40px' : '20px 16px 40px' }}>
        {children}
      </div>
    </div>
  )
}

function Numero({ n, rot, cor }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 800, color: cor, lineHeight: 1 }}>{Number(n || 0).toLocaleString('pt-BR')}</div>
      <div style={{ fontSize: 12, color: CINZA }}>{rot}</div>
    </div>
  )
}

// colunas da prévia: as que realmente têm conteúdo, na ordem em que chegaram
function colunasPrevia(previa) {
  const cols = []
  for (const p of previa || []) {
    for (const k of Object.keys(p)) {
      if (k === 'linha' || k === '_cliente' || k === 'numero_digitos') continue
      if (!cols.includes(k)) cols.push(k)
    }
  }
  return cols
}

function rotuloDe(campos, chave) {
  const c = campos.find(x => x.chave === chave)
  return c ? c.rotulo : chave
}

const card = { background: '#fff', border: '1px solid ' + LINHA, borderRadius: 12, padding: 18, marginBottom: 14 }
const rotulo = { fontSize: 12, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: .4 }
const ajuda = { fontSize: 11.5, color: CINZA, marginTop: 4, lineHeight: 1.5 }
const th = { textAlign: 'left', padding: '7px 10px', background: '#f7f9fc', borderBottom: '1px solid ' + LINHA, whiteSpace: 'nowrap', fontSize: 12 }
const td = { padding: '6px 10px', borderBottom: '1px solid ' + LINHA, verticalAlign: 'top', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const campoTexto = { width: '100%', padding: 9, border: '1px solid ' + LINHA, borderRadius: 8, boxSizing: 'border-box', fontSize: 13, marginTop: 6 }
const selectEstilo = { padding: 6, border: '1px solid ' + LINHA, borderRadius: 6, fontSize: 12.5, minWidth: 210 }
const botao = { color: '#fff', border: 0, borderRadius: 8, padding: '11px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }
