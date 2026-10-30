-- Every minute: queue any due reminders, then -- only if something is
-- waiting -- call the send-shift-emails edge function to send the queue.
--
-- The function's URL and shared secret live in Supabase Vault rather
-- than in this file (one-time setup, see docs/shift-emails.md):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-shift-emails', 'shift_emails_function_url');
--   select vault.create_secret('<random secret>', 'shift_emails_cron_secret');
-- Until both exist the job just skips the call.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-shift-emails',
  '* * * * *',
  $job$
  select enqueue_shift_reminders();

  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'shift_emails_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'shift_emails_cron_secret')
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from shift_email_outbox where status = 'pending')
    and exists (select 1 from vault.decrypted_secrets where name = 'shift_emails_function_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'shift_emails_cron_secret');
  $job$
);
