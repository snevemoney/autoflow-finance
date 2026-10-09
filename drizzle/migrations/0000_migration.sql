-- OCR pipeline columns on documents
alter table public.documents
  add column if not exists type_source text not null default 'manual',
  add column if not exists storage_path text,
  add column if not exists preview_path text,
  add column if not exists mime_type text,
  add column if not exists processing_status text not null default 'pending',
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz,
  add column if not exists classification_confidence text,
  add column if not exists ai_model text;

-- auto-fill columns on income_sources
alter table public.income_sources
  add column if not exists gross_per_period numeric,
  add column if not exists auto_filled_at timestamptz,
  add column if not exists auto_fill_document_id uuid references public.documents(id) on delete set null;

-- app settings (single-row)
create table if not exists public.app_settings (
  id boolean primary key default true,
  automations jsonb not null default '{"auto_sort":true,"auto_fill_income":true,"auto_request_docs":true,"auto_route":true}',
  funding_checklist_items jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.app_settings (id) values (true) on conflict do nothing;
alter table public.app_settings enable row level security;
create policy "staff read settings" on public.app_settings for select to authenticated using (true);
create policy "staff update settings" on public.app_settings for update to authenticated using (public.has_role(auth.uid(), 'admin'));

-- dealer <-> user links
create table if not exists public.dealer_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  dealer_id uuid not null references public.dealers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, dealer_id)
);
alter table public.dealer_users enable row level security;
create policy "users read own dealer link" on public.dealer_users for select to authenticated using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- document requests
create table if not exists public.document_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  doc_type text not null,
  message text,
  status text not null default 'open',
  created_by uuid,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
alter table public.document_requests enable row level security;
create policy "authenticated read requests" on public.document_requests for select to authenticated using (true);
create policy "authenticated create requests" on public.document_requests for insert to authenticated with check (true);
create policy "authenticated update requests" on public.document_requests for update to authenticated using (true);
grant select, insert, update on public.document_requests to authenticated;