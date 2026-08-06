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

## 3. Gestão Financeira (Banco Cora + NFS-e João Pessoa) — A FAZER
Módulo com botão "Gestão Financeira" (acesso restrito): boletos/PIX pelo Banco
Cora, webhook de pagamento e emissão de NFS-e de João Pessoa via intermediário
(Focus NFe/PlugNotas), com confirmação "Emitir nota fiscal? Sim/Não".
Especificação completa (arquitetura, fases, segurança, custos e o que é preciso
para iniciar) em **ops/PROJETO-GESTAO-FINANCEIRA.md**.

## 4. Produto multi-empresa (SaaS / white-label) — VISÃO REGISTRADA
Transformar o CMPGestão numa raiz única que atende vários escritórios, cada um
com domínio/marca/e-mail próprios, planos por assentos, personalização por
configuração (não por fork). A Inove é o 1º inquilino-protótipo. Registro
completo das ideias/perguntas/decisões do Djan e da arquitetura em
**ops/PROJETO-MULTIEMPRESA.md**.

## 5. RI Digital (ONR) — pesquisa de bens e matrícula de imóveis — PRIORITÁRIO, BLOQUEADO EM ACESSO
Consultar pelo CMPGestão se uma pessoa/empresa tem imóvel registrado em algum
cartório do Brasil (Pesquisa Nacional de Bens do RI Digital/ONR, ridigital.org.br)
e pedir certidão/matrícula digital — fecha a lacuna que o Dossiê do Devedor já
avisa que tem hoje ("não substitui... Registro de Imóveis"). Falta confirmar
se o RI Digital abre cadastro/API para escritório de advocacia (o site está
bloqueado neste ambiente por política do proxy; preciso que você acesse
ridigital.org.br e confirme — ver item 7 do spec).
Especificação completa em **ops/PROJETO-RI-DIGITAL.md**.
