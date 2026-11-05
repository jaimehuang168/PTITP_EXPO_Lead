# Mobile-first registration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Publish the approved phone interface without regressing authentication, queued registrations or reports.

**Architecture:** Retain the existing Apps Script backend and inline registration controller. Reorganize markup while preserving field IDs and values; add a focused mobile stylesheet and small UI controller for expandable account/space sections, keyboard-safe action bar and truthful status. The UI controller receives no credentials and makes no API requests.

**Tech stack:** Static HTML, CSS, browser JavaScript, existing Google session module, Node/jsdom tests, GitHub Pages.

**Spec:** docs/superpowers/specs/2026-11-05-mobile-first-design.md

## Global constraints

- Frontend version 1.13.0; production API URL, backend authentication, dates and quota unchanged.
- Spanish-first; retain Traditional Chinese help and all existing fields/materials.
- No prototype fixtures or paid OCR/live test-lead writes.
- Existing queued records remain bound to original Google UID; no tokens in durable storage.
- Palette #006B5E/#14588F/#172B3A/#526573/#F3F6F8/white; 18px inputs and 48px touch targets.

## Review focus

- Submitting while OCR resolves must remain disabled; late responses must not modify another account's form.
- Email-only or company-only drafts must trigger a discard prompt on sign-out.
- Losing admin status while viewing a report must remove the report panel and tab from navigation.
- Collapsing optional fields or changing tabs must not lose values or remove them from the payload.
- Mobile keyboard/safe areas and long labels must not cover the focused input or the primary action.

## Task 1: Integrate approved interface with existing production behavior

Files: modify index.html, version.json, .gitignore; create mobile.css, mobile-ui.js, test_mobile_ui.js; adjust the existing exact-count interest assertion to cover the new separate values.

Interfaces: preserve all original DOM IDs and payload names. UI hooks are window.PtitpMobile.renderSession(snapshot), renderQueue(total, own), status(text, tone), reset(), hasDraft(). Native form ownership keeps the fixed button inside f.elements. The controller makes no requests and stores no records.

- [ ] Write behavior tests for separate space values, preserved optional payload, report-tab revocation and keyboard skip, OCR busy submit and non-name draft sign-out; run them and observe the missing behavior.
- [ ] Reorganize the existing DOM, add stylesheet/controller and narrow hooks; keep actual Google/queue/report code authoritative.
- [ ] Run node test_mobile_ui.js and npm test. Expected: new behavior checks and full suite pass.
- [ ] Run syntax checks and git diff --check; commit the tested implementation.

## Task 2: Review, publish and verify

Files: release notes in README.md; local review/verification artifacts under ignored .preview/ and .superpowers/.

Interfaces: Task 1's frontend receives existing /exec config and session responses; authenticated report POST remains unchanged.

- [ ] Inspect responsive UI at 320/390/430px and desktop using the actual assets and simulated external Google responses only for local UI checks.
- [ ] Request a fresh whole-branch review, resolve important findings with regressions, and rerun affected/full checks.
- [ ] Commit and push codex/mobile-first-interface; create and merge a PR against the verified current main head.
- [ ] Verify Pages deployment success, live version 1.13.0 and hashes of index/mobile assets. Confirm public backend still advertises Nov 6–14 OCR and Google auth. Inspect live anonymous UI and retain a screenshot.

User has explicitly authorized commit, push and deploy; execute without another approval handoff.
