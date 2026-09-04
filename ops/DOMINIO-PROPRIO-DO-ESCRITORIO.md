# Endereço próprio do escritório (ex.: sistema.jaline.adv.br)

O escritório cliente começa em `<nome>.djan.app.br`. Quando ele quer o próprio
domínio, o caminho é um **subdomínio** do domínio dele apontado para este
servidor — nunca o apex.

**Por que subdomínio:** o site institucional e o e-mail do escritório costumam
já estar hospedados em outro lugar (Hostinger, por exemplo). Apontar o apex
(`jaline.adv.br`) para cá derrubaria o site. Um subdomínio (`sistema.`, `app.`)
convive com tudo: o site continua no apex e **o e-mail não é afetado** — MX é
registro separado, e mexer em A/CNAME de um subdomínio não toca nele.

## Passo a passo

1. **DNS, no painel do domínio do escritório** (onde o domínio está hospedado):
   um registro **A** com nome `sistema` apontando para o **IP do VPS**.
   (No VPS: `hostname -I` mostra o IP; no painel da hospedagem do VPS também.)
   Propagação: minutos, às vezes até algumas horas.

2. **Caddy** (uma vez, e vale para todos os escritórios): o bloco `https://` do
   `ops/Caddyfile` já atende qualquer domínio cadastrado, com certificado
   emitido na primeira visita. Instalar/atualizar:

   ```
   cp /opt/cmpgestao/ops/Caddyfile /etc/caddy/Caddyfile
   caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   systemctl reload caddy
   ```

   A emissão do certificado só acontece para endereço que o sistema reconhece:
   o Caddy pergunta em `/api/tls` antes (ver `app/api/tls/route.js`). É o que
   impede um estranho de apontar o domínio dele para cá e ganhar certificado.

3. **Cadastro do escritório** — acrescentar o endereço novo em `hosts`,
   **mantendo o antigo**:

   ```sql
   update escritorios
      set hosts = array['sistema.jaline.adv.br','jaline.djan.app.br']
    where id = '<id do escritório>';
   ```

   A **ordem importa**: `hosts[0]` é o endereço que o sistema usa nos links que
   saem para o cliente (convite do aplicativo, redefinição de senha, e-mails).
   Por isso o novo entra em primeiro lugar — mas só **depois** que o DNS estiver
   respondendo, senão sai link que não abre. Antes disso, acrescente no fim.

4. **Conferir**: abrir `https://sistema.jaline.adv.br` (cadeado válido, marca do
   escritório na porta) e `https://sistema.jaline.adv.br/portal.html` (o
   aplicativo do cliente). O endereço antigo continua funcionando enquanto
   estiver na lista — é o que permite a troca sem susto.

## O que NÃO muda

- **E-mail**: continua na conta que o escritório cadastrou (Hostinger ou outra).
  O que sai daqui usa o SMTP dele; o domínio do endereço é assunto do provedor
  de e-mail, não deste servidor.
- **Documentos e dados**: nada se move. O escritório é o mesmo registro; só o
  endereço de entrada mudou.

## Ainda pendente (vale antes de crescer o volume de e-mail)

SPF, DKIM e DMARC no domínio do escritório. Sem eles, e-mail enviado em nome do
domínio cai em spam com facilidade — e isso não depende do sistema, é
configuração de DNS do provedor de e-mail.
