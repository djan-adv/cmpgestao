# Passo 2 — Ativar o envio de e-mail pelo servidor (contato@cmpadvogados.com.br)

Depois disto, o botão **"Enviar agora (contato@)"** passa a mandar o e-mail
**direto pelo servidor**, sempre de `contato@cmpadvogados.com.br` (não importa
quem está logado no Gmail), com **e-mail HTML, logo e botões de Instagram**.

O código já está no repositório. Faltam 3 passos no **VPS** (terminal SSH).

---

## Passo 1 — Guardar as credenciais SMTP (segredo) no `.env`

No VPS, edite o arquivo de variáveis de ambiente do app (fica em `/opt/cmpgestao`):

```bash
cd /opt/cmpgestao
nano .env.local        # se não existir, será criado
```

Adicione estas linhas (a senha é a da caixa `contato@cmpadvogados.com.br`):

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=contato@cmpadvogados.com.br
SMTP_PASS=SUA_SENHA_DO_EMAIL_AQUI
SMTP_FROM_NAME=Crispim Mendonça e Pinheiro Advogados
```

Salve (**Ctrl+O**, Enter) e feche (**Ctrl+X**). Proteja o arquivo:

```bash
chmod 600 .env.local
```

> A senha fica **só** aqui no servidor, nunca no GitHub nem no código.
> `.env.local` já está no `.gitignore`.

## Passo 2 — Instalar a biblioteca de envio e reconstruir o app

```bash
cd /opt/cmpgestao
git pull origin main        # traz o código novo (rota + botão)
npm install                 # instala o nodemailer
npm run build               # reconstrói o Next.js (necessário para a rota nova)
```

## Passo 3 — Reiniciar o app

Depende de como o app está rodando no seu VPS. Use o que se aplica:

- **pm2:**  `pm2 restart cmpgestao`  (ou `pm2 restart all`)
- **systemd:**  `sudo systemctl restart cmpgestao`
- **rodando em screen/tmux:** pare (Ctrl+C) e rode de novo `npm run start`

> Se não souber qual é, rode `pm2 list` — se aparecer o app, use pm2.
> Em caso de dúvida, me diga como o app é iniciado que eu te passo o comando exato.

---

## Testar

1. No sistema: **Publicar atualização** + **Ctrl+F5**.
2. Abra um processo → **✉ Atualizar cliente** → ponha **o seu próprio e-mail** no campo.
3. Clique **"Enviar agora (contato@)"** → confirme.
4. Deve chegar um e-mail **de `contato@cmpadvogados.com.br`**, com logo e botões de Instagram.
   - Se aparecer *"SMTP não configurado"* → confira o Passo 1 (nomes das variáveis).
   - Se aparecer *"falha ao enviar"* → provável senha errada ou porta bloqueada; tente `SMTP_PORT=587` no `.env.local` e reinicie.

Enquanto o envio pelo servidor não estiver ativo, o botão **"Abrir no Gmail"**
continua funcionando normalmente.

---

## Próximas etapas do Passo 2 (depois que o envio manual estiver ok)

- **Envio automático de segunda-feira** (cron): só quando houver movimentação
  nova (`djen`/`datajud`) desde o último e-mail.
- **Leitura de respostas (IMAP):** arquiva a resposta do cliente no histórico e
  salva **anexos** na pasta "Documentos enviados pelo cliente" do processo.

Essas duas reaproveitam o mesmo `contato@` e serão montadas quando o envio
manual estiver validado.
