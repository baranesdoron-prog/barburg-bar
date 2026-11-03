# Shift emails — setup

Employees get an email when they're signed up for an evening (by themselves or by a manager), when they're removed, when their evening is cancelled or its hours change, and a reminder at the time set on the users page (default: the day before at 08:00).

Emails only go to people who **chose email themselves** and consented. Choosing happens at account sign-up, in the shift sign-up popup, or on the profile page; an administrator can't choose for them. See also `docs/whatsapp.md`, which uses the same switches. Emails are sent through [Resend](https://resend.com) by the `send-shift-emails` Supabase edge function.

How it works:

- A trigger on `shift_assignments` queues a row in `shift_email_outbox` for every sign-up or removal (migration 101).
- Every minute, a `pg_cron` job queues any due reminders, and if anything is waiting it calls the edge function (migration 102).
- The edge function re-checks each row against the current assignments, builds the email and the calendar file, and sends it.

Nothing is queued while **התראות באימייל** under משתמשים → התראות על משמרות is off. While both channel switches are off, the app also shows no notification choices.

## One-time setup

1. **A domain.** Resend only sends to other people from a domain you've verified, and `*.netlify.app` can't be verified. Buy one in Netlify (Domains → Add or register domain); Netlify then manages its DNS.
2. **Resend.** Create an account, then Domains → Add domain. Add the DNS records Resend shows in Netlify (Domains → your domain → DNS settings → Add new record). Wait for Resend to show *Verified*. Then go to API Keys → Create API key, with "Sending access".
3. **Function secrets.** In the Supabase dashboard, go to Edge Functions → Secrets and add:
   - `RESEND_API_KEY`: the key from step 2.
   - `EMAIL_FROM`: for example `ברבורג <shifts@your-domain>`.
   - `CRON_SECRET`: any long random string, for example from `openssl rand -hex 32`.
   - `APP_URL` (optional): defaults to `https://barburg-bar.netlify.app`.
4. **Deploy the function:**
   ```
   npx supabase functions deploy send-shift-emails
   ```
   `supabase/config.toml` sets `verify_jwt = false` for it, because the cron job has no user session. The function checks `CRON_SECRET` itself, and only lets administrators send test emails.
5. **Apply the migrations** (101 and 102) with `npm run db:push`. If 102 fails on `pg_cron` or `pg_net`, enable both under Database → Extensions in the dashboard and run it again.
6. **Tell the cron job where the function is.** In the dashboard's SQL editor, use the project ref from Project Settings and the same secret as `CRON_SECRET`:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-shift-emails', 'shift_emails_function_url');
   select vault.create_secret('<the CRON_SECRET value>', 'shift_emails_cron_secret');
   ```
7. **Turn it on.** On the users page:
   - Add the BCC addresses.
   - Press **שליחת מיילים לדוגמה אליי** and check the six sample emails.
   - Switch on **התראות באימייל**.

## Day to day

- **Who gets emails:** an employee needs an approved app account and must have chosen email. The email goes to the address they log in with. Everyone else is skipped.
- **Turning it off:** use the switch on the users page. Users' choices are kept, so turning it back on restores them. To stop the hidden copies, clear the BCC list and save.
- **Checking what was sent:** `shift_email_outbox` keeps every email, with `status` (sent, skipped, failed) and the reason in `error`. Admins can read it.
