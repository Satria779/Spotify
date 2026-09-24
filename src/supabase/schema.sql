-- Satria Music social backend
-- Run this in the Supabase SQL editor before enabling the social UI.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_.-]{3,24}$'),
  avatar_url text,
  bio text check (char_length(coalesce(bio, '')) <= 160),
  country text,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 2000),
  metadata jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'other')),
  created_at timestamptz not null default now()
);

create index if not exists follows_following_idx on public.follows(following_id);
create index if not exists members_user_idx on public.conversation_members(user_id, conversation_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index if not exists messages_receiver_unread_idx on public.messages(receiver_id, read_at) where read_at is null;
create index if not exists blocks_blocked_idx on public.blocks(blocked_id);
create index if not exists profiles_username_lower_idx on public.profiles using btree (username);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists conversation_message_meta on public.messages;
create or replace function public.update_conversation_message_meta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.conversations
  set updated_at = new.created_at,
      last_message_at = new.created_at,
      last_message_preview = case when new.deleted_at is not null then 'Pesan dihapus' else left(new.message, 160) end
  where id = new.conversation_id;
  return new;
end;
$$;
create trigger conversation_message_meta after insert or update of message, deleted_at on public.messages for each row execute function public.update_conversation_message_meta();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
begin
  desired_username := lower(trim(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))));
  desired_username := regexp_replace(desired_username, '[^a-z0-9_.-]', '-', 'g');
  desired_username := left(desired_username, 24);
  if char_length(desired_username) < 3 then desired_username := 'user-' || substr(new.id::text, 1, 8); end if;
  if exists (select 1 from public.profiles where username = desired_username) then
    desired_username := left(desired_username, 15) || '-' || substr(new.id::text, 1, 8);
  end if;
  insert into public.profiles(id, username) values (new.id, desired_username);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();


create or replace function public.is_conversation_member(target_conversation_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.conversation_members where conversation_id = target_conversation_id and user_id = target_user_id);
$$;
revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

create or replace function public.create_direct_conversation(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_id uuid;
  new_id uuid;
begin
  if me is null then raise exception 'Not authenticated'; end if;
  if target_user_id is null or target_user_id = me then raise exception 'Invalid target'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then raise exception 'User not found'; end if;
  if exists (select 1 from public.blocks where blocker_id = me and blocked_id = target_user_id) or exists (select 1 from public.blocks where blocker_id = target_user_id and blocked_id = me) then raise exception 'User is blocked'; end if;
  select cm1.conversation_id into existing_id
  from public.conversation_members cm1
  join public.conversation_members cm2 on cm2.conversation_id = cm1.conversation_id
  where cm1.user_id = me and cm2.user_id = target_user_id
    and (select count(*) from public.conversation_members x where x.conversation_id = cm1.conversation_id) = 2
  limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.conversations default values returning id into new_id;
  insert into public.conversation_members(conversation_id, user_id) values (new_id, me), (new_id, target_user_id);
  return new_id;
end;
$$;

revoke all on function public.create_direct_conversation(uuid) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

-- Backfill profiles for Auth users that existed before this schema/trigger.
insert into public.profiles (id, username)
select u.id,
       case when exists (select 1 from public.profiles p where p.username = base_username)
            then left(base_username, 15) || '-' || substr(u.id::text, 1, 8)
            else base_username end
from (
  select u.*,
         left(regexp_replace(lower(trim(coalesce(u.raw_user_meta_data->>'username', split_part(coalesce(u.email, 'user'), '@', 1)))), '[^a-z0-9_.-]', '-', 'g'), 24) as base_username
  from auth.users u
) u
where not exists (select 1 from public.profiles p where p.id = u.id);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- Profiles contain only public-facing fields; email/password remain in Supabase Auth.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Follows.
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select to authenticated using (true);
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated with check ((select auth.uid()) = follower_id and follower_id <> following_id);
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using ((select auth.uid()) = follower_id);

-- Conversation access is membership-based.
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated using ((select public.is_conversation_member(id, auth.uid())));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated using ((select public.is_conversation_member(id, auth.uid()))) with check ((select public.is_conversation_member(id, auth.uid())));

drop policy if exists members_select on public.conversation_members;
create policy members_select on public.conversation_members for select to authenticated using ((select public.is_conversation_member(conversation_id, auth.uid())));
drop policy if exists members_insert on public.conversation_members;
create policy members_insert on public.conversation_members for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.conversations c where c.id = conversation_id));

