# FHDC RecallDesk Layout and Conversion Bonus Patch

This patch improves the Current Users table actions and adds the 5% booking conversion bonus band.

Changes included:
- Smaller, cleaner user action buttons in the Current Users table.
- Better user status and role badges.
- Payment assumptions now include Conversion Bonus at 5% = 1,000.
- Payment calculation logic now pays the 5% conversion bonus where applicable.
- Existing local databases are automatically merged with new default assumptions, so the 5% band appears even if data/recalldesk-db.json already exists.
- Payment page now displays a compact Booking Conversion Bonus Table.

Apply by extracting into the fhdc-recalldesk folder and replacing files.
Then clear `.next` and restart the app.
