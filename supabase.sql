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
