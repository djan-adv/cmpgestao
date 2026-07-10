# Como ativar o cadastro de acessos (logins da equipe)

A tela **Acessos** (botão com o nome, no rodapé do menu) agora cria as contas de
verdade quando o coordenador clica em **Cadastrar** e define uma senha. Para isso
funcionar, o servidor precisa de **uma** chave secreta do Supabase — a chave de
administrador (service role). Configura-se **uma vez** e nunca mais.

## Passo a passo (uma vez)

1. Entre no painel do Supabase do projeto **cmpgestao**:
   https://supabase.com/dashboard/project/ndeqlyrydcijbgjiviuw/settings/api-keys
2. Copie a chave **`service_role`** (é a chave secreta — NÃO é a `anon`/publishable).
3. No servidor (Hostinger), abra o arquivo `.env.local` do projeto (mesmo arquivo
   onde já ficam as senhas de e-mail SMTP) e acrescente a linha:

   ```
   SUPABASE_SERVICE_ROLE_KEY=cole_aqui_a_chave_service_role
   ```

4. Reinicie o serviço do sistema (o mesmo procedimento usado quando muda uma senha
   de e-mail), ou peça para publicarmos.

> A chave secreta fica **somente** no `.env.local` do servidor. Ela nunca entra no
> código nem no GitHub. Como o `.env.local` não é versionado, o botão "Publicar
> atualização" (git reset) não apaga essa configuração.

## Como usar depois de ativado

1. Abra a tela **Acessos**.
2. Ao lado da pessoa (ex.: Jader, Maria Eduarda, Rita), clique em **Cadastrar**.
3. Informe o **e-mail** dela e uma **senha** (mínimo 6 caracteres).
4. Pronto: a conta é criada na hora. Passe para a pessoa o **mesmo link** do
   sistema, o **e-mail** e a **senha** que você definiu — ela já consegue entrar.

- **Editar**: troca a senha de quem já tem conta.
- **Desativar / Ativar**: bloqueia ou libera o login da pessoa.
- **Renomear**: muda o nome exibido.

## Enquanto a chave não está configurada

O botão **Cadastrar** vai avisar que a chave de administrador não está configurada
no servidor — é só seguir o passo a passo acima.
