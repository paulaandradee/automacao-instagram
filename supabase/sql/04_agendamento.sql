-- =====================================================================
-- 04_agendamento.sql
-- Agenda os "robôs" (pg_cron + pg_net). Rode POR ÚLTIMO, depois de
-- publicar as Edge Functions.
--
-- ANTES DE RODAR, troque os dois placeholders:
--   SEU_PROJETO            -> o id do seu projeto Supabase (está na URL dele)
--   SEU_SCHED_SECRET_AQUI  -> a mesma senha que você pôs no segredo SCHED_SECRET
-- =====================================================================

-- pg_cron = relógio dentro do Postgres; pg_net = deixa o Postgres chamar uma URL.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- O carteiro: a cada 1 minuto esvazia a fila e manda os passos com atraso.
select cron.schedule(
  'ig-scheduler',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO.supabase.co/functions/v1/ig-scheduler',
    headers := '{"Content-Type": "application/json", "x-sched-key": "SEU_SCHED_SECRET_AQUI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Renovação do token: toda segunda-feira às 04:00 (UTC).
select cron.schedule(
  'ig-token-refresh',
  '0 4 * * 1',
  $$
  select net.http_post(
    url     := 'https://SEU_PROJETO.supabase.co/functions/v1/ig-token-refresh',
    headers := '{"Content-Type": "application/json", "x-sched-key": "SEU_SCHED_SECRET_AQUI"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Pra conferir os agendamentos:     select * from cron.job;
-- Pra ver as últimas execuções:     select * from cron.job_run_details order by start_time desc limit 20;
-- Pra remover um agendamento:       select cron.unschedule('ig-scheduler');
