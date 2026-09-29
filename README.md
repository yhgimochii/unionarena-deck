# Union Arena Deck Analyzer

GitHub Pages + Firebase deck storage. Card metadata is synchronized from Rugia Creation and structured fields are enriched from the official UNION ARENA card database.

## Card database sync

The GitHub Action `Sync Union Arena card database` discovers Rugia's IP/version filter options and queries each version separately. This is important because the generic Rugia search page does not necessarily expose every IP at once.

It also verifies `UA43BT/SMD-1-042` after the sync. If SAKAMOTO DAYS is missing, the workflow fails instead of silently committing an incomplete database.

Run it manually from **GitHub → Actions → Sync Union Arena card database → Run workflow**. It also runs weekly.

## Firebase

Keep `firebase-config.js` configured for your Firebase web app. Firestore rules are in `firestore.rules`.


## Card thumbnails
The frontend now shows lazy-loaded official UNION ARENA card images using the official card-image path derived from each card ID. No image files are stored in `cards.json`.
