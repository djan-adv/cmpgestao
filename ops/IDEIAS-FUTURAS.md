# Ideias futuras (guardadas para retomar depois)

## 1. Portal de documentos do cliente (upload sem senha) — SUSPENSO
Link de upload para o cliente mandar fotos/PDFs direto para a pasta do caso,
sem app/login. Recomendação de segurança: link único e secreto por caso
(token), com o e-mail como identificador do cliente; arquivos caindo numa
"caixa de entrada" do caso para triagem. Exige rota nova de servidor
(/api/upload-cliente) + página pública + registro no banco (rastreabilidade).
Deploy exige build/restart no VPS (não só o botão Publicar).

## 2. Captura de lead pelo WhatsApp Business — SUSPENSO (retomar depois)
Atalho do próprio advogado para capturar o lead na hora, direto do WhatsApp
Business, sem o cliente perceber. Ideia: resposta rápida "/lead" (ou
"/boasvindas") que (a) manda uma mensagem de boas-vindas ao cliente e
(b) inclui, para o advogado, um link de captura que abre o Comercial já no
formulário "Novo lead" com canal=WhatsApp e campos prontos/pré-preenchidos.
Link do tipo: .../sistema.html#novolead?nome=...&tel=...
Pontos a definir ao retomar: link é para o advogado abrir (captura rápida) ou
para o cliente clicar; e se os dados vão digitados no form ou já no link.