revoke insert, update, delete on public.conversations from anon, authenticated;
revoke insert, update, delete on public.conversation_members from anon, authenticated;

-- Messages: members can read; only the authenticated sender can insert; receiver marks read through RPC; sender can soft-delete through RPC.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated using ((select public.is_conversation_member(conversation_id, auth.uid())));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = (select auth.uid())
  and (select public.is_conversation_member(conversation_id, auth.uid()))
  and (select public.is_conversation_member(conversation_id, receiver_id))
  and not exists (select 1 from public.blocks b where (b.blocker_id = sender_id and b.blocked_id = receiver_id) or (b.blocker_id = receiver_id and b.blocked_id = sender_id))
);

drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks for select to authenticated using (blocker_id = (select auth.uid()) or blocked_id = (select auth.uid()));
drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()) and blocker_id <> blocked_id);
drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()) and reporter_id <> reported_user_id);
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated using (reporter_id = (select auth.uid()));

-- Secure message updates through narrow RPCs rather than allowing arbitrary row mutation.
create or replace function public.mark_messages_read(target_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.conversation_members where conversation_id = target_conversation_id and user_id = auth.uid()) then
    raise exception 'Not a conversation member';
  end if;
  update public.messages
  set read_at = coalesce(read_at, now())
  where conversation_id = target_conversation_id and receiver_id = auth.uid() and read_at is null;
end;
$$;

create or replace function public.delete_message_for_everyone(target_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
  set deleted_at = now(), message = 'Pesan dihapus', metadata = null
  where id = target_message_id and sender_id = auth.uid();
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;
revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;
revoke update on public.messages from anon, authenticated;

-- Realtime Presence/Broadcast authorization. Restrict the topic to authenticated clients.
drop policy if exists realtime_presence_receive on realtime.messages;
create policy realtime_presence_receive on realtime.messages for select to authenticated using (
  (realtime.messages.extension = 'presence' and realtime.topic() = 'presence:global')
  or
  (realtime.messages.extension = 'broadcast' and split_part(realtime.topic(), ':', 1) = 'chat' and (select public.is_conversation_member(split_part(realtime.topic(), ':', 2)::uuid, auth.uid())))
);
drop policy if exists realtime_presence_send on realtime.messages;
create policy realtime_presence_send on realtime.messages for insert to authenticated with check (
  (realtime.messages.extension = 'presence' and realtime.topic() = 'presence:global')
  or
  (realtime.messages.extension = 'broadcast' and split_part(realtime.topic(), ':', 1) = 'chat' and (select public.is_conversation_member(split_part(realtime.topic(), ':', 2)::uuid, auth.uid())))
);

-- Realtime database changes for messages.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- Avatar storage bucket and policies.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do update set public = true;
drop policy if exists avatar_read on storage.objects;
create policy avatar_read on storage.objects for select to public using (bucket_id = 'avatars');
drop policy if exists avatar_insert on storage.objects;
create policy avatar_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatar_update on storage.objects;
create policy avatar_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatar_delete on storage.objects;
create policy avatar_delete on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Optional: in Supabase Dashboard > Realtime Settings, disable public channel access so the private:true channels above require RLS authorization.


-- ===== Community / music profile extensions =====
alter table public.profiles add column if not exists role text not null default 'user' check (role in ('user','founder'));
alter table public.profiles add column if not exists is_verified boolean not null default false;
alter table public.profiles add column if not exists verified_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists banned_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists liked_songs_public boolean not null default true;
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_banned_idx on public.profiles(is_banned, banned_until);

create table if not exists public.user_playlists (
  id text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_playlist_tracks (
  playlist_id text not null references public.user_playlists(id) on delete cascade,
  track_id text not null,
  position integer not null default 0,
  track jsonb not null,
  primary key (playlist_id, track_id)
);
create table if not exists public.user_liked_songs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  track_id text not null,
  track jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('chat_message','follow','system')),
  title text not null,
  body text,
  reference_id text,
  actor_id uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_playlists_owner_idx on public.user_playlists(owner_id, updated_at desc);
create index if not exists playlist_tracks_playlist_idx on public.user_playlist_tracks(playlist_id, position);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, read_at, created_at desc);

