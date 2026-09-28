const $ = id => document.getElementById(id);

const CONFIG = {
  // Paste your deployed Cloudflare Worker URL here.
  // Example: https://ua-rugia-proxy.yourname.workers.dev
  proxy: localStorage.getItem("ua_proxy") || ""
};

let currentDeck = null;
let selectedIndex = null;
let cardData = {};

function escapeHtml(value=""){
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function parseDeck(raw){
  raw = raw.trim();
  let deck = raw, name="", version="";

  try{
    const url = new URL(raw);
    deck = url.searchParams.get("Deck") || "";
    name = url.searchParams.get("Name") || "";
    version = url.searchParams.get("Version") || "";
  }catch{}

  if(!deck) throw new Error("找不到 Deck 參數。請貼上完整 Rugia deckEdit 連結。");

  const cards = deck.split("|").filter(Boolean).map(item => {
    const m = item.match(/^(\d+)([A-Za-z0-9]+)_(\d+)(?:_(\d+))?$/);
    if(!m) throw new Error("無法辨識牌組項目："+item);
    return {
      qty:Number(m[1]),
      set:m[2],
      number:m[3],
      alt:m[4] || ""
    };
  });

  return {name,version,cards,source:raw};
}

function cardId(deck, card){
  const digits=card.number;
  // Rugia deck export uses e.g. UA53BT_1047.
  // 1047 => CSM-1-047 when Version=CSM.
  if(!deck.version) return `${card.set}_${digits}`;
  const m=digits.match(/^(\d)(\d{3})$/);
  if(!m) return `${card.set}_${digits}`;
  return `${card.set}/${deck.version}-${m[1]}-${m[2]}`;
}

function rugiaUrl(deck, card){
  const id=cardId(deck,card);
  const code=id.replace("/","_");
  return `https://rugiacreation.com/ua/search?Name=${encodeURIComponent("HK")}&Card=${encodeURIComponent(code)}#${encodeURIComponent(code)}`;
}

async function fetchCard(deck, card){
  const id=cardId(deck,card);
  const url=rugiaUrl(deck,card);

  if(cardData[id] && !cardData[id].error) return cardData[id];

  const endpoint=CONFIG.proxy
    ? CONFIG.proxy.replace(/\/$/,"")+"/?url="+encodeURIComponent(url)
    : url;

  const response=await fetch(endpoint);
  if(!response.ok) throw new Error(`HTTP ${response.status}`);

  const html=await response.text();
  const parsed=parseRugiaHtml(html,id);

  cardData[id]={...parsed,url};
  localStorage.setItem("ua_card_cache",JSON.stringify(cardData));
  return cardData[id];
}

function parseRugiaHtml(html,id){
  const doc=new DOMParser().parseFromString(html,"text/html");
  let text=(doc.body?.innerText || "").replace(/\u00a0/g," ").trim();

  const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const header=new RegExp(escaped+"\\s*\\(([^)]+)\\)","i").exec(text);

  if(!header) throw new Error(`找不到 ${id} 的卡片資料`);

  const start=header.index+header[0].length;
  let body=text.slice(start);

  const next=body.search(/\n[A-Z0-9]+\/[A-Z0-9-]+\s*\([^)]+\)/i);
  if(next>=0) body=body.slice(0,next);

  const lines=body.split(/\n+/).map(x=>x.trim()).filter(Boolean);

  // Remove generic page UI noise.
  const filtered=lines.filter(x =>
    !/^Image$/i.test(x) &&
    !/^輸入$/i.test(x) &&
    !/^搜尋/i.test(x) &&
    !/^入手方法[:：]/.test(x)
  );

  const name=filtered.shift() || "";
  const effect=filtered.join("\n\n").trim();

  return {
    id,
    rarity:header[1],
    name,
    effect
  };
}

