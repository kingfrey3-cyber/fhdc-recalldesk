# FHDC RecallDesk Date / Doctor / Queue Rebuild Patch

This patch replaces `lib/recallLogic.ts` with a stronger parser for FHDC exports.

It handles:
- `2nd Jan 2025`
- `2 Jan 2025`
- `02 Jul 2025`
- Excel date objects
- Excel serial dates
- dd/mm/yyyy and yyyy-mm-dd
- Doctor columns such as `Doctor`, `Clinician`, `Dentist`, `Provider`
- Category/company columns

After applying the patch, run:

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm.cmd run build
npm.cmd run dev:3001
```

Then run the SQL file in Supabase:

```text
supabase/reset_upload_derived_tables_for_date_rebuild.sql
```

Then re-upload the original visit exports in batches.

The patient queue should then show:
- Last Visit
- Last Doctor
- Oldest last visit first
- Missing dates last, not first
