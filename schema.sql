-- HandFont Studio Pro: базовая схема облачных проектов.
-- Выполните в SQL Editor вашего проекта Supabase после создания проекта.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'user' check (role in ('user','moderator','admin','owner')),
  created_at timestamptz not null default now()
);

create table if not exists public.font_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Мой шрифт',
  project_data jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.font_projects enable row level security;

create policy "Users can read own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can update own display name"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can read own projects or public projects"
on public.font_projects for select
using (auth.uid() = user_id or is_public = true);

create policy "Users can create own projects"
on public.font_projects for insert
with check (auth.uid() = user_id);

create policy "Users can update own projects"
on public.font_projects for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete own projects"
on public.font_projects for delete
using (auth.uid() = user_id);

-- Профиль создаётся автоматически после регистрации.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();