-- =====================================================================
-- 02_freio.sql
-- As funções do FREIO de envio (token bucket atômico + disjuntor).
-- Rode DEPOIS do 01_tabelas.sql.
--
-- !!! AVISO IMPORTANTE !!!
-- Sem estas duas funções, o freio falha FECHADO: NENHUMA DM por
-- comentário sai. Tudo vai pra fila e a fila nunca anda.
-- É o passo que não pode faltar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- take_send_slot: tenta pegar UMA ficha de envio.
-- Retorna true = pode enviar agora; false = segura (vai pra fila).
-- O "for update" trava a linha, então dois envios ao mesmo tempo
-- nunca contam errado.
-- ---------------------------------------------------------------------
create or replace function public.take_send_slot(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  b      public.ig_send_budget%rowtype;
  agora  timestamptz := now();
begin
  select * into b from public.ig_send_budget where id = p_key for update;

  -- Sem linha de contador: falha fechado (melhor segurar do que levar bloqueio).
  if not found then
    raise warning 'Freio sem linha em ig_send_budget para "%". Envio segurado.', p_key;
    return false;
  end if;

  -- Disjuntor desarmado: pausa total até "paused_until".
  if b.paused_until is not null and b.paused_until > agora then
    return false;
  end if;

  -- Zera cada janela quando vira o minuto / a hora / o dia.
  if b.min_start is null or date_trunc('minute', agora) > b.min_start then
    b.min_count := 0;  b.min_start := date_trunc('minute', agora);
  end if;
  if b.hour_start is null or date_trunc('hour', agora) > b.hour_start then
    b.hour_count := 0; b.hour_start := date_trunc('hour', agora);
  end if;
  if b.day_start is null or date_trunc('day', agora) > b.day_start then
    b.day_count := 0;  b.day_start := date_trunc('day', agora);
  end if;

  -- Bateu algum teto? Grava as janelas zeradas e nega a ficha.
  if b.min_count >= b.cap_minute or b.hour_count >= b.cap_hour or b.day_count >= b.cap_day then
    update public.ig_send_budget set
      min_count = b.min_count, min_start = b.min_start,
      hour_count = b.hour_count, hour_start = b.hour_start,
      day_count = b.day_count, day_start = b.day_start,
      updated_at = agora
    where id = p_key;
    return false;
  end if;

  -- Tem ficha: conta o envio nas três janelas.
  update public.ig_send_budget set
    min_count = b.min_count + 1, min_start = b.min_start,
    hour_count = b.hour_count + 1, hour_start = b.hour_start,
    day_count = b.day_count + 1, day_start = b.day_start,
    updated_at = agora
  where id = p_key;

  return true;
end $$;

-- ---------------------------------------------------------------------
-- record_send_result: registra se o envio deu certo.
-- Falha "dura" (bloqueio, limite do Instagram) vale 3 pontos,
-- falha comum vale 1. Ao chegar em "trip_at" (padrão 9 = 3 falhas
-- duras seguidas), pausa os envios por "pause_hours" (padrão 3h).
-- Um envio OK zera a contagem.
-- ---------------------------------------------------------------------
create or replace function public.record_send_result(p_key text, p_ok boolean, p_hard boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.ig_send_budget%rowtype;
begin
  select * into b from public.ig_send_budget where id = p_key for update;
  if not found then
    return;
  end if;

  if p_ok then
    update public.ig_send_budget set err_streak = 0, updated_at = now() where id = p_key;
    return;
  end if;

  b.err_streak := b.err_streak + case when p_hard then 3 else 1 end;

  if b.err_streak >= b.trip_at then
    update public.ig_send_budget set
      err_streak = 0,
      paused_until = now() + make_interval(hours => b.pause_hours),
      updated_at = now()
    where id = p_key;
  else
    update public.ig_send_budget set err_streak = b.err_streak, updated_at = now() where id = p_key;
  end if;
end $$;

-- Só as Edge Functions (service_role) podem chamar o freio.
revoke all on function public.take_send_slot(text) from public, anon, authenticated;
revoke all on function public.record_send_result(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.take_send_slot(text) to service_role;
grant execute on function public.record_send_result(text, boolean, boolean) to service_role;
