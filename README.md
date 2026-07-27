# BARBURG

Community bar management platform. React + TypeScript + Vite frontend,
Supabase (Postgres + Auth + RLS) backend.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- Backend: Supabase (Postgres, Row Level Security, Supabase Auth)
- Hosting: Netlify (frontend), Supabase (backend)

## Identity model

Three separate concepts — never merge them:

- **Auth user** (`auth.users`, managed by Supabase Auth) — login only.
- **Application user** (`app_users`) — the one authoritative source of role,
  approval status, and permissions.
- **Employee** (`employees`) — operational record. May exist without a login;
  an `app_users` row may exist before it's linked to an employee.

Every new signup lands in `app_users` with `status = 'pending_approval'` and
`role = null` (via a database trigger — not application code). Only an
administrator can approve a user, via the `approve_user()` Postgres function.
All of this is enforced with Row Level Security in Postgres, not in the
frontend.

## First-time setup

1. **Install dependencies**

   ```
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com)
   (free tier is fine for development). Note the project ref, database
   password, project URL, and anon key (Project Settings → API).

3. **Link this repo to your Supabase project and push the schema**

   ```
   npm run db:link -- --project-ref <your-project-ref>
   npm run db:push
   ```

   This applies everything in `supabase/migrations/` to your project. No
   Docker required — migrations are pushed directly to the hosted project.

4. **Configure environment variables**

   ```
   cp .env.example .env.local
   ```

   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your
   Supabase project's API settings.

5. **Run the app**

   ```
   npm run dev
   ```

6. **Bootstrap the first administrator.** Sign up through the app once, then
   in the Supabase SQL editor run a **plain UPDATE**, not the `approve_user()`
   function:

   ```sql
   update app_users set role = 'administrator', status = 'approved', approved_at = now()
   where id = '<your-auth-user-id>';
   ```

   (Find your user id in Authentication → Users, or `select id from auth.users;`.)

   This has to be a raw UPDATE, not `select approve_user(...)`: that function
   checks `is_admin()`, which relies on `auth.uid()` — and the SQL editor (and
   any other direct-Postgres connection) has no authenticated session, so
   `auth.uid()` is always `null` there. `approve_user()` can only ever be
   called successfully through an authenticated request (i.e. from the app,
   by an existing admin) — which is exactly why bootstrapping the very first
   admin needs this one-off UPDATE instead. Once you have an admin, all
   further approvals go through **Admin → ניהול בקשות הצטרפות**
   (`/admin/approvals`) in the app — no more manual SQL needed.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm run lint` — run oxlint
- `npm run db:link` — link this repo to a Supabase project
- `npm run db:push` — push local migrations to the linked Supabase project

## Project status

Milestone 2 (admin approval flow) done, on top of Milestone 1 (identity &
permission foundation): registration, login, pending-approval gate, and an
admin screen to approve pending signups (assigning a role and creating or
linking an Employee) or reject them. No shift management, inventory, or
reporting yet — see the project plan for the full roadmap.
