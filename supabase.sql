-- Run once in Supabase: SQL Editor -> New query -> paste -> Run
create table public.chats (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  messages jsonb not null default '[]',
  updated bigint not null default 0
);
create index chats_user_updated on public.chats (user_id, updated desc);

-- Each person can only see and change their own chats
alter table public.chats enable row level security;
create policy "own chats only" on public.chats
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Zint AI Plus (safe to run again): who has paid. People can only READ their own row; only the payment webhook can change it.
create table if not exists public.plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plus boolean not null default false,
  customer text,
  updated timestamptz default now()
);
alter table public.plans enable row level security;
drop policy if exists "read own plan" on public.plans;
create policy "read own plan" on public.plans for select to authenticated using (user_id = auth.uid());
create index if not exists plans_customer on public.plans (customer);


-- Zint AI Plus videos (safe to run again): counts clips so the daily limits work. Only the server can read or write it.
create table if not exists public.videos (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  gen_id text,
  prompt text,
  units int not null default 1,
  remaining int not null default 0,
  created timestamptz not null default now()
);
alter table public.videos enable row level security;
create index if not exists videos_created on public.videos (created desc);
