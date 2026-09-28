// Card data is loaded from cards-data.js (no fetch, so it also works when opened as a local file).
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const BASE = {};
(window.CARDS || []).forEach(c => BASE[c.id] = c);
let custom = load("ua_cards_v2", {});           // text you pasted from Rugia, saved in this browser
let deck = load("ua_last_deck", null);
let selected = null;

const info = id => ({ ...(BASE[id] || {}), ...(custom[id] || {}) });
const known = id => !!(BASE[id] || custom[id]);

function parse(raw) {
  raw = raw.trim();
  if (!raw) throw new Error("請先貼上 Rugia deckEdit 連結。");
  let source = raw, name = "", version = "";
  if (/^https?:/i.test(raw)) {
    let u; try { u = new URL(raw); } catch { throw new Error("這不是有效的網址。請貼上完整的 Rugia deckEdit 連結。"); }
    source = u.searchParams.get("Deck") || "";
    name = u.searchParams.get("Name") || "";
    version = u.searchParams.get("Version") || "";
    if (!source) throw new Error("找不到 Deck 參數，請確認連結完整。");
  } else {
    source = raw.replace(/^.*Deck=/, "");
  }
  const cards = source.split("|").map(s => s.trim()).filter(Boolean).map(item => {
    const m = item.match(/^(\d+)([A-Za-z0-9]+)_(\d+)(?:_(\d+))?$/);
    if (!m) throw new Error("無法辨識：" + item);
    return { qty: +m[1], set: m[2], num: m[3], alt: m[4] || "" };
  });
  if (!cards.length) throw new Error("Deck 內容是空的。");
  return { name, version, cards };
}

// 4UA53BT_1047 + version CSM  ->  UA53BT/CSM-1-047
function cardId(c) {
  const m = c.num.match(/^(\d)(\d{3})$/);
  if (!deck.version || !m) return `${c.set}/${c.num}`;
  return `${c.set}/${deck.version}-${m[1]}-${m[2]}`;
}
function rugia(c) {
  const code = cardId(c).replace("/", "_"), nm = deck.rname ? "Name=" + encodeURIComponent(deck.rname) + "&" : "";
  return `https://rugiacreation.com/ua/search?${nm}Card=${encodeURIComponent(code)}#${encodeURIComponent(code)}`;
}
function fmt(t) {
  return esc(t)
    .replace(/(主起動|登場時|退場時|攻擊時|阻擋時|自己回合中|對手回合中|抽牌|激活時|突襲)/g, '<span class="kw">$1</span>')
    .replace(/(回合1次|回合１次)/g, '<span class="bx">$1</span>')
    .replace(/(休息)/g, '<span class="rs">$1</span>');
}
// Card images are shown straight from Rugia Creation (nothing is downloaded or copied).
// Pattern: https://rugiacreation.com/ua/cardlist/small/UA53BT_CSM-1-047.jpg?v=20260925
const IMG_VER = "20260925";   // change this if Rugia updates the ?v= value
const remoteImg = id => `https://rugiacreation.com/ua/cardlist/small/${id.replace("/", "_")}.jpg?v=${IMG_VER}`;
const localImg = id => info(id).image || "assets/cards/" + id.replace("/", "-") + ".jpg";
// Try Rugia first; if it fails to load, fall back to a local file in assets/cards/, otherwise show nothing.
function imgTag(id) {
  return `<img src="${esc(remoteImg(id))}" data-local="${esc(localImg(id))}" alt="" referrerpolicy="no-referrer" loading="lazy">`;
}
document.addEventListener("error", e => {
  const t = e.target;
  if (t.tagName !== "IMG" || !t.dataset.local) return;
  if (t.dataset.tried) return t.remove();
  t.dataset.tried = "1"; t.src = t.dataset.local;
}, true);

