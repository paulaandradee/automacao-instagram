-- =====================================================================
-- 03_rls.sql
-- Regras de acesso (RLS). Rode DEPOIS do 02_freio.sql.
--
-- Como funciona:
-- * RLS ligado em TODAS as tabelas.
-- * O painel (usuário logado = "authenticated") lê e escreve o que precisa.
-- * Público anônimo: nada. A chave anônima no HTML não abre nada sozinha.
-- * As Edge Functions usam a service_role, que ignora o RLS.
-- =====================================================================

alter table public.ig_automations      enable row level security;
alter table public.ig_leads            enable row level security;
alter table public.ig_deliveries       enable row level security;
alter table public.ig_send_queue       enable row level security;
alter table public.ig_send_budget      enable row level security;
alter table public.ig_scheduled        enable row level security;
alter table public.ig_assets           enable row level security;
alter table public.ig_token_status     enable row level security;
alter table public.ig_token_vault      enable row level security;  -- sem regra: só service_role
alter table public.ig_bot_sends        enable row level security;  -- sem regra: só service_role
alter table public.ig_processed_events enable row level security;  -- sem regra: só service_role

-- Painel: acesso completo (ler, criar, editar, apagar)
drop policy if exists "painel_automations" on public.ig_automations;
create policy "painel_automations" on public.ig_automations
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_leads" on public.ig_leads;
create policy "painel_leads" on public.ig_leads
  for all to authenticated using (true) with check (true);

drop policy if exists "painel_assets" on public.ig_assets;
create policy "painel_assets" on public.ig_assets
  for all to authenticated using (true) with check (true);

-- Painel: só leitura (quem escreve aqui são as Edge Functions)
drop policy if exists "painel_deliveries" on public.ig_deliveries;
create policy "painel_deliveries" on public.ig_deliveries
  for select to authenticated using (true);

drop policy if exists "painel_queue" on public.ig_send_queue;
create policy "painel_queue" on public.ig_send_queue
  for select to authenticated using (true);

drop policy if exists "painel_budget" on public.ig_send_budget;
create policy "painel_budget" on public.ig_send_budget
  for select to authenticated using (true);

drop policy if exists "painel_scheduled" on public.ig_scheduled;
create policy "painel_scheduled" on public.ig_scheduled
  for select to authenticated using (true);

drop policy if exists "painel_token_status" on public.ig_token_status;
create policy "painel_token_status" on public.ig_token_status
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Armazenamento dos arquivos (bucket público "ig-assets").
-- Público pra o Instagram conseguir baixar o arquivo pelo link.
-- Só o usuário logado envia ou apaga.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ig-assets', 'ig-assets', true)
on conflict (id) do nothing;

drop policy if exists "painel_envia_arquivos" on storage.objects;
create policy "painel_envia_arquivos" on storage.objects
  for insert to authenticated with check (bucket_id = 'ig-assets');

drop policy if exists "painel_apaga_arquivos" on storage.objects;
create policy "painel_apaga_arquivos" on storage.objects
  for delete to authenticated using (bucket_id = 'ig-assets');