alter table public.user_playlists enable row level security;
alter table public.user_playlist_tracks enable row level security;
alter table public.user_liked_songs enable row level security;
alter table public.notifications enable row level security;

-- Public playlist metadata is readable; writes are owner-only.
drop policy if exists user_playlists_select on public.user_playlists;
create policy user_playlists_select on public.user_playlists for select to authenticated
using (owner_id = auth.uid() or is_public = true);
drop policy if exists user_playlists_insert on public.user_playlists;
create policy user_playlists_insert on public.user_playlists for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists user_playlists_update on public.user_playlists;
create policy user_playlists_update on public.user_playlists for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists user_playlists_delete on public.user_playlists;
create policy user_playlists_delete on public.user_playlists for delete to authenticated using (owner_id = auth.uid());

drop policy if exists playlist_tracks_select on public.user_playlist_tracks;
create policy playlist_tracks_select on public.user_playlist_tracks for select to authenticated
using (exists (select 1 from public.user_playlists p where p.id = playlist_id and (p.owner_id = auth.uid() or p.is_public = true)));
drop policy if exists playlist_tracks_insert on public.user_playlist_tracks;
create policy playlist_tracks_insert on public.user_playlist_tracks for insert to authenticated
with check (exists (select 1 from public.user_playlists p where p.id = playlist_id and p.owner_id = auth.uid()));
drop policy if exists playlist_tracks_update on public.user_playlist_tracks;
create policy playlist_tracks_update on public.user_playlist_tracks for update to authenticated
using (exists (select 1 from public.user_playlists p where p.id = playlist_id and p.owner_id = auth.uid()))
with check (exists (select 1 from public.user_playlists p where p.id = playlist_id and p.owner_id = auth.uid()));
drop policy if exists playlist_tracks_delete on public.user_playlist_tracks;
create policy playlist_tracks_delete on public.user_playlist_tracks for delete to authenticated
using (exists (select 1 from public.user_playlists p where p.id = playlist_id and p.owner_id = auth.uid()));

drop policy if exists liked_songs_select on public.user_liked_songs;
create policy liked_songs_select on public.user_liked_songs for select to authenticated
using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = user_id and p.liked_songs_public = true));
drop policy if exists liked_songs_insert on public.user_liked_songs;
create policy liked_songs_insert on public.user_liked_songs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists liked_songs_delete on public.user_liked_songs;
create policy liked_songs_delete on public.user_liked_songs for delete to authenticated using (user_id = auth.uid());

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Admin helpers. Founder status is stored in the database, never trusted from the browser.
create or replace function public.is_founder(target_user_id uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = target_user_id and role = 'founder'); $$;
revoke all on function public.is_founder(uuid) from public, anon;
grant execute on function public.is_founder(uuid) to authenticated;

create or replace function public.admin_list_users(search_text text default '')
returns setof public.profiles
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_founder(auth.uid()) then raise exception 'Forbidden'; end if;
  return query select p.* from public.profiles p
    where search_text = '' or p.username ilike '%' || search_text || '%'
    order by p.created_at desc limit 200;
end; $$;
revoke all on function public.admin_list_users(text) from public, anon;
grant execute on function public.admin_list_users(text) to authenticated;

create or replace function public.admin_set_verified(target_user_id uuid, enabled boolean)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_founder(auth.uid()) then raise exception 'Forbidden'; end if;
  if target_user_id = auth.uid() then raise exception 'Founder verification is controlled by founder role'; end if;
  update public.profiles set is_verified = enabled, verified_by = case when enabled then auth.uid() else null end where id = target_user_id;
