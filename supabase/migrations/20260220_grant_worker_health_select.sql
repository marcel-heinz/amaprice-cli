-- Allow website clients (anon/authenticated) to read the worker health view.
-- Run this migration in Supabase SQL editor.

grant usage on schema public to anon, authenticated;
grant select on table public.worker_health to anon, authenticated;

