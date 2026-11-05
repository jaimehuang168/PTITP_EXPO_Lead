# Reusable event settings implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. User approved one shared Google Sheet and reusable exhibition setup.

**Goal:** Make future exhibitions configurable and independently reportable without changing code.

**Architecture:** Eventos catalog in the existing bound Sheet; stable Evento ID appended to new Leads rows, with non-destructive legacy matching. Extend Google session config with selected/catalog metadata and add an event UI module. Preserve all current auth, queue and OCR quota contracts.

**Stack:** Existing Apps Script, static HTML/JS/CSS, Node/jsdom tests, existing Google auth and GitHub Pages.

**Spec:** docs/superpowers/specs/2026-11-05-reusable-events.md

## Constraints and review focus

- PBW official Nov 10–14 and OCR Nov 6–14 2026 must remain; new-event OCR defaults off and total cap remains 300/day.
- Only Jaime can update catalog/default; settings writes use version conflicts and a lock.
- Stable IDs prevent same-name/year events mixing; existing rows and pending records are preserved.
- Invalid event links fail closed; no silent fallback that mislabels a lead.
- Event switches cannot clear a different draft or apply late OCR; version reload preserves evento.

## Task 1: Backend catalog and partitioning

Files: Code.gs, test_events_backend.js, necessary external Sheet mock corrections.

- [x] Add failing real doPost/config/report tests for event creation/admin/revision, event-specific OCR before paid work, canonical identity, same-name isolation and legacy rows.
- [x] Implement catalog/setup and server ID filtering; preserve existing no-ID endpoints for legacy callers.
- [x] Run backend/new/full tests, syntax and whitespace checks.

## Task 2: Reusable frontend

Files: google-session.js, event-ui.js, index.html, mobile-ui.js/mobile.css, test_events_ui.js, browser auth fixtures.

- [x] Add failing session/UI tests for catalog selection, dirty-event switch, original-event queue, unknown URL, admin editing, report ID and preserved links.
- [x] Replace frontend PBW constants with server event state; add selector/editor and contextual dates.
- [x] Run new/full suite and browser checks with external-service fixtures.

## Task 3: Review and publish

- [x] Fresh independent review and regression fixes.
- [x] Update existing Apps Script source and deployment; initialize Eventos/audit header only, no visitor writes.
- [ ] Commit/push/merge and verify Pages plus production config, catalogs and asset hashes.

Do not create future sample events, visitor rows, paid OCR calls or report emails in production.
