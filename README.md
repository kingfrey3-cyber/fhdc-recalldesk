# FHDC RecallDesk Performance and Show-Up Table Patch

This patch improves the current Supabase bridge version by:

1. Adding a short server-side app-store cache so dashboard, patients, settings and payments do not read the full Supabase JSON store on every tab navigation.
2. Updating the cache immediately after every write so normal single-instance use stays fresh.
3. Optimising the calling list patient API by calculating call counts once instead of filtering call attempts repeatedly for every patient row.
4. Adding the Show Up Quality Gate table beside the Booking Conversion Bonus Table on the Payments page.
5. Adding a small CSS helper for the assumption tables.

Optional environment setting:
APP_STORE_CACHE_TTL_MS=120000

Default cache is 120 seconds. Set to 30000 if you want a shorter cache during testing.
