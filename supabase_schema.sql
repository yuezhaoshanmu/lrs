-- 夜幕牌局 cloud schema. Run in Supabase SQL Editor.
-- Existing SQLite/token data is intentionally kept by the legacy server path.
create extension if not exists pgcrypto;

-- Preserve the previous bigint/token schema before introducing UUID/Auth
-- tables. Moving it to a separate schema also avoids primary-key index-name
-- collisions. This only runs when the old primary key is bigint/integer.
create schema if not exists legacy;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='games' and column_name='id' and data_type in ('bigint','integer')) then alter table public.games set schema legacy; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='id' and data_type in ('bigint','integer')) then alter table public.players set schema legacy; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='game_roles' and column_name='id' and data_type in ('bigint','integer')) then alter table public.game_roles set schema legacy; end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='player_roles' and column_name='id' and data_type in ('bigint','integer')) then alter table public.player_roles set schema legacy; end if;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 40),
  avatar_url text,
  user_type text not null default 'player' check (user_type in ('judge','player')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1), '夜行者')) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create table if not exists roles (
  id bigint primary key, name text unique not null, canonical_name text, aliases text, camp text not null, category text, sub_category text,
  description text not null default '', short_description text, skill_description text, win_condition text, action_phase text, icon text, card_image_url text,
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz
);
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='roles' and column_name='is_active' and data_type in ('integer','bigint')) then
    alter table public.roles alter column is_active drop default;
    alter table public.roles alter column is_active type boolean using (is_active <> 0);
    alter table public.roles alter column is_active set default true;
  end if;
end $$;
create table if not exists games (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id) on delete restrict, name text not null,
  invite_code text unique not null, max_players integer not null check (max_players between 4 and 30), status text not null default 'open',
  phase text not null default 'WAITING', day_number integer not null default 1, winner text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists players (
  id uuid primary key default gen_random_uuid(), game_id uuid not null references games(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade, seat_number integer not null, nickname text not null check (char_length(nickname) between 2 and 20),
  status text not null default 'ALIVE', joined_at timestamptz not null default now(), unique (game_id, seat_number), unique (game_id, user_id)
);
create table if not exists game_roles (
  id uuid primary key default gen_random_uuid(), game_id uuid not null references games(id) on delete cascade,
  role_id bigint not null references roles(id), count integer not null check (count > 0), unique (game_id, role_id)
);
create table if not exists player_roles (
  id uuid primary key default gen_random_uuid(), game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade, role_id bigint not null references roles(id),
  assigned_at timestamptz not null default now(), is_revealed boolean not null default false, unique (game_id, player_id)
);

alter table profiles enable row level security; alter table games enable row level security; alter table players enable row level security;
alter table game_roles enable row level security; alter table player_roles enable row level security; alter table roles enable row level security;
create or replace function public.is_game_owner(target_game uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from games where id=target_game and owner_id=auth.uid());
$$;
create or replace function public.is_game_member(target_game uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_game_owner(target_game) or exists(select 1 from players where game_id=target_game and user_id=auth.uid());
$$;
revoke all on function public.is_game_owner(uuid) from public;
revoke all on function public.is_game_member(uuid) from public;
grant execute on function public.is_game_owner(uuid) to authenticated;
grant execute on function public.is_game_member(uuid) to authenticated;
drop policy if exists profiles_self_select on profiles;
create policy profiles_self_select on profiles for select using (id = auth.uid());
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists games_member_or_owner_select on games;
create policy games_member_or_owner_select on games for select using (public.is_game_member(id));
-- Game creation and state transitions are server-only (service role). No
-- client INSERT/UPDATE policy is granted for games.
drop policy if exists games_owner_insert on games;
drop policy if exists games_owner_update on games;
drop policy if exists players_member_public_select on players;
create policy players_member_public_select on players for select using (public.is_game_member(game_id));
drop policy if exists players_self_insert on players;
drop policy if exists players_self_update on players;
drop policy if exists game_roles_member_select on game_roles;
create policy game_roles_member_select on game_roles for select using (public.is_game_member(game_id));
drop policy if exists player_roles_owner_or_self_select on player_roles;
create policy player_roles_owner_or_self_select on player_roles for select using (public.is_game_owner(game_id) or exists (select 1 from players p where p.id = player_roles.player_id and p.user_id = auth.uid()));
drop policy if exists roles_authenticated_select on roles;
create policy roles_authenticated_select on roles for select to authenticated using (is_active = true);
-- Clients have no write policy for player_roles; assignments are server-only.
do $$ begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end $$;
create index if not exists players_game_id_idx on players(game_id);
create index if not exists player_roles_player_id_idx on player_roles(player_id);
