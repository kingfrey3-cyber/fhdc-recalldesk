FHDC RecallDesk operational control patch

Fixes included:
- Prevents double-click duplicate user creation by adding busy states and duplicate-email checks.
- Adds visible success/error feedback after user creation, edits, resets and deletes.
- Adds admin user deletion with protection against deleting yourself or the last admin.
- Returns pending assignments from deleted users to unassigned.
- Forces write operations to read fresh Supabase state before saving, preventing stale assignment/call-log errors.
- Refreshes Calling List from fresh Supabase data after assignment and before call history loads.
- Adds assign/save busy states so users do not double-submit.
- Adds proxy.ts protected-route guard for Next.js 16 while leaving existing middleware intact.
- Improves user card layout so action buttons do not overflow.
