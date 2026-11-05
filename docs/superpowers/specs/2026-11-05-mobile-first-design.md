# PTITP mobile-first registration design

Approved prototype: ../ptitp-mobile-design/index.html, authorized for commit, push and deployment on 2026-11-05.

The primary users are 6–8 Spanish-speaking staff entering visitors on phones. Preserve verified Google identity, original owner of pending submissions, server-enforced OCR 2026-11-06 through 2026-11-14 in America/Asuncion and Jaime-only report permissions. Production backend and historical spreadsheet records stay unchanged.

Use the approved solid palette: #006B5E primary actions, #14588F scanning/navigation, #172B3A text, #526573 secondary text, #F3F6F8 page, white controls. Unify type on IBM Plex Sans; 18px input text, 16px labels, about 14px help, 22–24px headings. Controls at least 48px high, inputs 52px, primary action 56px. Ratings have light backgrounds, dark text, selection outlines and checkmarks.

Place compact account identity in the header, with email and sign-out available on demand. Anonymous users retain a clear Google sign-in entry. Bring scanning to the top. Contact fields are name, company, phone and email; other contact fields expand. Separate Terreno and Nave estándar; choosing either opens surface/time details without deleting existing values. Keep every existing organization, timeline, next-step and other field reachable in expandable sections. Keep the same payload field names and A/B/C values.

Keep a fixed bottom action, Guardar y continuar, with truthful saved/pending/error state. Block submission during OCR. Preserve every queue item until confirmed, and preserve existing user/session revision protections. Account sign-out warns before discarding any entered field, including email-only drafts. Never persist Google ID tokens in drafts or queues.

Navigation becomes Registro, Materiales, Ayuda and administrator-only Reportes. Materiales retains all existing QR and maps; Ayuda retains Spanish and Traditional Chinese. Hide the savebar outside registration. Keyboard tab navigation skips hidden report tabs; an administrator who loses access while viewing reports returns to registration.

Ship frontend 1.13.0. No prototype users, fake scans, preview state controls or simulated reports may enter production. Verify 320/390/430px and desktop, run the complete existing suite plus meaningful new behavior tests, review the patch, then commit/push/merge and verify Pages and live assets.
