# Plataforma de Automação de DM do Instagram

Painel web com login + motor de respostas automáticas no direct (estilo ManyChat),
com backend no Supabase. Alguém comenta uma palavra no seu post, recebe uma DM com
botão, toca no botão, a conversa segue, e o contato fica salvo.

## O que tem na pasta

```
index.html                 o painel (login + sistema)
css/estilo.css             o visual (troque a cor de destaque em --destaque)
js/config.js               SUPABASE_URL e SUPABASE_ANON_KEY (você preenche)
js/dados.js                acesso ao banco (e o modo de teste local)
js/app.js                  login, menu, Início, Calendário, Instagram
js/editor.js               editor de automação + prévia ao vivo
servidor-local.ps1         servidor local pra testar no Windows
supabase/sql/01_tabelas.sql       tabelas
supabase/sql/02_freio.sql         funções do freio (OBRIGATÓRIO)
supabase/sql/03_rls.sql           regras de acesso + bucket de arquivos
supabase/sql/04_agendamento.sql   robôs agendados (pg_cron)
supabase/functions/...            Edge Functions (webhook, scheduler, token, métricas, posts)
```

---

## Passo 0: testar agora, sem configurar nada

1. Suba um servidor local na pasta do projeto:
   * Windows: `powershell -ExecutionPolicy Bypass -File .\servidor-local.ps1`
   * Mac/Linux: `python3 -m http.server 5173`
2. Abra `http://localhost:5173`.
3. Entre com **qualquer e-mail** e **uma senha de 5 dígitos** (ex: 12345).

No modo de teste local dá pra navegar tudo: Início, Calendário, Instagram, o editor
de automação e a prévia. As automações que você salvar ficam só no seu navegador.
Os passos abaixo são pra colocar no ar de verdade, com login e dados salvos.

---

## Passo 1: criar o projeto no Supabase e rodar os SQLs

1. Crie uma conta em supabase.com e um projeto novo.
2. Abra **SQL Editor** e rode, NESTA ORDEM, o conteúdo de:
   1. `supabase/sql/01_tabelas.sql`
   2. `supabase/sql/02_freio.sql`
   3. `supabase/sql/03_rls.sql`
   (o `04_agendamento.sql` fica pro Passo 5)

> **ATENÇÃO:** o `02_freio.sql` não pode faltar. Sem as funções `take_send_slot` e
> `record_send_result`, o freio falha fechado e NENHUMA DM por comentário sai: tudo vai
> pra fila e a fila nunca anda. Confira também se a tabela `ig_send_budget` tem a linha
> `private_reply` (o 01 já cria).

## Passo 2: criar o usuário admin

Em **Authentication > Users > Add user**, crie o seu e-mail e senha (marque
"Auto Confirm User"). Esse é o login que vale quando o site estiver no ar.
Não existe tela de cadastro público, de propósito.

## Passo 3: configurar os segredos das Edge Functions

Em **Edge Functions > Secrets** (ou pela CLI com `supabase secrets set NOME=valor`):

| Segredo | O que é |
|---|---|
| `IG_ACCESS_TOKEN` | token long-lived do Instagram (Passo 6) |
| `IG_ACCOUNT_ID` | id numérico da sua conta do Instagram (Passo 6) |
| `APP_SECRET` | segredo do app do Meta (App settings > Basic) |
| `APP_SECRET_ENFORCE` | `false` no começo; `true` depois que tudo funcionar |
| `VERIFY_TOKEN` | uma senha que você inventa (aperto de mão do webhook) |
| `GRAPH_API_VERSION` | `v21.0` |
| `SCHED_SECRET` | outra senha que você inventa (protege os robôs agendados) |
| `TEST_IG_ACCOUNTS` | ids numéricos das contas de teste, separados por vírgula (ignoram a regra do 1 por dia) |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm prontos dentro das Edge Functions.
A service_role NUNCA vai pro frontend.

## Passo 4: publicar as Edge Functions

Instale a CLI do Supabase, faça `supabase login` e `supabase link --project-ref SEU_PROJETO`
na pasta do projeto. Depois:

```
supabase functions deploy instagram-webhook --no-verify-jwt
supabase functions deploy ig-scheduler --no-verify-jwt
supabase functions deploy ig-token-refresh --no-verify-jwt
supabase functions deploy ig-insights
supabase functions deploy ig-media
```

* A `instagram-webhook` PRECISA ser pública (`--no-verify-jwt`, ou no painel desligue
  "Verify JWT"), senão o Meta não consegue chamar.
* `ig-scheduler` e `ig-token-refresh` também ficam sem JWT, mas são protegidas pelo
  `SCHED_SECRET` (header `x-sched-key`).
* `ig-insights` e `ig-media` só respondem pra quem está logado no painel.

## Passo 5: agendar os robôs (pg_cron)

Abra `supabase/sql/04_agendamento.sql`, troque `SEU_PROJETO` e `SEU_SCHED_SECRET_AQUI`
e rode no SQL Editor. Ele liga as extensões `pg_cron` e `pg_net` e agenda:
* `ig-scheduler` a cada 1 minuto (esvazia a fila do freio e manda passos com atraso);
* `ig-token-refresh` toda segunda-feira (renova o token).

## Passo 6: app no Meta for Developers

1. Em developers.facebook.com, crie um app e adicione o produto
   **Instagram > API setup with Instagram login**.
