create table if not exists public.league_state (
  id integer primary key check (id = 1),
  version bigint not null default 0,
  payload jsonb not null default '{"users":{},"sessions":{},"friends":{},"blocks":{},"challenges":{},"matches":{},"teams":{},"presence":{},"limits":{}}'::jsonb
);
alter table public.league_state enable row level security;
revoke all on public.league_state from anon, authenticated;
grant select, insert, update on public.league_state to service_role;
insert into public.league_state (id) values (1) on conflict do nothing;
