# Union Arena Deck Analyzer

A simple GitHub Pages website that imports a Rugia Creation `deckEdit` URL.

## GitHub Pages

Upload these files to the root of your repository:

- `index.html`
- `style.css`
- `app.js`

Then enable:

Settings → Pages → Deploy from a branch → `main` → `/ (root)`

## Cloudflare Worker

1. Create a Cloudflare Worker.
2. Copy the contents of `worker.js` into it.
3. Deploy it.
4. Copy the Worker URL.
5. Open `app.js`.
6. Change:

```js
proxy: localStorage.getItem("ua_proxy") || ""
```

to:

```js
proxy: "https://YOUR-WORKER.workers.dev"
```

7. Commit the changed `app.js` to GitHub.

The Worker only accepts URLs from `rugiacreation.com`.

## Example

Paste a Rugia deckEdit URL:

https://rugiacreation.com/ua/deckEdit?Name=HK&Version=CSM&Deck=4UA53BT_1047|4UA53BT_1048|4UA53BT_1049

The site parses the deck and retrieves each card's Traditional Chinese card information.

## Important

Rugia's website structure may change. If its HTML changes, `parseRugiaHtml()` in `app.js` may need to be adjusted.
