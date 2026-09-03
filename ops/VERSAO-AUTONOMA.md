# Versão autônoma — um escritório de testes na mesma raiz

> Primeira etapa da fase 2 do `ops/PROJETO-MULTIEMPRESA.md` ("descolar do dono").
> Objetivo: entregar um login para um escritório **que não é a CMP** experimentar o
> sistema, sem ver nem tocar em nada da CMP — e sem cópia separada do sistema.

## O que é

Um **escritório convidado** é um registro em `escritorios` com os próprios usuários.
Ele entra pelo mesmo endereço, com login próprio, e o banco (RLS, função
`meu_escritorio()`) só lhe entrega as linhas do escritório dele. Quem estiver na CMP
não vê nada dele, e ele não vê nada da CMP.

## Como criar (na VPS, em /opt/cmpgestao)

```bash
node scripts/novo-escritorio.mjs criar "Escritório Teste" fulano@exemplo.com "Fulano de Tal"
```

Sai na tela o id do escritório, a pasta de documentos e **a senha, uma única vez**.
O primeiro acesso nasce como **sócio**: ele mesmo convida o resto da equipe pela
tela **Acessos** (não precisa de ninguém da CMP para isso).

Outros comandos:

```bash
node scripts/novo-escritorio.mjs listar
node scripts/novo-escritorio.mjs acesso <escritorio_id> outro@exemplo.com "Outro Nome"
node scripts/novo-escritorio.mjs senha fulano@exemplo.com
```

## Onde ficam os documentos

- Escritório da instalação (CMP): `/opt/cmpdocs` — **nada se moveu**.
- Escritório convidado: `/opt/cmpdocs/_esc/<id-do-escritorio>`.

Quem decide isso é `pastaDoEscritorio()` em `lib/escritorio.js`, a partir do usuário
logado. `/api/docs` resolve a pasta **por pedido**; não existe mais raiz fixa.

## O que já funciona para um escritório convidado

Processos e histórico, tarefas/Kanban, agenda, prazos, contatos, etiquetas, funil
(CRM), chat interno, documentos e anexos do processo, acessos da própria equipe.

## O que AINDA é do escritório da instalação (não use na demonstração como se fosse dele)

Sinceridade aqui evita constrangimento na frente do cliente:

- **IA** (diagnóstico, peça, briefing, robôs de minuta/aviso): as rotas ainda procuram
  o processo no escritório da instalação e lançam o custo em `ia_uso` nele.
- **jus.br/PDPJ** (token, puxar peças, protocolar): a sessão é a da CMP, com
  certificado da CMP. Escritório convidado não protocola.
- **E-mail, WhatsApp, portal do cliente, monitoramento, INPI, captura, agenda Google**:
  remetente, número e credenciais são os da instalação.

Ou seja: para **testar o miolo do sistema** (processos, prazos, tarefas, documentos,
equipe) já está pronto. Para vender com IA e protocolo ligados ao próprio escritório,
falta a próxima etapa — passar o escritório de quem pede às rotas de IA e trocar as
credenciais externas por configuração por escritório.

## Instalação separada (outra VPS)

Se o teste for numa VPS só dele, não precisa mexer em código: a variável
`ESCRITORIO_ID` no `.env.local` diz qual é o escritório daquela instalação, e todo o
sistema passa a girar em torno dele (`lib/escritorio.js`). Sem a variável, vale o da
CMP.

## Por que uma fonte só

Antes, 25 arquivos repetiam o uuid da CMP na mão. Bastava esquecer um para o
escritório convidado gravar dado no escritório errado — e ninguém perceberia até o
dado aparecer na tela de outra pessoa. Agora o uuid existe em **um** lugar
(`lib/escritorio.js`); as rotas ou importam ESCRITORIO_PADRAO, ou — o certo —
perguntam `escritorioDoRequest(request)` / `escritorioDoUsuario(user)`.
