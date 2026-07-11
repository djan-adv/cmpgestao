# Próxima tarefa — Processos contra James Laurence (pasta Brisas)

Objetivo: consolidar no sistema todos os processos do escritório contra
**James Laurence** (grupo/pasta "Brisas"): documentos, honorários, histórico de
cobrança ao administrador judicial e a base de clientes.

## Frentes de trabalho

### 1. Upload dos processos (pasta Brisas)
- Continuar o envio de todos os processos contra James Laurence.
- Usa o fluxo "Sincronizar pasta" (já reconhece subpasta por cliente e envia ao
  processo certo, preservando subpastas).
- **Preciso de você:** a pasta Brisas acessível (upload no sistema, ou pasta
  compartilhada no Google Drive).

### 2. Honorários (todos) a partir da última planilha/petição
- Ler a **última planilha de cálculos** (ou a petição mais recente) de cada
  processo e extrair os percentuais/valores de honorários.
- Preencher os campos novos da ficha: contratual %, sucumbência %, execução %,
  multa má-fé %, pró-labore R$ e **valor da condenação** R$.
  (colunas já criadas: processos.hon_pct_contratual/sucumbencia/execucao/ma_fe,
   hon_pro_labore, valor_condenacao)
- **Preciso de você:** a planilha de cálculos mais recente (Excel/PDF) — de
  preferência a que consolida todos, ou uma por processo. Confirmar quais
  percentuais a planilha traz.

### 3. E-mails ao administrador judicial (Gmail — Enviados)
- Centenas de e-mails enviados ao administrador judicial.
- Possíveis usos: registrar no histórico de cada processo / montar linha do tempo
  de cobrança / extrair datas e valores.
- **Preciso de você:** confirmar o objetivo (anexar? registrar? extrair?), o
  **e-mail/nome do administrador** para filtrar, e a conta Gmail autorizada
  (o conector Gmail precisa estar conectado nesta sessão).

### 4. Relação de clientes contra James Laurence → Contatos
- Atualizar a base de contatos com todos os clientes desse polo.
- **Preciso de você:** a lista (nome + CPF/CNPJ; telefone/e-mail se tiver).
- Insiro/atualizo na tabela `contatos` e vinculo aos processos.

## Observações
- Já temos base: o seed do Kanban tem várias tarefas "James Laurence" (pedidos de
  certidão de crédito, habilitações etc.), o que ajuda a casar os processos.
- Ordem sugerida: (4) clientes → (1) upload/casar processos → (2) honorários →
  (3) e-mails de cobrança.
