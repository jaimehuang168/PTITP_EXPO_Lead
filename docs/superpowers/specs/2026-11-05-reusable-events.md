# Reusable exhibition registration

User requirement: the approved phone interface must support future exhibitions. User explicitly chose the existing single Google Sheet, partitioned by activity. Continue existing publish authorization.

Add an Eventos settings sheet with stable ID, name, official start/end, OCR enabled/start/end, registration-list visibility, legacy name and revision. Bootstrap existing EXPO PBW (official Nov 10–14, OCR Nov 6–14 2026) and historical Expo Paraguay 2026 without inventing historical dates. Keep all existing visitor rows unchanged; append Evento ID only for new records, preserving old field order and Google audit columns.

Only verified jaimehuang168@gmail.com may create/update event settings. Use the existing authenticated POST, script lock and optimistic per-event revision. New events default OCR off. Existing shared 300/day OCR quota remains across events. Dates use America/Asuncion. Administrator may choose a default activity through the same UI; no new secret or manual code changes required.

Registration selector and header come from server configuration. Each event has a shareable ?evento=<stable-id> URL, preserved through version updates. Unknown/archived event links cannot silently register under the default. Changing events prompts before discarding any draft and is disabled during save/OCR. Queued records retain their original event ID and Google UID even after switching activities. Legacy clients/queued records without IDs remain accepted with original names; known legacy names are mapped to bootstrap event IDs.

Server derives canonical event name from ID, never trusts a contradictory client label. New events with identical display names remain separate by ID. Reports, PDFs, cards and manual email filter by selected ID; old rows without IDs match only the bootstrap legacy-name association. Keep a deliberate all-event history option. Official-date reports exclude training/pre/post entries; manual registration continues to allow backfill. Empty reports identify the selected event correctly.

Add administrator event editor in Reportes: choose existing/new activity, name, official dates, visibility, optional OCR dates, optional default, save and copy direct link. No operator can save settings. Keep generic Spanish-first teaching with dynamic selected dates and Traditional Chinese support.

Availability ruling: archiving stops new registration and closes direct links; reports remain available. Recheck availability after acquiring the write lock. A known Request ID already stored is acknowledged before that check; an unconfirmed archived queued request is retained with an actionable instruction to ask administration to reopen. Never delete queued records or visitor history automatically.

Frontend/backend version 1.14.0. Test partitioning, canonical labels, old rows/queues, date gates before paid work, admin settings/revision validation, event-switch races, deep links and report filters. Deploy backend first, then frontend; verify live default PBW still uses the approved dates and no test event/lead or paid OCR is created in production.
