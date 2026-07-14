# Padrão de formatação (.docx)

## Padrão do escritório (versão tradicional)
- Fonte **Barlow** em todo o corpo.
- Texto **justificado**.
- Entrelinha **360** (line, lineRule auto).
- Recuo de **primeira linha 709 twips**.
- Blocos de **citação**: recuo esquerdo **2268 twips**, **itálico**, tamanho **22**
  (`w:sz val="22"`); corpo geral em tamanho **24** (12pt).
- Página A4; timbre com logo + marca d'água + rodapé de contato (do `template_cmp.docx`).
- **Todas as peças levam timbre**, inclusive a réplica (correção da regra antiga "réplicas
  sem timbre").

## Versão legal design (tipografia jurídica)
Mesmo conteúdo, com hierarquia visual e ergonomia cognitiva:
- **Banners de seção**: parágrafo com fundo navy e texto branco em negrito
  (`<w:shd w:fill="2E3A4B"/>` + `<w:color w:val="FFFFFF"/>`).
- **Subtítulos**: cor navy + borda inferior fina (`pBdr/bottom`).
- **Caixa de síntese / callout**: fundo claro + **borda esquerda** de acento
  (`pBdr/left`, navy ou dourado).
- **Ementas em caixa**: fundo `EEF1F5` + borda esquerda navy; o trecho on-point recebe
  **grifo em destaque** (run com `<w:shd w:fill="FFF1A8"/>` + negrito).
- **Citações de lei** em caixa clara com borda esquerda.
- **Imagem-prova** centralizada, com legenda em itálico menor.
- Mais respiro (espaçamentos um pouco maiores).

## Tokens de cor (legal design)
- NAVY (banners/bordas/acento): `2E3A4B`
- Fundo claro de caixa: `EEF1F5` / `F6F8FB`
- Grifo (destaque on-point): `FFF1A8`
- Borda dourada de callout: `C9A227`
- Filete de subtítulo: `C7D0DA`

## Diferença de grifo entre versões
- Tradicional: grifo = **negrito + sublinhado**.
- Legal design: grifo = **negrito + realce amarelo** (`shd FFF1A8`).
