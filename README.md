# Gather — Team Resource Booking

An internal room and shared-equipment booking app. It uses Next.js App Router, TypeScript, Tailwind CSS, Zod, Supabase Auth/Postgres/RLS/Realtime, and a database-native exclusion constraint to prevent overlapping reservations.

## Stack

- Next.js 16.2 App Router and TypeScript 6.0.3
- Node.js 24
- Tailwind CSS v4
- Zod 4.4.3 at input boundaries
- Supabase Auth and Postgres 17, with the Supabase CLI for local development and migrations
- Supabase Realtime for notification inserts over a WebSocket subscription
- Vercel deployment; `ics` creates optional local calendar downloads

## Run locally

1. Install Node.js 24 and the Supabase CLI v2.109 or later.
2. Install dependencies with `npm install`.
3. Start the local Supabase stack with `supabase start`.
4. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `supabase status`.
5. Apply the database migration with `supabase db reset`.
6. Start the app with `npm run dev` and open `http://localhost:3000`.
7. Create an account through the app. To grant an operator admin access, use the Supabase SQL editor and run `update public.profiles set role = 'admin' where id = '<auth user UUID>';`.

Without Supabase credentials the app shows a preview with sample resources and bookings; writes and sign-in require a configured Supabase project.

## Booking conflict handling

Each booking has `starts_at` and `ends_at`, plus a generated `occupied` column containing a half-open `tstzrange` (`[start, end)`). The migration enables Postgres `btree_gist` and adds a GiST exclusion constraint on `(resource_id WITH =, occupied WITH &&)` for `pending` and `approved` rows. Postgres serializes conflicting index operations and rejects a second overlapping insert with SQLSTATE `23P01`, including simultaneous requests. The booking UI turns that database error into a useful “slot was just booked” message. Adjacent bookings are permitted because the range end is exclusive.

The app never relies on a client-side check as the source of truth. Booking requests go through `create_booking_series`, which inserts each requested week in one transaction. A conflict on any occurrence raises an error and rolls the entire series back. Pending approval requests reserve the same protected range, so an admin cannot approve a colliding request later. Rejected and cancelled rows no longer participate in the exclusion constraint and free the slot.

## Recurring bookings

Recurrence is materialized into individual `bookings` rows, one per week, with the same resource, user, local-intended UTC start/end offset by seven days, and a shared `series_id`. This keeps availability, approval, cancellation, and conflict handling explicit per occurrence rather than interpreting a repeating rule at query time. The current form supports 1–12 weekly occurrences at the same time and weekday.

## Roles, approval, and notifications

New profiles receive the `member` role from a trusted Auth trigger. An operator grants `admin` directly in the database; a client cannot update its own role because profile updates are limited to the display-name column. Resources are readable to authenticated team members and writable by admins. The RLS insert policy requires a booking on an approval-required resource to start as `pending`; direct API writes cannot create an approved booking for it. Only the `review_booking` database function allows admins to transition pending rows to approved or rejected, and it checks the caller's database role.

Database triggers create a notification for booking submissions and decisions. Authenticated users can read only their own notifications. The notification center subscribes to Supabase Realtime `INSERT` events filtered by the signed-in user's ID; it does not poll. Calendar downloads are generated from an approved booking at `/api/bookings/{id}/calendar` and do not call an external calendar service.

## Scope and next week

The prototype covers authentication, member/admin roles, resource management, a day/week availability view (hourly slots from 8 a.m. to 6 p.m. in the browser's local time), one-off and recurring booking requests, conflict-safe writes, approvals, live in-app notifications, and `.ics` export. It intentionally excludes external calendar sync, email/SMS reminders, payments, and multi-tenant support.

With another week, I would add a polished week-grid availability view with timezone-aware slot selection, series-level edit/cancel controls, audit history for admin decisions, and end-to-end concurrency checks against a local Postgres instance.

## Deployment

Create a Supabase project on Postgres 17, link it with `supabase link`, apply migrations using `supabase db push`, and configure the two public Supabase environment variables in Vercel. Set the Supabase Auth site URL to the deployed app URL. Promote the first admin directly in the database as described above. No service-role key is needed by the web app.
