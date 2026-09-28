# UA Deck Analyzer — Universal IP version

This version accepts Rugia `deckEdit` URLs from different Union Arena IPs instead of hard-coding Chainsaw Man.

## Firebase
Keep your existing `firebase-config.js`, Firebase Authentication, Firestore and rules setup.

## GitHub Pages
Upload the contents of this folder to the repository root.

## Automatic multi-IP database sync
A GitHub Actions workflow at `.github/workflows/sync-cards.yml` periodically updates `cards.json` from Rugia's public Union Arena card pages. You can also run it manually from **GitHub → Actions → Sync Union Arena card database → Run workflow**.

The app itself can already parse arbitrary Rugia deckEdit URLs. Cards not yet present in the local database are still imported and show direct links to Rugia and the official Union Arena card list.

### Actions permission
If the workflow cannot push its updated `cards.json`, open:
**Repository → Settings → Actions → General → Workflow permissions → Read and write permissions**.

## Data attribution
Rugia Creation states that its Traditional Chinese card translations are produced by Rugia and requests attribution when its translations are used. Card images are owned by BANDAI CO., LTD. Keep the Rugia attribution/link in the site.