end; $$;
revoke all on function public.admin_set_verified(uuid, boolean) from public, anon;
grant execute on function public.admin_set_verified(uuid, boolean) to authenticated;

create or replace function public.admin_set_ban(target_user_id uuid, banned boolean, reason text default null, until_at timestamptz default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_founder(auth.uid()) then raise exception 'Forbidden'; end if;
  if target_user_id = auth.uid() then raise exception 'Founder tidak dapat memban dirinya sendiri'; end if;
  update public.profiles
  set is_banned = banned,
      banned_at = case when banned then now() else null end,
      banned_until = case when banned then until_at else null end,
      banned_by = case when banned then auth.uid() else null end,
      ban_reason = case when banned then nullif(trim(reason), '') else null end
  where id = target_user_id;
end; $$;
revoke all on function public.admin_set_ban(uuid, boolean, text, timestamptz) from public, anon;
grant execute on function public.admin_set_ban(uuid, boolean, text, timestamptz) to authenticated;

create or replace function public.mark_chat_notifications_read(target_conversation_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.notifications n
  set read_at = coalesce(read_at, now())
  where n.user_id = auth.uid() and n.type = 'chat_message' and n.reference_id = target_conversation_id::text and n.read_at is null;
end; $$;
revoke all on function public.mark_chat_notifications_read(uuid) from public, anon;
grant execute on function public.mark_chat_notifications_read(uuid) to authenticated;

create or replace function public.create_chat_notification()
returns trigger language plpgsql security definer set search_path = public
as $$
declare sender_name text;
begin
  select username into sender_name from public.profiles where id = new.sender_id;
  insert into public.notifications(user_id,type,title,body,reference_id,actor_id)
  values(new.receiver_id,'chat_message','Pesan baru',coalesce(sender_name,'User') || ' mengirim pesan.',new.conversation_id::text,new.sender_id);
  return new;
end; $$;
drop trigger if exists message_notification_trigger on public.messages;
create trigger message_notification_trigger after insert on public.messages for each row execute function public.create_chat_notification();

-- Only allow users to edit safe profile fields themselves. Admin fields stay protected.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Realtime database changes for notifications and music-social tables.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then alter publication supabase_realtime add table public.notifications; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_playlists') then alter publication supabase_realtime add table public.user_playlists; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_liked_songs') then alter publication supabase_realtime add table public.user_liked_songs; end if;
end $$;

-- Seed/fix profiles for users created before these columns existed.
update public.profiles set role='user' where role is null;
update public.profiles set is_verified=false where is_verified is null;
update public.profiles set is_banned=false where is_banned is null;

-- Block banned sessions at the database layer as well. This prevents bypassing the UI with direct API calls.
create or replace function public.is_account_active()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select not is_banned or (banned_until is not null and banned_until <= now()) from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.is_account_active() from public, anon;
grant execute on function public.is_account_active() to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (auth.uid() = id or public.is_account_active());
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_account_active() and auth.uid() = id);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (public.is_account_active() and auth.uid() = id) with check (public.is_account_active() and auth.uid() = id);

drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select to authenticated using (public.is_account_active());
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated with check (public.is_account_active() and auth.uid() = follower_id and follower_id <> following_id);
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (public.is_account_active() and auth.uid() = follower_id);

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated using (public.is_account_active() and public.is_conversation_member(id, auth.uid()));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update to authenticated using (public.is_account_active() and public.is_conversation_member(id, auth.uid())) with check (public.is_account_active() and public.is_conversation_member(id, auth.uid()));

