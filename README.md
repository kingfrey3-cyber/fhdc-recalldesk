FHDC RecallDesk targeted operational fix patch

Fixes included:
- Create User now shows Creating user..., blocks duplicate clicks, and displays a success/error message.
- Duplicate user emails are prevented server-side.
- Admin can delete duplicate/wrong users, except self and last active admin.
- Delete user releases pending assigned patients from that user while preserving historical calls/bookings.
- Dashboard, calling list, assignments and call saving use fresh Supabase state, reducing stale assignment problems.
- Call save checks the fresh assignment state so staff should not get “assign first” after admin has assigned calls.
- Calling List fetches are no-store to reduce browser stale-state issues.

Apply, then run locally first:
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm.cmd run build
npm.cmd run dev:3001

Only push to GitHub and Render after npm.cmd run build succeeds.
