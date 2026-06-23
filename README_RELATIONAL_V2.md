# FHDC RecallDesk Relational Supabase v2 Patch

This patch replaces the temporary single-record Supabase bridge with proper Supabase tables for users, patients, assignments, calls, bookings, payments, flags and audit logs.

## Required deployment sequence

1. Apply the patch locally.
2. Run `supabase/schema.sql` in the Supabase SQL Editor. The SQL keeps `recalldesk_app_store` as backup and migrates existing JSON data into relational tables.
3. Change `.env.local` and Render environment variable:

```env
STORAGE_DRIVER=supabase_tables
```

4. Run locally:

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm.cmd run build
npm.cmd run dev:3001
```

5. Check:

```text
http://localhost:3001/api/health
```

Expected mode:

```json
"mode": "supabase-relational-tables"
```

6. Test login, settings, user edit/delete, assignment, staff login and call saving.
7. Commit, push and Render clear-cache deploy.

## Why this fixes the slow behaviour

The old bridge read and wrote one huge JSON record. This patch updates only the table involved in the action:

- Login reads only `app_users`.
- Settings reads only `app_users`.
- Assignment updates only selected `clean_patients`.
- Call logging inserts one `call_attempts` row.
- Dashboard uses count queries.
- Delete user deletes one user and releases pending assignments.