function renderDeck(){
  if(!currentDeck) return;

  $("deckSection").classList.remove("hidden");
  $("deckTitle").textContent=currentDeck.name || "新牌組";
  $("deckMeta").textContent=
    `${currentDeck.version || "未知作品"} · `+
    `${currentDeck.cards.reduce((a,c)=>a+c.qty,0)} 張 · `+
    `${currentDeck.cards.length} 種`;

  $("cards").innerHTML=currentDeck.cards.map((c,i)=>{
    const id=cardId(currentDeck,c);
    const d=cardData[id] || {};
    const image=d.image || "";
    return `
      <div class="card ${selectedIndex===i?"active":""}" data-index="${i}">
        <div class="thumb">${image?`<img src="${escapeHtml(image)}">`:""}</div>
        <div class="card-main">
          <div class="card-name">${escapeHtml(d.name || id)}</div>
          <div class="card-id">${escapeHtml(id)}</div>
        </div>
        ${d.rarity?`<span class="badge">${escapeHtml(d.rarity)}</span>`:""}
        <div class="qty">×${c.qty}</div>
      </div>`;
  }).join("");

  document.querySelectorAll(".card").forEach(el=>{
    el.onclick=()=>{
      selectedIndex=Number(el.dataset.index);
      renderDeck();
      renderDetail();
    };
  });
}

function renderDetail(){
  if(selectedIndex===null){
    $("detail").innerHTML=`<div class="detail-empty">選擇一張卡片查看詳細資料。</div>`;
    return;
  }

  const c=currentDeck.cards[selectedIndex];
  const id=cardId(currentDeck,c);
  const d=cardData[id] || {};

  $("detail").innerHTML=`
    <div class="detail-top">
      <div class="large">${d.image?`<img src="${escapeHtml(d.image)}">`:""}</div>
      <div>
        <div class="detail-id">${escapeHtml(id)} ${d.rarity?`(${escapeHtml(d.rarity)})`:""}</div>
        <div class="detail-name">${escapeHtml(d.name || "尚未取得")}</div>
        <span class="badge">×${c.qty}</span>
      </div>
    </div>
    <div class="effect">${escapeHtml(d.effect || "尚未取得卡片效果。請確認 Cloudflare Worker 已設定。")}</div>
    <a class="detail-link" href="${escapeHtml(rugiaUrl(currentDeck,c))}" target="_blank">開啟 Rugia 卡片頁 ↗</a>
  `;
}

async function loadAllCards(){
  $("progress").classList.remove("hidden");
  let completed=0;
  const total=currentDeck.cards.length;

  for(const card of currentDeck.cards){
    const id=cardId(currentDeck,card);
    try{
      await fetchCard(currentDeck,card);
    }catch(error){
      cardData[id]={id,name:"資料取得失敗",effect:error.message,error:true,url:rugiaUrl(currentDeck,card)};
    }
    completed++;
    $("progress").textContent=`正在取得卡片資料：${completed}/${total}`;
    renderDeck();
    if(selectedIndex!==null) renderDetail();
  }

  $("progress").textContent=`完成：${total} 種卡片`;
  setTimeout(()=>$("progress").classList.add("hidden"),1800);
}

$("importBtn").onclick=async()=>{
  $("message").textContent="";
  try{
    currentDeck=parseDeck($("deckUrl").value);
    currentDeck.name=$("deckName").value.trim() || currentDeck.name || "新牌組";
    selectedIndex=null;
    renderDeck();
    renderDetail();
    await loadAllCards();
    $("message").textContent="牌組匯入完成。";
    $("message").className="message ok";
  }catch(e){
    $("message").textContent=e.message;
    $("message").className="message";
  }
};

$("refreshBtn").onclick=async()=>{
  if(!currentDeck)return;
  for(const card of currentDeck.cards){
    delete cardData[cardId(currentDeck,card)];
  }
  localStorage.setItem("ua_card_cache",JSON.stringify(cardData));
  await loadAllCards();
};

try{
  cardData=JSON.parse(localStorage.getItem("ua_card_cache")||"{}");
}catch{
  cardData={};
}