drop policy if exists members_select on public.conversation_members;
create policy members_select on public.conversation_members for select to authenticated using (public.is_account_active() and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists members_insert on public.conversation_members;
create policy members_insert on public.conversation_members for insert to authenticated with check (public.is_account_active() and auth.uid() = user_id and exists(select 1 from public.conversations c where c.id=conversation_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated using (public.is_account_active() and public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (public.is_account_active() and auth.uid() = sender_id and public.is_conversation_member(conversation_id, auth.uid()) and exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and cm.user_id=receiver_id));

drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks for select to authenticated using (public.is_account_active() and (blocker_id=auth.uid() or blocked_id=auth.uid()));
drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks for insert to authenticated with check (public.is_account_active() and blocker_id=auth.uid() and blocker_id<>blocked_id);
drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks for delete to authenticated using (public.is_account_active() and blocker_id=auth.uid());

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (public.is_account_active() and reporter_id=auth.uid() and reporter_id<>reported_user_id);
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated using (public.is_account_active() and reporter_id=auth.uid());

-- Also require active accounts for music-social tables.
drop policy if exists user_playlists_select on public.user_playlists;
create policy user_playlists_select on public.user_playlists for select to authenticated using (public.is_account_active() and (owner_id=auth.uid() or is_public=true));
drop policy if exists user_playlists_insert on public.user_playlists;
create policy user_playlists_insert on public.user_playlists for insert to authenticated with check (public.is_account_active() and owner_id=auth.uid());
drop policy if exists user_playlists_update on public.user_playlists;
create policy user_playlists_update on public.user_playlists for update to authenticated using (public.is_account_active() and owner_id=auth.uid()) with check (public.is_account_active() and owner_id=auth.uid());
drop policy if exists user_playlists_delete on public.user_playlists;
create policy user_playlists_delete on public.user_playlists for delete to authenticated using (public.is_account_active() and owner_id=auth.uid());

drop policy if exists playlist_tracks_select on public.user_playlist_tracks;
create policy playlist_tracks_select on public.user_playlist_tracks for select to authenticated using (public.is_account_active() and exists(select 1 from public.user_playlists p where p.id=playlist_id and (p.owner_id=auth.uid() or p.is_public=true)));
drop policy if exists playlist_tracks_insert on public.user_playlist_tracks;
create policy playlist_tracks_insert on public.user_playlist_tracks for insert to authenticated with check (public.is_account_active() and exists(select 1 from public.user_playlists p where p.id=playlist_id and p.owner_id=auth.uid()));
drop policy if exists playlist_tracks_update on public.user_playlist_tracks;
create policy playlist_tracks_update on public.user_playlist_tracks for update to authenticated using (public.is_account_active() and exists(select 1 from public.user_playlists p where p.id=playlist_id and p.owner_id=auth.uid())) with check (public.is_account_active() and exists(select 1 from public.user_playlists p where p.id=playlist_id and p.owner_id=auth.uid()));
drop policy if exists playlist_tracks_delete on public.user_playlist_tracks;
create policy playlist_tracks_delete on public.user_playlist_tracks for delete to authenticated using (public.is_account_active() and exists(select 1 from public.user_playlists p where p.id=playlist_id and p.owner_id=auth.uid()));

drop policy if exists liked_songs_select on public.user_liked_songs;
create policy liked_songs_select on public.user_liked_songs for select to authenticated using (public.is_account_active() and (user_id=auth.uid() or exists(select 1 from public.profiles p where p.id=user_id and p.liked_songs_public=true)));
drop policy if exists liked_songs_insert on public.user_liked_songs;
create policy liked_songs_insert on public.user_liked_songs for insert to authenticated with check (public.is_account_active() and user_id=auth.uid());
drop policy if exists liked_songs_delete on public.user_liked_songs;
create policy liked_songs_delete on public.user_liked_songs for delete to authenticated using (public.is_account_active() and user_id=auth.uid());

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (public.is_account_active() and user_id=auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated using (public.is_account_active() and user_id=auth.uid()) with check (public.is_account_active() and user_id=auth.uid());

-- Founder setup: after registering the founder account, run one line such as:
-- update public.profiles set role='founder', is_verified=true where username='your_founder_username';

create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.is_founder(auth.uid()) then
    new.role := old.role;
    new.is_verified := old.is_verified;
    new.verified_by := old.verified_by;
    new.is_banned := old.is_banned;
    new.banned_at := old.banned_at;
    new.banned_until := old.banned_until;
    new.banned_by := old.banned_by;
    new.ban_reason := old.ban_reason;
  end if;
  return new;
end; $$;
drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields before update on public.profiles for each row execute function public.protect_profile_privileged_fields();
