# WhatsApp notifications — setup

Volunteers can get shift notifications on WhatsApp through Meta's WhatsApp Cloud API. There's no intermediary such as Twilio. Sends go out when someone:

- signs up for an evening, or is assigned by a manager;
- is removed from an evening;
- has their evening cancelled or its hours changed;

and there's a reminder at the time the admin sets (default: the day before at 08:00, Israel time).

Everything is off until an administrator turns on **התראות ב־WhatsApp** in **משתמשים → התראות על משמרות**. Even then, a message only goes to someone who chose WhatsApp themselves and consented. Choosing happens at account sign-up, in the shift sign-up popup, or on the profile page. An administrator can't choose on someone's behalf; the database enforces this.

## How it fits together

| Piece | Where |
|---|---|
| Choices, consent, settings, queue + permanent log | migration `103_notification_preferences_and_whatsapp.sql` (`employees.notify_*`, `app_settings`, `whatsapp_templates`, `whatsapp_messages`) |
| Queuing | database triggers on `shift_assignments` (sign-up, removal) and `shifts` (cancelled, hours changed), plus `enqueue_shift_reminders()` |
| Sending | `netlify/functions/whatsapp-dispatch.mts`, a Netlify scheduled function that runs every minute |
| Delivery statuses, "הסר" replies | `netlify/functions/whatsapp-webhook.mts` |
| Admin page `/admin/whatsapp` | `netlify/functions/whatsapp-admin.mts` (status, templates, test sends, history) |

Shift actions never wait on WhatsApp. The triggers only add rows to the queue, and any error in them is turned into a warning, so a sign-up can never fail because of a notification.

## One-time setup

1. **Meta accounts.** Create a developer account at developers.facebook.com and a Business Portfolio at business.facebook.com. A registered company isn't needed to start. Without business verification, Meta limits sending to roughly 250 different recipients per 24 hours.
2. **App.** In Meta for Developers, create an app of type *Business* and add the **WhatsApp** product. You get a test number.
3. **Test recipients.** In WhatsApp → API Setup → *To*, add up to 5 numbers. Each one confirms with a code.
4. **Permanent token.** In Business Settings → System users, create a system user. Give it the app and the WhatsApp account, then generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. The 24-hour token on the API Setup page won't do for production.
5. **Templates.** In WhatsApp Manager → Message templates, create three templates: category **Utility**, language **Hebrew (`he`)**. Use the names and bodies on the admin page (`shift_registration_he`, `shift_reminder_he`, `shift_update_he`). Meta rejects a body that ends with a parameter, so `shift_update_he` needs a closing line after `{{3}}`. Parameter values can't contain line breaks.
6. **Netlify environment variables** (Site configuration → Environment variables). All are server-only; never prefix them with `VITE_`.
   - `WHATSAPP_ACCESS_TOKEN`: the permanent token
   - `WHATSAPP_PHONE_NUMBER_ID`: from API Setup
   - `WHATSAPP_API_VERSION`: for example `v23.0`
   - `WHATSAPP_VERIFY_TOKEN`: any long random string you choose
   - `WHATSAPP_APP_SECRET`: App settings → Basic → App secret. Webhook signatures are checked with it; without it the webhook rejects everything.
   - `WHATSAPP_WABA_ID` (optional): the WhatsApp Business Account id. With it, template approval statuses sync from Meta automatically.
   - `SUPABASE_SERVICE_ROLE_KEY`: the **secret** service-role key, from Supabase → Project settings → API Keys. It's not the public anon key, and must never be a `VITE_` variable. The project address is taken from the existing `VITE_SUPABASE_URL`.
7. **Deploy:** push to `master`; Netlify builds the functions. Then apply the migration with `npm run db:push`.
8. **Webhook.** In WhatsApp → Configuration, set the callback URL to `https://barburg-bar.netlify.app/.netlify/functions/whatsapp-webhook` and the verify token to `WHATSAPP_VERIFY_TOKEN`. Then subscribe to **messages**.
9. **Test.** On `/admin/whatsapp`, check that every status row is ✓, then send a test template to one of the test recipients and watch it go to *נמסר* (delivered) / *נקרא* (read).
10. **Turn it on** under משתמשים → התראות על משמרות.

## Going to production

Add a real phone number in WhatsApp Manager. It must not be active on the WhatsApp app, or must be removed from it first. Verify it, get the display name approved, set the two-step PIN, and add a payment method. Business-initiated utility templates are charged per message; check Meta's rate card for Israel. Then switch `WHATSAPP_PHONE_NUMBER_ID` to the new number.

The admin page then shows **מצב ייצור** (production mode). A test send needs an explicit confirmation, and it only goes to someone who chose WhatsApp themselves.

## Day to day

- **Removal by reply:** someone who replies **הסר** (or STOP) is turned off from WhatsApp right away, gets a confirmation, and nothing more is sent to them. They can turn it back on themselves from the profile page.
- **Retries:** failed sends retry after 1, 5 and 30 minutes, then after 2 and 6 hours. Errors that won't go away, such as an invalid number or an unknown template, fail immediately. A send interrupted mid-way is marked *לא ידוע* (unknown) rather than retried, so nobody gets it twice.
- **Message history:** `whatsapp_messages` keeps every message permanently. Admins can read it; only the server writes to it.
