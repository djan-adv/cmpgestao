# Projeto — Gestão Financeira (Banco Cora + NFS-e João Pessoa)

> Status: **ideia aprovada, a fazer no futuro** (não iniciado).
> Objetivo: um módulo "Gestão Financeira" no CMPGestão que emita/receba
> **boletos e PIX** pelo **Banco Cora** e, ao receber um pagamento, permita
> **emitir a NFS-e** (nota fiscal de serviço de João Pessoa) com uma confirmação
> rápida "Emitir nota fiscal? Sim / Não".

---

## 1. Visão geral do fluxo
1. Emissão/cobrança de **boleto ou PIX** por cliente/processo (via API do Cora).
2. O Cora envia um **webhook** ao nosso backend quando o boleto é **pago** ou o
   **PIX cai**.
3. O sistema mostra um aviso: **"Emitir nota fiscal para este pagamento? Sim/Não"**.
4. No **Sim**, o backend chama a API de NFS-e (intermediário), emite a nota e
   guarda **PDF/XML** vinculados ao pagamento e ao processo.

---

## 2. Banco Cora — integração
- Requer o plano **CoraPro** (~R$ 44,90/mês) para liberar a API.
- Autenticação por **certificado** gerado no app do Cora: par **`.PEM` + `.KEY`**.
  Com ele o backend gera um **token** (renovado automaticamente).
- Capacidades usadas: criar **boleto/PIX (QR)**, consultar **extrato/transações**,
  e principalmente **webhooks** de pagamento (`invoice.paid` / PIX recebido).
- Portais: https://developers.cora.com.br/ e https://www.cora.com.br/integracoes/
- **Segredos ficam só no servidor (VPS)** — nunca no navegador.

## 3. NFS-e João Pessoa — integração
- Emitir direto no webservice da Prefeitura é instável; usar **intermediário**:
  - **Focus NFe** (recomendado p/ começar — já cobre João Pessoa-PB) —
    https://focusnfe.com.br/ · doc: https://doc.focusnfe.com.br/reference/emitir_nfse
  - **PlugNotas** (alternativa; já no padrão nacional NFS-e) — https://plugnotas.com.br/nfse/
- Precisa de **e-CNPJ A1** do escritório + dados fiscais: inscrição municipal,
  **código do serviço** (advocacia ~ item 17.x da LC 116), regime tributário/ISS.
- Envio em **JSON**; o intermediário cuida da **assinatura digital** e da
  comunicação com a prefeitura, devolvendo **PDF/XML**.

---

## 4. Arquitetura no CMPGestão
- **Botão "Gestão Financeira"** no menu lateral, com **acesso restrito**
  (mesmo mecanismo de coordenador já usado em "acessos"; só quem for liberado vê).
- **Backend (Next.js `app/api/*`)**:
  - `/api/cora` — token (mTLS/cert), criar boleto/PIX, listar extrato.
  - `/api/cora/webhook` — recebe "pago"/"PIX recebido", registra pagamento.
  - `/api/nfse` — emitir/consultar/cancelar nota via intermediário.
  - Segredos em variáveis de ambiente no VPS (`CORA_CERT`, `CORA_KEY`,
    `NFSE_TOKEN`, etc.). Deploy exige rebuild (`npm run build` + `pm2 restart`).
- **Banco (Supabase)** — tabelas novas (rascunho):
  - `cobrancas` (id, processo_id, cliente, tipo boleto/pix, valor, vencimento,
    status, cora_id, link, criado_em, pago_em)
  - `notas_fiscais` (id, cobranca_id, processo_id, valor, status, nfse_id,
    pdf_url, xml_url, emitida_em)
- **Front (`public/sistema.html`)**: seção "Gestão Financeira" com lista de
  cobranças, botão "nova cobrança", e o card de confirmação "Emitir NF? Sim/Não"
  quando cai um pagamento.

---

## 5. Segurança / LGPD
- Chaves do Cora e certificado da NFS-e **somente no servidor**.
- Acesso ao painel financeiro limitado (coordenador + autorizados).
- Registrar quem emitiu cada nota (auditoria).

## 6. Custos aproximados
- Cora API (CoraPro): ~R$ 44,90/mês.
- Intermediário NFS-e (Focus/PlugNotas): plano por nota/mês (começa barato).
- Certificado e-CNPJ A1: ~R$ 200/ano.

---

## 7. Fases sugeridas (sempre homologação/sandbox primeiro)
1. **Estrutura + leitura Cora:** botão "Gestão Financeira" (acesso restrito) e
   conexão de leitura (extrato/transações) em homologação.
2. **Cobrança:** criar boleto/PIX pelo sistema.
3. **Webhook "pago":** receber e registrar o pagamento; mostrar aviso.
4. **NFS-e:** emissão com confirmação "Sim/Não"; guardar PDF/XML.
5. **Produção:** liberar com um boleto real de teste e conferência.

## 8. Preciso de você para iniciar
1. **Cora:** confirmar CoraPro ativo (conta PJ) e gerar o certificado da API.
2. **NFS-e:** escolher intermediário (sugestão: **Focus NFe**), ter **e-CNPJ A1**
   e os dados fiscais (inscrição municipal, código do serviço, regime).
3. Definir **quem** terá acesso ao painel financeiro.

## 9. Decisões em aberto
- Focus NFe x PlugNotas.
- Emitir NFS-e automática ou sempre com confirmação manual (hoje: manual "Sim/Não").
- Vincular cada cobrança a um processo/cliente obrigatoriamente?
- Régua de cobrança (lembretes automáticos antes/depois do vencimento)?
