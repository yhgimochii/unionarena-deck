# UA Deck Analyzer — Simple GitHub Pages Version

This version does NOT use Cloudflare or a backend.

Files:
- index.html
- style.css
- app.js
- cards.json

Upload all four files to the root of your GitHub repository and enable GitHub Pages.

The deck parser accepts Rugia `deckEdit` URLs. The included database currently contains the 13 cards from the example CSM deck:
047, 048, 049, 050, 051, 057, 059, 060, 061, 067, 076, 079, 080.

The displayed card text is a concise effect summary rather than a reproduction of the full source text. Each card has an "開啟 Rugia 卡片頁" link for the source page.

To add cards later, add another object to `cards.json` using:
id, rarity, name, summary, url.
