-- =============================================================================
-- RSVP → email notifications (queue + trigger + Supabase setup instructions)
-- =============================================================================
--
-- Postgres cannot send email by itself. This migration adds:
--   1) Table `rsvp_email_notification_queue` — one row per RSVP change to process.
--   2) Trigger on `calendar_event_rsvps` — enqueues when a player/parent updates status.
--
-- YOU STILL NEED (Dashboard / CLI — not expressible in SQL alone):
--
-- A) Edge Function `notify-rsvp-email` (recommended)
--    - Create: `supabase functions new notify-rsvp-email`
--    - In the function (TypeScript):
--        - Use the service role key only on the server (never in the browser).
--        - On each invocation: `select * from rsvp_email_notification_queue where processed_at is null order by created_at limit 20`
--        - For each row, join `calendar_events` + `teams` to find `coach_id` / `owner_id` / `assistant_coach_id`.
--        - Resolve coach emails via `supabase.auth.admin.getUserById` (Auth Admin API) or a `profiles` table if you store public email there.
--        - Send mail with Resend, SendGrid, or AWS SES HTTP API.
--        - `update rsvp_email_notification_queue set processed_at = now(), error = null where id = $1`
--        - On failure: set `error` column and optionally leave `processed_at` null for retry.
--    - Deploy: `supabase functions deploy notify-rsvp-email --no-verify-jwt` (invoke from cron or webhook with secret header).
--
-- B) Database Webhook (Supabase Dashboard → Database → Webhooks)
--    - Event: INSERT on `public.rsvp_email_notification_queue`
--    - Target: your Edge Function HTTPS URL or external worker.
--    - Payload includes `record` JSON; worker sends email then PATCHes `processed_at` via service role.
--
-- C) Optional: pg_cron (Supabase Pro) calling `net.http_post` to your worker — same idea as B.
--
-- D) Client hint: `rsvp.js` calls `supabase.functions.invoke('notify-rsvp-email', { body })` after a
--    successful RSVP upsert so coaches can get near-real-time mail without waiting for cron.
--    That function should validate JWT, then insert nothing extra OR dedupe — queue + trigger already capture DB truth.
--
-- =============================================================================

create table if not exists public.rsvp_email_notification_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  constraint rsvp_email_notification_queue_status_check check (status in ('available', 'late', 'out'))
);

create index if not exists rsvp_email_notification_queue_unprocessed_idx
  on public.rsvp_email_notification_queue (created_at)
  where processed_at is null;

comment on table public.rsvp_email_notification_queue is 'Outbox for RSVP email notifications; process with Edge Function + mail provider.';

alter table public.rsvp_email_notification_queue enable row level security;

-- No policies: authenticated/anon cannot read the outbox (service_role bypasses RLS for workers).

create or replace function public.fn_queue_rsvp_email_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then
      return new;
    end if;
  end if;

  insert into public.rsvp_email_notification_queue (event_id, actor_user_id, status)
  values (new.event_id, new.user_id, new.status);

  return new;
end;
$$;

drop trigger if exists trg_calendar_event_rsvps_enqueue_email on public.calendar_event_rsvps;

create trigger trg_calendar_event_rsvps_enqueue_email
  after insert or update of status on public.calendar_event_rsvps
  for each row
  execute function public.fn_queue_rsvp_email_notification();

-- If your Postgres build rejects EXECUTE FUNCTION, use:
--   execute procedure public.fn_queue_rsvp_email_notification();

comment on function public.fn_queue_rsvp_email_notification() is 'Enqueues RSVP rows for external email workers; see migration header comments.';