function render() {
  if (!deck) { $("deck").classList.add("hidden"); return; }
  $("deck").classList.remove("hidden");
  $("title").textContent = deck.name || "新牌組";
  const total = deck.cards.reduce((n, c) => n + c.qty, 0);
  const missing = deck.cards.filter(c => !known(cardId(c))).length;
  $("meta").textContent = `${deck.version || "未知作品"} · ${total} 張 · ${deck.cards.length} 種` + (missing ? ` · ${missing} 種尚未收錄` : "");
  $("cards").innerHTML = deck.cards.map((c, i) => {
    const id = cardId(c), d = info(id);
    return `<div class="card ${selected === i ? "on" : ""}" data-i="${i}">
      <div class="thumb">${imgTag(id)}</div>
      <div class="cardbody"><div class="nm">${esc(d.name || "尚未收錄")}${c.alt ? " · 異圖" + esc(c.alt) : ""}</div><div class="id">${esc(id)}</div></div>
      ${d.rarity ? `<span class="rar">${esc(d.rarity)}</span>` : ""}<div class="qty">×${c.qty}</div></div>`;
  }).join("");
  document.querySelectorAll(".card").forEach(el => el.onclick = () => { selected = +el.dataset.i; render(); detail(); });
}

function detail() {
  const el = $("detail");
  if (selected === null || !deck) { el.innerHTML = '<div class="empty">點擊左側卡片查看資料。</div>'; return; }
  const c = deck.cards[selected], id = cardId(c), d = info(id);
  const body = d.text ? `<div class="effect">${fmt(d.text)}</div>`
    : d.summary ? `<div class="effect">${esc(d.summary)}</div><div class="warn">這只是簡短摘要，尚未與 Rugia 原文核對。請從 Rugia 卡片頁複製原文，貼在下方即可取代。</div>`
    : `<div class="warn">資料庫還沒有 ${esc(id)}。請從 Rugia 卡片頁複製原文，貼在下方。</div>`;
  el.innerHTML = `<div class="viewer"><div class="big">${imgTag(id)}</div>
    <div class="r"><div class="id">${esc(id)}${d.rarity ? " (" + esc(d.rarity) + ")" : ""}</div><div class="cname">${esc(d.name || "尚未收錄")}</div>${body}</div></div>
    <a class="link" href="${esc(rugia(c))}" target="_blank" rel="noopener noreferrer">開啟 Rugia 卡片頁 ↗</a>
    <div class="edit"><label for="paste">貼上 Rugia 卡片頁內容（卡號、卡名、效果）</label><textarea id="paste"></textarea><button id="savepaste">儲存這張卡</button></div>`;
  $("savepaste").onclick = () => {
    const r = parseCards($("paste").value, id)[0];
    if (!r) return setMsg("貼上的內容至少要包含卡名與效果文字。", false);
    custom[r.id] = { ...custom[r.id], ...r }; save("ua_cards_v2", custom); render(); detail();
  };
}

// Parses text copied from Rugia. Cards start with a line like "UA53BT/CSM-1-049 (U)"; then name; then effect.
function parseCards(text, fallbackId) {
  const re = /^([A-Za-z0-9]+\/[A-Za-z0-9]+-\d-\d{3})\s*\((\w+)\)/, out = []; let cur = null;
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(re);
    if (m) { cur = { id: m[1], rarity: m[2], lines: [] }; out.push(cur); }
    else { if (!cur) { cur = { id: fallbackId, lines: [] }; out.push(cur); } cur.lines.push(line); }
  }
  return out.filter(c => c.id && c.lines.length >= 2).map(c => ({ id: c.id, ...(c.rarity ? { rarity: c.rarity } : {}), name: c.lines[0], text: c.lines.slice(1).join("\n") }));
}

function setMsg(t, ok) { $("msg").textContent = t; $("msg").style.color = ok ? "#25805b" : "#b34b35"; }

$("go").onclick = () => {
  try {
    const p = parse($("url").value);
    deck = { name: $("name").value.trim() || p.name, rname: p.name, version: p.version, cards: p.cards };
    selected = null; save("ua_last_deck", deck); render(); detail();
    setMsg(`牌組匯入完成：${deck.cards.length} 種卡片。`, true);
  } catch (e) { setMsg(e.message, false); }
};
$("bulkgo").onclick = () => {
  const r = parseCards($("bulk").value);
  if (!r.length) return setMsg("找不到卡號，格式例如：UA53BT/CSM-1-047 (R)", false);
  r.forEach(c => custom[c.id] = { ...custom[c.id], ...c }); save("ua_cards_v2", custom);
  $("bulk").value = ""; setMsg(`已儲存 ${r.length} 張卡片。`, true); render(); detail();
};
$("clear").onclick = () => { deck = null; selected = null; save("ua_last_deck", null); render(); detail(); };

render(); detail();
