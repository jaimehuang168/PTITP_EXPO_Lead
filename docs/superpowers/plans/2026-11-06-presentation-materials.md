# Visitor presentation materials

User asks to add the seven provided JPEGs as an app tab for staff to show potential clients. Keep original files/QR pixels unchanged; follow the existing Spanish-first phone interface and publishing authorization.

Design choice: add Presentación after Registro. Use the existing IBM Plex Sans and blue/green palette; the posters provide the main visual identity. Show a cover and compact thumbnail gallery with a full-viewport dialog. Order: PBW cover (p2), three ways (p5), stand map (p6), presentation (p4), guided visit (p3), company consultation (p7), rental inquiry (p1). Keep date-specific titles labeled PBW 2026; image content never changes registration dates or permissions.

The viewer provides previous/next, page count, zoom/reduce/fit, a closable keyboard-accessible dialog and pannable magnified images. Never crop posters or their QR codes. Closing returns focus to its opener. Switching tabs and presenting must preserve registration drafts. Small screens must retain access to all navigation tabs, including administrator reports. Images load from this same static site; no new external form submission or API access.

1. Add failing behavioral tests for gallery, navigation bounds, zoom reset, keyboard/close/focus, image failure and preserved draft.
2. Copy all seven originals to assets/presentation with descriptive filenames and verify byte hashes. Implement presentation module, responsive tab/gallery/dialog and bilingual guide instructions; version frontend 1.16.0. Backend remains 1.15.0.
3. Run full suite and independent review; verify phone/desktop layouts and actual image decoding through the browser. Commit/push/merge, wait for Pages and compare deployed assets, including all seven JPEGs. No visitor records, settings, OCR or emails are created.
