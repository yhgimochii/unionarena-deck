# UA Deck Analyzer

GitHub Pages + Firebase version. The card sync uses Rugia Creation for Traditional Chinese card text and the official UNION ARENA card list for structured fields.

## Setup
1. Keep `firebase-config.js` configured.
2. Upload the files at the repository root.
3. Upload `.github/workflows/sync-cards.yml` and `scripts/sync_cards.py` too.
4. GitHub Settings → Actions → General → Workflow permissions → Read and write permissions.
5. GitHub → Actions → **Sync Union Arena card database** → **Run workflow**.
6. After it completes, refresh GitHub Pages.

The sync reads Rugia's public all-card listing, extracts card IDs/effects, then enriches cards from the official card detail pages. Existing hand-verified fields are preserved when the sync has no value.
