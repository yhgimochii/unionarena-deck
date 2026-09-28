let DB = {};
let deck = null;
let selected = null;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

async function init(){
  const response = await fetch("cards.json");
  if(!response.ok) throw new Error("cards.json 載入失敗：" + response.status);
  const data = await response.json();
  DB = {};
  data.forEach(card => DB[card.id] = card);
}

function parse(raw){
  raw = raw.trim();
  if(!raw) throw new Error("請先貼上 Rugia deckEdit 連結。");

  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("這不是有效的網址。請貼上完整的 Rugia deckEdit 連結。");
  }

  const version = u.searchParams.get("Version") || "";
  const source = u.searchParams.get("Deck") || "";

  if(!source) throw new Error("找不到 Deck 參數。");

  const cards = source.split("|").filter(Boolean).map(item => {
    // IMPORTANT: single backslash in the RegExp:
    // \d = digit. This fixes the previous 4UA53BT_1047 error.
    const m = item.match(/^(\d+)([A-Za-z0-9]+)_(\d+)(?:_(\d+))?$/);

    if(!m) throw new Error("無法辨識：" + item);

    return {
      qty: Number(m[1]),
      set: m[2],
      num: m[3],
      alt: m[4] || ""
    };
  });

  return {
    name: u.searchParams.get("Name") || "",
    version,
    cards
  };
}

function cardId(card){
  const m = card.num.match(/^(\d)(\d{3})$/);

  if(!deck.version){
    return `${card.set}/${card.num}`;
  }

  return `${card.set}/${deck.version}-${m ? m[1] + "-" + m[2] : card.num}`;
}

function rugia(card){
  const code = cardId(card).replace("/", "_");
  return `https://rugiacreation.com/ua/search?Name=HK&Card=${encodeURIComponent(code)}#${encodeURIComponent(code)}`;
}

function render(){
  if(!deck) return;

  $("deck").classList.remove("hidden");
  $("title").textContent = deck.name || "新牌組";

  const total = deck.cards.reduce((n,c) => n + c.qty, 0);
  $("meta").textContent = `${deck.version || "未知作品"} · ${total} 張 · ${deck.cards.length} 種`;

  $("cards").innerHTML = deck.cards.map((card,i) => {
    const d = DB[cardId(card)];

    return `
      <div class="card ${selected === i ? "on" : ""}" data-i="${i}">
        <div class="cardbody">
          <div class="nm">${esc(d?.name || "尚未收錄")}</div>
          <div class="id">${esc(cardId(card))}</div>
        </div>
        ${d?.rarity ? `<span class="rar">${esc(d.rarity)}</span>` : ""}
        <div class="qty">×${card.qty}</div>
      </div>`;
  }).join("");

  document.querySelectorAll(".card").forEach(el => {
    el.onclick = () => {
      selected = Number(el.dataset.i);
      render();
      detail();
    };
  });
}

function detail(){
  if(selected === null){
    $("detail").innerHTML = '<div class="empty">點擊左側卡片查看資料。</div>';
    return;
  }

  const card = deck.cards[selected];
  const d = DB[cardId(card)];

  if(!d){
    $("detail").innerHTML = `
      <div class="empty">
        找不到 ${esc(cardId(card))} 的本地資料。<br><br>
        <a class="link" href="${esc(rugia(card))}" target="_blank">前往 Rugia ↗</a>
      </div>`;
    return;
  }

  $("detail").innerHTML = `
    <div class="id">${esc(d.id)} (${esc(d.rarity)})</div>
    <h2>${esc(d.name)}</h2>
    <span class="rar">×${card.qty}</span>
    <div class="effect">
      <b>效果摘要</b><br>
      ${esc(d.summary)}
    </div>
    <a class="link" href="${esc(d.url || rugia(card))}" target="_blank">開啟 Rugia 卡片頁 ↗</a>`;
}

$("go").onclick = () => {
  try {
    deck = parse($("url").value);
    deck.name = $("name").value.trim() || deck.name;
    selected = null;
    render();
    detail();

    $("msg").textContent = `牌組匯入完成：${deck.cards.length} 種卡片。`;
    $("msg").style.color = "#25805b";
  } catch(error) {
    $("msg").textContent = error.message;
    $("msg").style.color = "#b34b35";
  }
};

$("clear").onclick = () => {
  $("deck").classList.add("hidden");
  deck = null;
  selected = null;
};

init().catch(error => {
  $("msg").textContent = "網站資料載入失敗：" + error.message;
  $("msg").style.color = "#b34b35";
});