# Como criar o ambiente de VENDA (djan.app.br) no mesmo VPS

> **O que é isto:** uma segunda instância do sistema, no **mesmo VPS**, com
> **identidade própria** (sem nada da CMP) e apontada para o **mesmo banco**
> Supabase — mas usando um **escritório separado** ("Escritório Demonstração").
> É a arquitetura do `PROJETO-MULTIEMPRESA.md` funcionando de verdade: uma raiz,
> vários escritórios, cada um enxergando **só os seus dados**.
>
> Custo: **R$ 0** (nada de projeto novo no Supabase, nada de servidor novo).

## O que já está pronto (feito no banco, não precisa repetir)

- **Escritório Demonstração** criado (`escritorios`, plano trial), separado da CMP.
- **Conta coordenadora da demonstração**: `djan.adv+venda@gmail.com`
  (cai na mesma caixa do Gmail do Djan, mas é um login independente; a senha
  provisória foi passada em conversa — troque depois na tela Acessos).
- **Dados fictícios de demonstração**: 3 processos, 2 contatos, 4 andamentos e
  2 tarefas no Kanban (nomes "Exemplo", números claramente falsos).
- **Isolamento reforçado (RLS)**: usuários de outros escritórios **não veem nada**
  da CMP — processos, contatos, agenda, Kanban, Inove, leads do site, changelog e
  arquivos de leads ficaram restritos ao escritório-raiz (CMP). Testado nos dois
  sentidos direto no banco.
- A coluna `escritorios.raiz` marca a CMP como escritório-raiz; o sistema usa isso
  para trocar a marca e esconder as pastas próprias da CMP (Inove, James etc.).

## Passo 1 — Apontar o domínio

No painel de DNS do **djan.app.br** (Registro.br ou onde o DNS estiver delegado),
crie um registro **A** apontando para o **IP do VPS** (o mesmo do sistema atual):

```
djan.app.br      A     IP_DO_VPS
www.djan.app.br  A     IP_DO_VPS   (opcional)
```

Propaga em minutos (às vezes até 1h).

## Passo 2 — Criar a instância no VPS

No terminal SSH do VPS:

```bash
cd /opt
git clone https://github.com/djan-adv/cmpgestao.git gestao-venda
cd gestao-venda
nano .env.local
```

Conteúdo do `.env.local` da instância de venda:

```
# mesmo Supabase da CMP (o isolamento é por escritório, no banco)
NEXT_PUBLIC_SUPABASE_URL=https://ndeqlyrydcijbgjiviuw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_X5Jo69qYCQOMEg0fu2yc1w_gIYwWuQD
# copie a service role do /opt/cmpgestao/.env.local (necessária para a tela Acessos)
SUPABASE_SERVICE_ROLE_KEY=cole_aqui_a_mesma_da_cmp

# identidade da instância (o que muda a marca na tela de login)
NEXT_PUBLIC_BRAND_NAME=Gestão Jurídica

# quem pode gerenciar acessos e publicar NESTA instância
ACESSOS_ALLOW=djan.adv@gmail.com,djan.adv+venda@gmail.com
DEPLOY_ALLOW=djan.adv@gmail.com,djan.adv+venda@gmail.com
DEPLOY_DIR=/opt/gestao-venda
DEPLOY_PM2=gestao-venda
```

> O nome da marca pode trocar quando quiser (ex.: quando nascer a marca comercial);
> é só editar `NEXT_PUBLIC_BRAND_NAME` e recompilar. **Não** configure aqui as
> senhas SMTP nem as integrações da CMP (WhatsApp, Cora, Jus.br) — o ambiente de
> venda não deve enviar e-mail como a CMP.

Depois salve (**Ctrl+O**, Enter; **Ctrl+X**), proteja e compile:

```bash
chmod 600 .env.local
npm install --no-audit --no-fund
npm run build
pm2 start node_modules/next/dist/bin/next --name gestao-venda -- start -p 3001
pm2 save
```

A instância da CMP continua na porta 3000; a de venda sobe na **3001**.

## Passo 3 — Nginx + HTTPS

```bash
sudo nano /etc/nginx/sites-available/gestao-venda
```

```nginx
server {
    listen 80;
    server_name djan.app.br www.djan.app.br;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/gestao-venda /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d djan.app.br -d www.djan.app.br
```

Pronto: **https://djan.app.br** abre a tela de login com a marca neutra
("Gestão Jurídica"), sem logo nem menção à CMP.

## Passo 4 — Roteiro de teste com a Jaline

1. **Djan entra** em https://djan.app.br com `djan.adv+venda@gmail.com` e a senha
   provisória. Deve ver: marca "Escritório Demonstração" no menu, 3 processos
   fictícios, 2 tarefas no Kanban, agenda **vazia** — e **nada** da CMP.
2. **Troque a senha provisória**: tela Acessos → seu cartão → Editar.
3. **Cadastre a Jaline**: tela Acessos → "Advogado(a) 1" → Cadastrar → e-mail
   real dela + senha. Depois "Renomear" para o nome dela.
   (Há também vagas de Funcionário(a) e Estagiário(a) para testar os papéis.)
4. **Jaline entra** em https://djan.app.br no celular ou PC com o e-mail e senha.
   Ela deve ver só o Escritório Demonstração.
5. **Teste de uso real**: criar processo manual, mover tarefa no Kanban, agendar
   audiência, cadastrar contato, usar etiquetas — tudo grava no escritório de
   demonstração, nada aparece no sistema da CMP (e vice-versa).

## Como funciona por dentro (resumo técnico)

- O login identifica o usuário; a tabela `usuarios` diz o `escritorio_id`; as
  políticas RLS do banco só devolvem dados daquele escritório.
- Se o escritório **não é o raiz** (CMP), o sistema aplica a marca do escritório
  (nome no menu, título da aba), esconde as pastas da CMP (Inove, James, botões
  `cmp-only`) e **não injeta** os seeds embutidos do Astrea (que são dados da CMP).
- A tela Acessos funciona por papel: quem tem papel `socio`/`coordenador` gerencia
  os acessos **do próprio escritório** (advogados, funcionários e estagiários).
- As duas instâncias rodam o **mesmo código** (mesmo repositório). O botão
  "Publicar atualização" de cada instância atualiza a própria pasta
  (`DEPLOY_DIR`/`DEPLOY_PM2` no `.env.local`).

## Avisos

- **Não** configure o cron do DJEN nem integrações da CMP na instância de venda.
- As mudanças deste ambiente estão na branch `claude/sales-system-testing-3gvuxz`;
  para o "Publicar atualização" pegar tudo, elas precisam chegar à `main` antes
  do Passo 2 (ou faça o clone desta branch para testar primeiro).
- Quando o produto ganhar nome/marca definitivos, é só trocar
  `NEXT_PUBLIC_BRAND_NAME` (e futuramente logo/favicon próprios) — nada muda no código.
