# Latest default and administrator-only historical entry

User request: newest activity is default; past activities accept input only from the back office. This refines the existing reusable-activities release and retains existing publishing authorization.

Implementation choices: choose the available activity with the latest official start date; if tied, use the later catalog row. Unknown historical dates count as historical. An activity ends after its official final date in America/Asuncion. Training/pre-event entry remains allowed. Archived activities still require administration to reopen them before adding records. A known confirmed Request ID is acknowledged even after closure; unresolved queues are retained for administrator review.

General entry blocks ended activities even for an administrator. Reportes provides an explicit administrator entry action that opens the shared form in a clearly labeled back-office mode. Every request carries its original mode and activity, and the backend independently verifies Jaime's Google identity for historical writes. Unidentified legacy activity labels cannot bypass the historical gate. OCR remains off for ended activities, including back-office entry; historical backfill is manual. Reports remain available.

Implementation choice: back-office entry may optionally specify the actual visit date (valid and no later than today); reports use that date while Timestamp records the real input time. Blank means today. Client resources have a release query to prevent a cached prior controller from mixing with the new markup.

1. Add failing backend tests for automatic default, historical/legacy bypass denial, explicit administrator entry, end-date boundary, lock recheck and duplicate acknowledgment.
2. Implement backend policy and UI back-office entry/exit, remove manual default controls, update Spanish/Chinese help. Test normal links, role changes and immutable queued modes.
3. Run full suite and independent review, then deploy the backend first and frontend second. Read back live default, closed historical entry, administrator UI and assets. No production sample activity, lead, paid OCR or email.