2. Conecte sua conta **profissional** (Business ou Creator) do Instagram.
3. Libere as permissões: `instagram_business_basic`,
   `instagram_business_manage_comments`, `instagram_business_manage_messages`
   (e `instagram_business_manage_insights` pras métricas).
4. Gere o token (long-lived, cerca de 60 dias) e pegue o id numérico da conta.
   Coloque nos segredos `IG_ACCESS_TOKEN` e `IG_ACCOUNT_ID`.
5. No app do Instagram, ative "Permitir acesso às mensagens"
   (Configurações > Mensagens > Ferramentas conectadas).

## Passo 7: cadastrar o webhook no Meta

* URL de callback: `https://SEU_PROJETO.supabase.co/functions/v1/instagram-webhook`
* Verify token: o mesmo `VERIFY_TOKEN` do Passo 3.
* ASSINE os três campos: **`comments`**, **`messages`** e **`messaging_postbacks`**.
  O `messaging_postbacks` é o que faz os botões da conversa funcionarem. Sem ele, o
  toque no botão não chega.

## Passo 8: publicar o painel

1. Preencha `js/config.js` com a `SUPABASE_URL` e a `SUPABASE_ANON_KEY`
   (Project Settings > API). A chave anônima pode ficar pública: quem tranca o banco é o RLS.
2. Suba a pasta num host estático (ex: GitHub Pages). Fora do localhost, o login passa a
   ser o do Supabase (Passo 2).

## Passo 9: testar

Use uma **segunda conta** do Instagram (comentários da própria conta são ignorados de
propósito). Comente a palavra-chave num post. Coloque o id dessa conta em
`TEST_IG_ACCOUNTS` pra poder repetir o teste sem esperar 24h.
Se algo não sair, veja **Edge Functions > Logs** e as tabelas `ig_deliveries` e
`ig_send_queue`.

## Passo 10: ligar a trava da assinatura

Quando tudo funcionar, mude `APP_SECRET_ENFORCE` pra `true`. A partir daí, requisição
sem a assinatura correta do Meta é recusada.

---

## Como a conversa é guardada (campo `flow`)

```
flow = {
  modo: "link" | "conversa" | "sem_botao",   // só pra o editor
  steps: [
    { id: 1, message: "Mensagem 1", buttons: [ { title: "Quero", next: 2 } ], assets: [] },
    { id: 2, message: "Mensagem 2", buttons: [
        { title: "Opção A", next: 3 },
        { title: "Ver site", url: "https://..." }
    ], collect: { field: "email", next: 3 } },
    { id: 3, message: "...", delay: { seconds: 30, next: 4 } }
  ]
}
```

* A Mensagem 1 é SEMPRE o primeiro item de `steps` (o id não importa).
* Um botão tem `next` (vai pra outro passo) OU `url` (abre link). Nunca os dois.
* Botão sem `next` e sem `url` = "encerrar": não é enviado.
* O botão que avança vira um postback com payload `STEP:idDaAutomacao:proximoPasso`.
* Até 3 botões vão ANEXADOS ao balão (button template). Se o Instagram recusar (ou tiver
  mais de 3), o sistema tenta pílulas (quick_reply, até 13) e, por último, texto puro com
  o link no texto. A mensagem nunca deixa de chegar.

---

## Regras e limites (pra não tomar bloqueio)

* **Opt-in sempre:** o sistema só responde quem comentou (ou mandou a palavra no direct).
  Nada de disparo em massa, spam ou lista comprada.
* **1 por dia:** cada pessoa recebe no máximo 1 DM por comentário a cada 24h
  (contas em `TEST_IG_ACCOUNTS` ignoram).
* **Freio de envio:** padrão de 6 por minuto, 60 por hora, 180 por dia (bem abaixo do teto
  de respostas privadas do Instagram, que gira em torno de 200 a 300 por dia). O excesso
  espera na fila. Pra mudar, edite `cap_minute`, `cap_hour` e `cap_day` na tabela
  `ig_send_budget`.
* **Disjuntor:** 3 falhas "duras" seguidas (bloqueio ou limite do Instagram) pausam os
  envios por 3 horas (`trip_at` e `pause_hours` na mesma tabela).
* **Janela de 24h da Meta:** só dá pra mandar DM pra quem interagiu recentemente.
  O comentário e o toque no botão abrem a janela.
* **Resposta a comentário:** vale só por cerca de 7 dias e é UMA mensagem só antes da
  pessoa responder (por isso arquivos da Mensagem 1 saem quando ela toca no botão).
* **Token:** vence em cerca de 60 dias; o `ig-token-refresh` renova toda semana e guarda
  o token novo no banco (tabela `ig_token_vault`).
* **Botões:** nome com no máximo 20 caracteres; no máximo 3 anexados por mensagem.
* **Banco:** cada consulta devolve no máximo 1000 linhas. Se suas tabelas crescerem muito,
  pagine as consultas.

---

## Checklist do que preencher

- [ ] `js/config.js`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- [ ] Segredos: `IG_ACCESS_TOKEN`, `IG_ACCOUNT_ID`, `APP_SECRET`, `APP_SECRET_ENFORCE`,
      `VERIFY_TOKEN`, `GRAPH_API_VERSION`, `SCHED_SECRET`, `TEST_IG_ACCOUNTS`
- [ ] `04_agendamento.sql`: `SEU_PROJETO`, `SEU_SCHED_SECRET_AQUI`
- [ ] Usuário admin criado no Supabase Auth
- [ ] Webhook no Meta com `comments`, `messages` e `messaging_postbacks`
