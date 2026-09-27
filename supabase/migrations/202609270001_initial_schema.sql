create extension if not exists btree_gist with schema extensions;

create type public.app_role as enum ('admin', 'member');
create type public.booking_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.notification_kind as enum ('confirmed', 'rejected', 'conflict', 'pending');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.app_role not null default 'member',
  created_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  capacity integer not null default 1 check (capacity between 1 and 500),
  kind text not null default 'room' check (kind in ('room', 'equipment')),
  requires_approval boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id),
  user_id uuid not null references public.profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status public.booking_status not null,
  note text check (char_length(note) <= 500),
  series_id uuid,
  created_at timestamptz not null default now(),
  constraint bookings_positive_duration check (ends_at > starts_at),
  constraint bookings_max_duration check (ends_at - starts_at <= interval '24 hours')
);

-- Half-open time ranges allow one booking to start exactly when another ends.
-- Pending requests reserve their slot too, so approval cannot cause a collision.
alter table public.bookings add constraint bookings_no_resource_overlap
  exclude using gist (resource_id with =, occupied with &&)
  where (status in ('pending', 'approved'));

create index bookings_resource_start_idx on public.bookings (resource_id, starts_at);
create index bookings_user_start_idx on public.bookings (user_id, starts_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  kind public.notification_kind not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

create function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;

create function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create function public.create_booking_series(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_weeks integer default 1,
  p_note text default null
) returns setof uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_requires_approval boolean;
  v_status public.booking_status;
  v_series uuid := gen_random_uuid();
  v_id uuid;
  i integer;
begin
  if v_user_id is null then raise exception 'Sign in to book a resource' using errcode = '28000'; end if;
  if p_weeks < 1 or p_weeks > 12 then raise exception 'Choose between 1 and 12 weekly bookings'; end if;
  if p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '24 hours' then raise exception 'Choose a valid booking duration'; end if;
  select r.requires_approval into v_requires_approval from public.resources r where r.id = p_resource_id;
  if not found then raise exception 'Resource not found'; end if;
  v_status := case when v_requires_approval then 'pending'::public.booking_status else 'approved'::public.booking_status end;
  for i in 0..(p_weeks - 1) loop
    insert into public.bookings(resource_id, user_id, starts_at, ends_at, status, note, series_id)
    values (p_resource_id, v_user_id, p_starts_at + (i * interval '7 days'), p_ends_at + (i * interval '7 days'), v_status, nullif(left(p_note, 500), ''), v_series)
    returning id into v_id;
    return next v_id;
  end loop;
  return;
end;
$$;

create function public.review_booking(p_booking_id uuid, p_status public.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Only admins can review bookings' using errcode = '42501'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Review status must be approved or rejected'; end if;
  update public.bookings set status = p_status
  where id = p_booking_id and status = 'pending';
  if not found then raise exception 'Booking is no longer pending'; end if;
end;
$$;

create function public.record_booking_conflict(p_resource_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_resource text;
begin
  if v_user_id is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  select name into v_resource from public.resources where id = p_resource_id;
  if not found then raise exception 'Resource not found'; end if;
  insert into public.notifications(user_id, kind, message)
  values (v_user_id, 'conflict', 'A requested time for ' || v_resource || ' was already booked. Choose another slot.');
end;
$$;

create function public.notify_booking_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.notification_kind;
  v_message text;
  v_resource text;
begin
  select name into v_resource from public.resources where id = new.resource_id;
  if tg_op = 'INSERT' then
    v_kind := case when new.status = 'pending' then 'pending'::public.notification_kind else 'confirmed'::public.notification_kind end;
    v_message := case when new.status = 'pending' then 'Your request for ' || v_resource || ' is awaiting approval.' else 'Your booking for ' || v_resource || ' is confirmed.' end;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    v_kind := case when new.status = 'approved' then 'confirmed'::public.notification_kind else 'rejected'::public.notification_kind end;
    v_message := case when new.status = 'approved' then 'Your booking for ' || v_resource || ' was approved.' else 'Your booking for ' || v_resource || ' was declined.' end;
  else return new;
  end if;
  insert into public.notifications(user_id, booking_id, kind, message) values (new.user_id, new.id, v_kind, v_message);
  return new;
end;
$$;
create trigger booking_notification after insert or update of status on public.bookings
  for each row execute function public.notify_booking_change();

alter table public.profiles enable row level security;
alter table public.resources enable row level security;
alter table public.bookings enable row level security;
alter table public.notifications enable row level security;

create policy "Members can read team profiles" on public.profiles for select to authenticated using (true);
create policy "Users update their display name" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Authenticated users view resources" on public.resources for select to authenticated using (true);
create policy "Admins manage resources" on public.resources for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Users read bookings for team availability" on public.bookings for select to authenticated using (true);
create policy "Users insert their own correctly initialized bookings" on public.bookings for insert to authenticated
  with check (
    user_id = (select auth.uid()) and
    status = (select case when r.requires_approval then 'pending'::public.booking_status else 'approved'::public.booking_status end
      from public.resources r where r.id = resource_id)
  );
create policy "Admins update bookings" on public.bookings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Users view own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "Users mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.resources to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select, update on public.notifications to authenticated;
grant execute on function public.create_booking_series(uuid, timestamptz, timestamptz, integer, text) to authenticated;
grant execute on function public.review_booking(uuid, public.booking_status) to authenticated;
grant execute on function public.record_booking_conflict(uuid) to authenticated;

-- Admin membership is granted explicitly by an operator, never by client input:
-- update public.profiles set role = 'admin' where id = '<auth user UUID>';

alter publication supabase_realtime add table public.notifications;
