-- =====================================================================
-- 01_tabelas.sql
-- Cria todas as tabelas do sistema de automação de DM do Instagram.
-- Rode este arquivo PRIMEIRO no SQL Editor do Supabase.
-- Pode rodar de novo sem medo: usa "if not exists".
-- =====================================================================

create extension if not exists pgcrypto;  -- gera ids (gen_random_uuid)

-- ---------------------------------------------------------------------
-- Automações: cada linha é uma regra "comentou X, recebe a conversa Y".
-- Toda a conversa (inclusive a Mensagem 1) mora no campo "flow".
-- ---------------------------------------------------------------------
create table if not exists public.ig_automations (
  id                     uuid primary key default gen_random_uuid(),
  nome                   text not null default '',
  keyword                text not null default '',      -- palavras separadas por vírgula
  match_any              boolean not null default false, -- true = qualquer comentário dispara
  active                 boolean not null default true,
  media_ids              text[] not null default '{}',   -- posts escolhidos (vazio = todos)
  public_reply           text not null default '',       -- resposta pública no comentário
  public_reply_variants  text[] not null default '{}',   -- variações A/B da resposta pública
  flow                   jsonb not null default '{"steps":[]}'::jsonb,
  asset_ids              text[] not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Leads: cada pessoa que interagiu com uma automação.
-- ---------------------------------------------------------------------
create table if not exists public.ig_leads (
  ig_user_id     text primary key,
  username       text,
  last_source    text,           -- comment / dm / story_reply
  last_keyword   text,
  automation_id  uuid references public.ig_automations(id) on delete set null,
  flow_step      text,           -- em que passo da conversa a pessoa está
  link_sent      boolean not null default false,
  expecting      jsonb,          -- quando um passo pediu um dado (email/telefone)
  tags           text[] not null default '{}',
  email          text,
  telefone       text,
  dados          jsonb not null default '{}'::jsonb,  -- campos livres extras
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Log de cada envio (serve pra regra do "1 por dia" e pros números do painel).
-- ---------------------------------------------------------------------
create table if not exists public.ig_deliveries (
  id             bigserial primary key,
  ig_user_id     text,
  automation_id  uuid,
  canal          text,   -- private_reply / dm
  tipo           text,   -- flow / link / text
  status         text,   -- ok / erro / na_fila
  motivo         text,
  ts             timestamptz not null default now()
);
create index if not exists ig_deliveries_user_ts on public.ig_deliveries (ig_user_id, ts desc);
create index if not exists ig_deliveries_ts on public.ig_deliveries (ts desc);

-- ---------------------------------------------------------------------
-- Fila de envios segurados pelo freio (o ig-scheduler esvazia).
-- ---------------------------------------------------------------------
create table if not exists public.ig_send_queue (
  id             bigserial primary key,
  comment_id     text unique not null,
  automation_id  uuid references public.ig_automations(id) on delete cascade,
  ig_user_id     text,
  username       text,
  status         text not null default 'pendente',  -- pendente / enviado / erro / expirado
  tentativas     int not null default 0,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  last_error     text
);
create index if not exists ig_send_queue_pendente on public.ig_send_queue (status, created_at);

-- ---------------------------------------------------------------------
-- O CONTADOR DO FREIO. Uma linha por tipo de envio (ex: "private_reply").
-- SEM ESSA TABELA (e sem a linha inicial), o freio não tem onde contar,
-- falha FECHADO e nenhuma DM por comentário sai.
-- ---------------------------------------------------------------------
create table if not exists public.ig_send_budget (
  id            text primary key,
  min_count     int not null default 0,
  min_start     timestamptz,
  hour_count    int not null default 0,
  hour_start    timestamptz,
  day_count     int not null default 0,
  day_start     timestamptz,
  err_streak    int not null default 0,   -- "pontos" de falha seguidos (disjuntor)
  cap_minute    int not null default 6,   -- tetos conservadores, bem abaixo do Instagram
  cap_hour      int not null default 60,
  cap_day       int not null default 180,
  trip_at       int not null default 9,   -- pontos pra desarmar o disjuntor (falha dura = 3, comum = 1)
  pause_hours   int not null default 3,   -- quanto tempo fica pausado
  paused_until  timestamptz,
  updated_at    timestamptz not null default now()
);

-- Linha inicial (seed) com os tetos padrão.
insert into public.ig_send_budget (id) values ('private_reply')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Passos com atraso ("envia sozinho depois de X segundos").
-- ---------------------------------------------------------------------
create table if not exists public.ig_scheduled (
  id             bigserial primary key,
  ig_user_id     text not null,
  automation_id  uuid references public.ig_automations(id) on delete cascade,
  step_id        text not null,
  send_at        timestamptz not null,
  sent           boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists ig_scheduled_pendente on public.ig_scheduled (sent, send_at);

-- ---------------------------------------------------------------------
-- Biblioteca de arquivos (PDF, áudio, foto, vídeo).
-- ---------------------------------------------------------------------
create table if not exists public.ig_assets (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  tipo           text not null,   -- image / audio / video / file
  public_url     text not null,
  attachment_id  text,            -- cache do Instagram (opcional)
  size_bytes     bigint,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Situação do token do Instagram (o painel pode ler).
-- ---------------------------------------------------------------------
create table if not exists public.ig_token_status (
  id                 text primary key default 'main',
  expires_at         timestamptz,
  last_ok            boolean,
  last_error         text,
  last_refreshed_at  timestamptz,
  updated_at         timestamptz not null default now()
);
insert into public.ig_token_status (id) values ('main') on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Cofre do token renovado. Só as Edge Functions leem (sem regra pro painel).
-- O ig-token-refresh grava aqui o token novo; se estiver vazio, as funções
-- usam o IG_ACCESS_TOKEN dos segredos.
-- ---------------------------------------------------------------------
create table if not exists public.ig_token_vault (
  id            text primary key default 'main',
  access_token  text,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Ids (mid) das mensagens que o PRÓPRIO sistema enviou.
-- Serve pra não confundir um envio automático com uma resposta manual.
-- ---------------------------------------------------------------------
create table if not exists public.ig_bot_sends (
  mid         text primary key,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- "Já processei esse evento": evita responder duas vezes o mesmo
-- comentário/mensagem quando o Meta reenvia o webhook.
-- ---------------------------------------------------------------------
create table if not exists public.ig_processed_events (
  id          text primary key,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Atualiza "updated_at" sozinho quando a linha muda.
-- ---------------------------------------------------------------------
create or replace function public.tocar_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_automations_updated on public.ig_automations;
create trigger trg_automations_updated before update on public.ig_automations
  for each row execute function public.tocar_updated_at();

drop trigger if exists trg_leads_updated on public.ig_leads;
create trigger trg_leads_updated before update on public.ig_leads
  for each row execute function public.tocar_updated_at();
