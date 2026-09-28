# UA Deck Analyzer - Fixed

The previous parser had an escaped RegExp bug. It could not recognize:
`4UA53BT_1047`

This version fixes the parser and includes:
- index.html
- style.css
- app.js
- cards.json

Upload/replace these files in the root of the GitHub repository.

After GitHub Pages redeploys, hard-refresh the browser with Ctrl+F5.
