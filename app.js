import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, serverTimestamp, query, orderBy, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
let DB={},deck=null,selected=null,currentUser=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const deckColorClass=c=>['red','blue','yellow','green','purple'].includes(c)?c:'red';
const deckColorName=c=>({red:'紅色',blue:'藍色',yellow:'黃色',green:'綠色',purple:'紫色'})[deckColorClass(c)];
async function initCards(){const r=await fetch("cards.json");if(!r.ok)throw Error("cards.json 載入失敗");const data=await r.json();data.forEach(c=>DB[c.id]=c);return data.length}
function parse(raw){raw=raw.trim();if(!raw)throw Error("請先貼上 Rugia deckEdit 連結。");let u;try{u=new URL(raw)}catch{throw Error("這不是有效的網址。")}const version=u.searchParams.get("Version")||"",source=u.searchParams.get("Deck")||"";if(!source)throw Error("找不到 Deck 參數。");const cards=source.split("|").filter(Boolean).map(item=>{const m=item.match(/^(\d+)([A-Za-z0-9]+)_(\d+)(?:_(\d+))?$/);if(!m)throw Error("無法辨識："+item);return{qty:+m[1],set:m[2],num:m[3],alt:m[4]||""}});return{name:u.searchParams.get("Name")||"",version,cards,source:raw}}
function cardIdForVersion(c,version=""){const m=c.num.match(/^(\d)(\d{3})$/);return `${c.set}/${version||""}${version?"-":""}${m?m[1]+"-"+m[2]:c.num}`}
function cardId(c){return cardIdForVersion(c,deck?.version||"")}
function cardIdNoDeck(c){const m=c.num.match(/^(\d)(\d{3})$/);return `${c.set}/${m?m[1]+"-"+m[2]:c.num}`}
function deckThumbnailId(d){
  // The first card in the current deck order is always the thumbnail.
  if(!d?.cards?.length)return "";
  const c=d.cards[0];
  return cardIdForVersion(c,d.version||"");
}
function deckThumbnailData(d){
  const id=deckThumbnailId(d);
  return id ? (DB[id]||DB[String(id).replace(/\/[^/]+$/,"")]) : null;
}
function rugia(c){const code=cardId(c).replace("/","_");return `https://rugiacreation.com/ua/search?Name=HK&Card=${encodeURIComponent(code)}#${encodeURIComponent(code)}`}
function officialSearch(c){const id=cardId(c);return `https://www.unionarena-tcg.com/en/cardlist/?search=true&keyword=${encodeURIComponent(id)}`}
function cardImageUrls(id){
 const raw=String(id||"").trim();
 if(!raw)return [];
 const parts=raw.split("/");
 const set=parts[0]||raw;
 const code=parts.slice(1).join("/");
 const variants=[
   `${set}_${code}`,
   raw.replaceAll("/","_"),
   `${set}-${code}`,
   raw
 ];
 const locales=["tc","en","jp"];
 const urls=[];
 for(const locale of locales){
   for(const file of variants){
     urls.push(`https://www.unionarena-tcg.com/${locale}/images/cardlist/card/${encodeURIComponent(file)}.png`);
   }
 }
 // Keep the original Asia/Traditional-Chinese path first because it is the source used by the site.
 return [...new Set(urls)];
}
function cardImage(id){return cardImageUrls(id)[0]||""}
window.uaImageFallback=function uaImageFallback(img){
 let list=[];
 try{list=JSON.parse(img.dataset.fallbacks||"[]")}catch(e){}
 const next=list.shift();
 img.dataset.fallbacks=JSON.stringify(list);
 if(next){img.src=next;return}
 const label=img.alt||"卡片圖片";
 const holder=document.createElement("div");
 holder.className=(img.className||"")+" img-fallback";
 holder.textContent=label;
 holder.title="卡片圖片暫時無法載入";
 img.replaceWith(holder);
}
function imageTag(id,name,cls="thumb"){
 const urls=cardImageUrls(id);
 const first=urls.shift()||"";
 return `<img class="${cls}" src="${esc(first)}" alt="${esc(name||id)}" loading="lazy" referrerpolicy="no-referrer" data-fallbacks='${esc(JSON.stringify(urls))}' onerror="window.uaImageFallback(this)">`;
}
const COMBAT_KEYWORDS=["衝擊無效","無效化衝擊","雙重攻擊","雙重阻擋","突襲","衝擊","狙擊","Step","Damage","Raid","Impact","Double Attack","Double Block","Snipe","Nullify Impact"];
const EFFECT_KEYWORDS=["攻擊結束時","主階段結束時","起動・主要","登場時","退場時","攻擊時","阻擋時","被攻擊時","主起動","自己回合中","對手回合中","激活時","休息時","When Played","When Sidelined","When Attacking","When Blocking","When Attacked","On Your Turn","On Opponent's Turn","On Opponent’s Turn","Activate: Main","Once Per Turn","每回合1次","回合1次"];
function escapeRegex(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function keywordClass(k){
  const value=String(k||"").toLowerCase();
  return COMBAT_KEYWORDS.some(x=>x.toLowerCase()===value)||/^(?:impact|damage|衝擊|傷害)/i.test(value)?"combat":"effect";
}
function highlightTrigger(text){
  const raw=String(text||'').trim();
  if(!raw)return '';
  const m=raw.match(/^(?:【|〖|\[)\s*(抽牌|加入手牌|激活|突襲|SPECIAL|FINAL|最終|特別|彩色)(?:】|〗|\])\s*/i);
  if(!m)return highlightEffect(raw,[]);
  let label=m[1];
  if(/^(?:最終|final)$/i.test(label))label='FINAL';
  if(/^(?:特別|special)$/i.test(label))label='SPECIAL';
  const type=label==='FINAL'?'final':label==='SPECIAL'?'special':label==='彩色'?'color':'common';
  const rest=raw.slice(m[0].length);
  return `<span class="keyword-chip trigger-chip trigger-${type}">${esc(label)}</span>${rest?` ${highlightEffect(rest,[])}`:''}`;
}

function restoreCombatImageKeywords(text){
  let out=String(text||'');
  const imageUrls=[];
  const tokenRe=/\[\[UAIMG:(https?:\/\/rugiacreation\.com\/[^\]<>"']+)\]\]/gi;

  // Keep the actual Rugia image instead of converting the keyword into text.
  out=out.replace(tokenRe,(m,url)=>{
    const i=imageUrls.push(url)-1;
    return `__UA_IMAGE_${i}__`;
  });

  // Backwards-compatible fallback for cards synced by an older parser.
  const circled={"0":"⓪","1":"➊","2":"➋","3":"➌","4":"➍","5":"➎","6":"➏","7":"➐","8":"➑","9":"➒"};
  const sym=n=>String(n||'').replace(/[０-９]/g,d=>String.fromCharCode(d.charCodeAt(0)-0xfee0)).split('').map(d=>circled[d]||d).join('');
  out=out.replace(/Image(?=\s*[（(]\s*進行攻擊並戰鬥勝利時，對手玩家受到\s*([0-9０-９]+)\s*點傷害)/g,(m,n)=>`衝擊${sym(n)}`);
  out=out.replace(/Image(?=\s*[（(]\s*此角色的攻擊給予的直接傷害為\s*([0-9０-９]+)\s*點傷害)/g,(m,n)=>`傷害${sym(n)}`);

  return {text:out,imageUrls};
}

function highlightEffect(text, traitKeywords=[]){
  const restored=restoreCombatImageKeywords(text);
  let out=esc(restored.text||"");
  const traits=[...new Set((traitKeywords||[]).filter(Boolean).map(String))];
  const entries=[
    ...COMBAT_KEYWORDS.map(text=>({text,className:"combat"})),
    ...EFFECT_KEYWORDS.map(text=>({text,className:"effect"})),
    ...traits.map(text=>({text,className:"trait"}))
  ].sort((a,b)=>b.text.length-a.text.length);

  if(!entries.length)return out.replace(/\n/g,"<br>");

  const pattern=entries.map(x=>escapeRegex(x.text)).join("|");

  // String.raw keeps the backslashes intact when building the RegExp.
  // This supports 【】, 〖〗 and [] wrappers and removes them from the chip.
  const re=new RegExp(
    String.raw`(?:【|〖|\[)?\s*(${pattern})(\s*[（(]?[+＋]?[0-9０-９]+[）)]?)?\s*(?:】|〗|\])?`,
    "giu"
  );

  out=out.replace(re,(match,keyword,suffix)=>{
    const entry=entries.find(x=>x.text.toLowerCase()===String(keyword).toLowerCase());
    const cls=entry?.className||keywordClass(keyword);
    return `<span class="keyword-chip ${cls}">${keyword}${suffix||""}</span>`;
  });

  out=out.replace(/__UA_IMAGE_(\d+)__/g,(m,i)=>{
    const url=restored.imageUrls[Number(i)];
    if(!url)return m;
    return `<img class="ua-keyword-icon" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  });
  return out.replace(/\n/g,"<br>");
}

function iconSvg(type){
  const paths={
    edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    trash:'<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type]||''}</svg>`;
}

function openEditDeck(){
  if(!currentUser){showAuth();return}
  if(!deck?.firestoreId){
    $('msg').textContent='請先儲存牌組後再編輯。';
    $('msg').style.color='#b34b35';
    return;
  }
  $('editDeckName').value=deck.name||'';
  $('editDeckColor').value=deckColorClass(deck.color||'red');
  updateEditColorPreview();
  $('editDeckModal').classList.remove('hidden');
}

function isRaidCard(d){
  if(!d)return false;
  const trigger=String(d.trigger||'');
  const effect=String(d.effect||'');
  return /\[\s*Raid\s*\]/i.test(trigger) || /〖\s*突襲\s*〗/i.test(trigger) || /(?:將此卡加入手牌.{0,40}進行突襲|在滿足能源需求的情況下進行突襲)/.test(effect);
}

function raidBadge(){
  return '<span class="raid-badge" aria-label="RAID">RAID</span>';
}

function render(){
  if(!deck)return;
  $('deck').classList.remove('hidden');
  $('title').innerHTML=`<span class="deck-title-dot ${deckColorClass(deck.color||'red')}"></span><span class="deck-title-name">${esc(deck.name||'新牌組')}</span><button id="editDeck" class="icon-btn deck-edit-icon" type="button" title="編輯牌組" aria-label="編輯牌組">${iconSvg('edit')}</button>`;
  $('editDeck').onclick=()=>openEditDeck();
  $('meta').textContent=`${deck.version||"未知作品"} · ${deck.cards.reduce((n,c)=>n+c.qty,0)} 張 · ${deck.cards.length} 種`;

  $('cards').innerHTML=deck.cards.map((c,i)=>{
    const d=DB[cardId(c)]||DB[cardIdNoDeck(c)];
    const id=cardId(c),name=d?.name||`未收錄：${id}`;
    return `<div class="card ${selected===i?"on":""}" data-i="${i}" role="button" tabindex="0" aria-label="查看 ${esc(name)}">
      ${imageTag(id,name)}
      ${deck?.thumbnailId===id?`<span class="deck-thumb-badge">縮圖</span>`:""}
      <div class="cardbody"><div class="nm">${esc(name)}${isRaidCard(d)?raidBadge():""}</div><div class="id">${esc(id)}</div></div>
      ${d?.rarity?`<span class="rar">${esc(d.rarity)}</span>`:""}
      <div class="qty">×${c.qty}</div>
      <div class="reorder-controls" aria-hidden="true"><button type="button" class="move-card-up" title="向前移動">↑</button><button type="button" class="move-card-down" title="向後移動">↓</button></div>
    </div>`;
  }).join('');

  // Bind directly to each card. Selection does NOT re-render the card grid.
  $('cards').querySelectorAll('.card').forEach(card=>{
    const selectCard=()=>{
      selected=Number(card.dataset.i);
      $('cards').querySelectorAll('.card').forEach(x=>x.classList.toggle('on',x===card));
      detail();
      if(window.matchMedia('(max-width: 700px), (pointer: coarse)').matches){
        openMobileDetail();
      }
    };
    card.onclick=selectCard;
    card.onkeydown=e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        selectCard();
      }
    };
  });
  bindReorderHandlers();
}

let reorderMode=false;
function renderReorderState(){
  const cardsBox=$('cards');
  if(!cardsBox)return;
  cardsBox.classList.toggle('reorder-mode',reorderMode);
  cardsBox.querySelectorAll('.card').forEach((card,i)=>{
    card.draggable=reorderMode;
    const up=card.querySelector('.move-card-up'),down=card.querySelector('.move-card-down');
    if(up)up.disabled=i===0;
    if(down)down.disabled=i===deck.cards.length-1;
  });
  const btn=$('reorderToggle');
  if(btn){btn.textContent=reorderMode?'完成排序':'排序';btn.setAttribute('aria-pressed',String(reorderMode));}
}
function bindReorderHandlers(){
  const cardsBox=$('cards');
  if(!cardsBox)return;
  cardsBox.querySelectorAll('.card').forEach(card=>{
    card.addEventListener('dragstart',e=>{if(!reorderMode){e.preventDefault();return} card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',card.dataset.i)});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
    card.addEventListener('dragover',e=>{if(reorderMode){e.preventDefault();card.classList.add('drag-over')}});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{
      if(!reorderMode)return; e.preventDefault(); card.classList.remove('drag-over');
      const from=Number(e.dataTransfer.getData('text/plain')),to=Number(card.dataset.i);
      if(Number.isInteger(from)&&Number.isInteger(to)&&from!==to)moveCard(from,to);
    });
    card.querySelector('.move-card-up')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();moveCard(Number(card.dataset.i),Number(card.dataset.i)-1)});
    card.querySelector('.move-card-down')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();moveCard(Number(card.dataset.i),Number(card.dataset.i)+1)});
  });
  renderReorderState();
}
async function moveCard(from,to){
  if(!deck||!reorderMode||to<0||to>=deck.cards.length||from===to)return;
  const [item]=deck.cards.splice(from,1);deck.cards.splice(to,0,item);
  if(selected===from)selected=to;
  else if(selected!==null && from<selected && selected<=to)selected--;
  else if(selected!==null && to<=selected && selected<from)selected++;

  // The first card in the new order becomes the deck thumbnail automatically.
  deck.thumbnailId=deckThumbnailId(deck);
  render();detail();

  // Persist the new order + thumbnail immediately for already-saved decks.
  if(deck.firestoreId && currentUser){
    try{
      await updateDoc(doc(db,'users',currentUser.uid,'decks',deck.firestoreId),{cards:deck.cards,thumbnailId:deck.thumbnailId});
      await loadSaved();
    }catch(e){
      console.error(e);
      $('msg').textContent='排序已變更，但儲存失敗，請按儲存圖示再試。';
      $('msg').style.color='#b34b35';
    }
  }
}

window.selectCardFromUI=(index)=>{
  if(!deck || !Number.isInteger(Number(index)))return;
  selected=Number(index);
  $('cards').querySelectorAll('.card').forEach((x,i)=>x.classList.toggle('on',i===selected));
  detail();
};


function translateTrigger(text){
  let t=String(text||"").trim();
  if(!t)return "";

  const exact={
    "[Draw] Draw 1 card.":"〖抽牌〗抽１張卡。",
    "[Draw] Draw a card.":"〖抽牌〗抽１張卡。",
    "[Get] Add this card to your hand.":"〖加入手牌〗將此卡加入手牌。",
    "[Active] Choose 1 Character card on your field, switch it to Active Mode, and it gets +3000 BP for the turn.":"〖激活〗選擇自己場上１張角色被激活，並且本回合中，BP＋3000。",
    "[Active] Choose one character on your field and switch it to active. It gains 3000 BP until the end of the turn.":"〖激活〗選擇自己場上１張角色被激活，並且本回合中，BP＋3000。",
    "[FINAL] If you have 0 life, place the top card of your deck into your life area.":"〖FINAL〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。",
    "[FINAL] If your life is at 0, place the top card of your deck in your Life Area.":"〖FINAL〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。",
    "[Final] If you have 0 life, place the top card of your deck into your life area.":"〖FINAL〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。",
    "[Raid] Add this card to your hand, or if the Required Energy is met, Raid it.":"〖突襲〗將此卡加入手牌，或在滿足能源需求的情況下進行突襲。",
    "[Raid] Add this card to your hand, or if you have the required energy, perform Raid with it.":"〖突襲〗將此卡加入手牌，或在滿足能源需求的情況下進行突襲。",
    "[SPECIAL] Choose 1 Character card on your opponent's Front Line and remove it from the field.":"〖SPECIAL〗選擇對手前線１張角色退場。",
    "[SPECIAL] Choose one character on your opponent's front line and sideline it.":"〖SPECIAL〗選擇對手前線１張角色退場。",
    "[Special] Choose one character on your opponent's front line and sideline it.":"〖SPECIAL〗選擇對手前線１張角色退場。",
    "〖抽牌〗抽１張卡。":"〖抽牌〗抽１張卡。",
    "〖激活〗選擇自己場上１張角色被激活，並且本回合中，BP＋3000。":"〖激活〗選擇自己場上１張角色被激活，並且本回合中，BP＋3000。",
    "〖特別〗選擇對手前線１張角色退場。":"〖SPECIAL〗選擇對手前線１張角色退場。",
    "〖最終〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。":"〖FINAL〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。",
    "〖FINAL〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。":"〖FINAL〗自己沒有生命值的情況下，將自己牌庫上面１張卡放置到自己的生命值區。",
    "〖突襲〗將此卡加入手牌，或若滿足能源需求時可發動突襲。":"〖突襲〗將此卡加入手牌，或在滿足能源需求的情況下進行突襲。",
    "〖突襲〗將此卡加入手牌，或在滿足能源需求的情況下進行突襲。":"〖突襲〗將此卡加入手牌，或在滿足能源需求的情況下進行突襲。"
  };
  if(exact[t])return exact[t];

  // Normalize SPECIAL / FINAL labels regardless of whether Rugia stored them
  // in English or Traditional Chinese. Their descriptions remain Traditional Chinese.
  t=t
    .replace(/^(?:\[|〖|【)\s*(?:SPECIAL|Special|特別)\s*(?:\]|〗|】)\s*/i,"〖SPECIAL〗")
    .replace(/^(?:\[|〖|【)\s*(?:FINAL|Final|最終)\s*(?:\]|〗|】)\s*/i,"〖FINAL〗");

  if(/^(?:〖SPECIAL〗|〖FINAL〗)/.test(t))return t;

  // Translate COLOR triggers while preserving the numeric conditions.
  // Rugia contains several English variants of the same COLOR trigger, so
  // normalize all of them into Traditional Chinese before highlighting.
  if(/^(?:\[|〖|【)\s*COLOR\s*(?:\]|〗|】)/i.test(t)){
    let body=t.replace(/^(?:\[|〖|【)\s*COLOR\s*(?:\]|〗|】)\s*/i,"");

    const colorRules=[
      [/^Choose (?:1|one) Character card on your opponent's Front Line and switch it to Rest Mode\. Then, it can't be switched back to Active Mode one time\.?$/i,
        "選擇對手前線１張角色休息。該角色下一次不能被激活。"],
      [/^Choose (?:1|one) character on your opponent's front line and switch it to resting\. It will remain set to resting the next time it would be switched to active\.?$/i,
        "選擇對手前線１張角色休息。該角色下一次被激活時仍會維持休息狀態。"],
      [/^Choose (?:1|one) Character card with (\d+) BP or less on your opponent's Front Line and return it to their hand\.?$/i,
        "選擇對手前線１張BP$1或以下的角色返回手牌。"],
      [/^Choose (?:1|one) character with (\d+) or less BP on your opponent's front line and return it to their hand\.?$/i,
        "選擇對手前線１張BP$1或以下的角色返回手牌。"],
      [/^Choose (?:1|one) Character card with (\d+) BP or less on your opponent's Front Line and return it to the hand\.?$/i,
        "選擇對手前線１張BP$1或以下的角色返回手牌。"],
      [/^Choose (?:1|one) character with (\d+) or less BP on your opponent's front line and return it to the hand\.?$/i,
        "選擇對手前線１張BP$1或以下的角色返回手牌。"],
      [/^Choose (?:1|one) Character card with (\d+) BP or less on your opponent's Front Line and (?:remove it from the field|sideline it)\.?$/i,
        "選擇對手前線１張BP$1或以下的角色退場。"],
      [/^Choose (?:1|one) character with (\d+) or less BP on your opponent's front line and sideline it\.?$/i,
        "選擇對手前線１張BP$1或以下的角色退場。"],
      [/^Choose (?:1|one) character on your opponent's front line and switch it to resting\. It will remain set to resting the next time it would be switched to active\.?$/i,
        "選擇對手前線１張角色休息。該角色下一次被激活時仍會維持休息狀態。"],
      [/^Play (?:1|one) (green|purple) Character card with (?:a )?Required Energy of 2 or less and (?:a )?consumed AP of 1 from your hand(?: set to active)? onto your field(?: in Active Mode)?\.?$/i,
        (m,color)=>`從手牌選擇１張${color.toLowerCase()==="green"?"綠色":"紫色"}能源需求２或以下及AP消耗１的角色卡，以激活狀態在自己場上登場。`],
      [/^Play (?:1|one) (green|purple) character card with 2 or less required energy and 1 AP cost from your hand set to active onto your field\.?$/i,
        (m,color)=>`從手牌選擇１張${color.toLowerCase()==="green"?"綠色":"紫色"}能源需求２或以下及AP消耗１的角色卡，以激活狀態在自己場上登場。`],
      [/^Play (?:1|one) (green|purple) character card with 2 or less required energy and 1 AP cost from your sideline set to active onto your front line\.?$/i,
        (m,color)=>`從場外選擇１張${color.toLowerCase()==="green"?"綠色":"紫色"}能源需求２或以下及AP消耗１的角色卡，以激活狀態在自己前線登場。`],
      [/^Play (?:1|one) (green|purple) Character card with (?:a )?Required Energy of 2 or less and (?:a )?consumed AP of 1 from your Outside Area on your Front Line in Active Mode\.?$/i,
        (m,color)=>`從場外選擇１張${color.toLowerCase()==="green"?"綠色":"紫色"}能源需求２或以下及AP消耗１的角色卡，以激活狀態在自己前線登場。`]
    ];

    for(const [re,replacement] of colorRules){
      const match=body.match(re);
      if(match){
        body=typeof replacement==='function'?replacement(...match):body.replace(re,replacement);
        break;
      }
    }

    return `〖彩色〗${body}`;
  }

  // Defensive fallback for any remaining English trigger.
  if(/^[\[]/.test(t)){
    return t
      .replace(/^\[Draw\]/i,"〖抽牌〗")
      .replace(/^\[Active\]/i,"〖激活〗")
      .replace(/^\[Get\]/i,"〖加入手牌〗")
      .replace(/^\[Raid\]/i,"〖突襲〗")
      .replace(/^\[Special\]/i,"〖SPECIAL〗")
      .replace(/^\[SPECIAL\]/i,"〖SPECIAL〗")
      .replace(/^\[Final\]/i,"〖FINAL〗")
      .replace(/^\[FINAL\]/i,"〖FINAL〗");
  }
  return t;
}

function normalizeForCompare(text){
  return String(text||"")
    .replace(/[【】〖〗\[\]]/g,"")
    .replace(/[\s　]+/g," ")
    .replace(/[。．]+$/g,"")
    .trim()
    .toLowerCase();
}

function stripTriggerFromEffect(effect,trigger){
  let source=String(effect||"").trim();
  if(!source || !trigger)return source;

  const triggerText=String(trigger||"").trim();
  if(!triggerText)return source;

  // Compare both the complete trigger and its body without the trigger label.
  const normalizedTrigger=normalizeForCompare(triggerText);
  const triggerBody=triggerText
    .replace(/^(?:【|〖|\[)\s*(?:抽牌|加入手牌|激活|突襲|SPECIAL|FINAL|特別|最終|彩色|COLOR)\s*(?:】|〗|\])\s*/i,"")
    .trim();
  const normalizedBody=normalizeForCompare(triggerBody);
  if(!normalizedTrigger && !normalizedBody)return source;

  const lines=source.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const kept=[];
  let removed=false;

  for(const line of lines){
    const n=normalizeForCompare(line);
    // Only remove standalone lines that exactly match the trigger. This avoids
    // deleting legitimate effect text that merely contains similar wording.
    if(n===normalizedTrigger || (normalizedBody && n===normalizedBody)){
      removed=true;
      continue;
    }
    kept.push(line);
  }

  if(removed)return kept.join("\n").trim();

  // Handle scrapers that append/prepend the trigger without a newline.
  const candidates=[triggerText,triggerBody].filter(Boolean).sort((a,b)=>b.length-a.length);
  let result=source;
  for(const candidate of candidates){
    const cn=normalizeForCompare(candidate);
    if(!cn)continue;
    const current=normalizeForCompare(result);
    if(current===cn)return "";

    const leading=new RegExp("^\\s*"+escapeRegex(candidate)+"(?:\\s*\\n?|\\s+)","i");
    const trailing=new RegExp("(?:\\s*\\n?|\\s+)"+escapeRegex(candidate)+"\\s*$","i");
    if(leading.test(result)){
      result=result.replace(leading,"").trim();
      continue;
    }
    if(trailing.test(result)){
      result=result.replace(trailing,"").trim();
      continue;
    }
  }
  return result;
}

function formatEnergy(value){
  const n=Number(value);
  return Number.isFinite(n) ? String(n) : "0";
}

function formatBP(value){
  if(value===null || value===undefined || value==="")return "—";
  const n=Number(value);
  return Number.isFinite(n) ? `${n}+` : String(value);
}


function syncMobileDetail(){
  const src=$('detail'), dst=$('mobileDetailContent');
  if(!src||!dst)return;
  dst.innerHTML=src.innerHTML;
}
function openMobileDetail(){
  if(selected===null || !deck)return;
  syncMobileDetail();
  const modal=$('mobileDetailModal');
  if(!modal)return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  document.body.classList.add('mobile-detail-open');
}
function closeMobileDetail(){
  const modal=$('mobileDetailModal');
  if(!modal)return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden','true');
  document.body.classList.remove('mobile-detail-open');
}


function cardDisplayParts(d){
  const raw=String(d?.name||"").trim();
  let name=raw;
  let feature="";

  const m=raw.match(/^([\s\S]*?)\s+特徵\s*[:：]\s*([\s\S]*)$/);
  if(m){
    name=m[1].trim();
    feature=m[2].trim();

    // The parser can leave the combat explanation that Rugia puts after
    // the feature text inside the card name. It belongs to the effect context,
    // not the displayed feature line.
    feature=feature.replace(
      /\s*[（(]\s*(?:進行攻擊|此角色的攻擊|對手玩家受到|直接傷害)[\s\S]*?[）)]\s*$/u,
      ""
    ).trim();

    // The image token in this particular field is the combat keyword image,
    // not part of the card's trait/name.
    feature=feature.replace(/\s*Image\s*/gi," ");
    feature=feature.replace(/\[\[UAIMG:[^\]]+\]\]/gi,"");
    feature=feature.replace(/\s{2,}/g," ").trim();
  }

  return {name:name||raw,feature};
}

function displayFeature(text){
  return esc(String(text||""))
    .replace(/\n/g,"<br>");
}


function stripKnownRaidFromRichHtml(html){
  let s=String(html||'');
  // The parser normally removes this before saving effectHtml. This second guard
  // keeps older/stale cards.json entries from displaying the Raid trigger twice.
  const raid='將此卡加入手牌，或在滿足能源需求的情況下進行突襲。';
  const escaped=escapeRegex(raid);
  s=s.replace(new RegExp('(?:<br>\s*)?(?:突襲\s*)?'+escaped+'\s*$','u'),'');
  return s.trim();
}

function renderStoredEffect(d,triggerText=''){
  const rich=stripKnownRaidFromRichHtml(String(d?.effectHtml||''));
  if(rich){
    return rich;
  }
  const cleaned=stripTriggerFromEffect(String(d?.effect||''),triggerText||d?.trigger||'');
  return highlightEffect(cleaned,d?.traits||[]);
}

function detail(){
 if(selected===null){$('detail').innerHTML='<div class="empty">點擊左側卡片查看資料。</div>';return}
 const c=deck.cards[selected],id=cardId(c),d=DB[id]||DB[cardIdNoDeck(c)];
 if(!d){$('detail').innerHTML=`${imageTag(id,id,'detailimg')}<div class="id">${esc(id)}</div><h2>尚未收錄本地資料</h2><p class="muted">這張卡可以正常加入牌組，但目前你的本地資料庫尚未同步到它。</p><div class="missing\"><b>你可以直接查看：</b><a class="link" href="${esc(rugia(c))}" target="_blank">Rugia 中文卡頁 ↗</a><a class="link" href="${esc(officialSearch(c))}" target="_blank">UNION ARENA 官方卡表 ↗</a></div><p class="muted smallnote">完成 GitHub Actions 的資料同步後，所有已公開的 IP 卡片會逐步加入 cards.json。</p>`;return}

 const parts=cardDisplayParts(d);
 const triggerText=translateTrigger(d.trigger||'');
 const effect=renderStoredEffect(d,triggerText||d.trigger||'');
 const trigger=triggerText?`<div class="trigger"><b>觸發器</b><div>${highlightTrigger(triggerText)}</div></div>`:'';
 const feature=parts.feature?`<div class="card-features"><b>特徵：</b>${displayFeature(parts.feature)}</div>`:'';
 const raid=isRaidCard(d)?raidBadge():'';
 const source=d.source||'Rugia / 本地資料庫';

 // Compact flow requested:
 // 1. card code
 // 2. feature
 // 3. RAID + card name + effect as one flowing paragraph
 // 4. trigger description unchanged
 $('detail').innerHTML=`${imageTag(d.id||id,d.name||id,'detailimg')}<div class="id">${esc(d.id||id)} (${esc(d.rarity||'—')})</div>${feature}<div class="card-effect-flow">${raid}<strong class="inline-card-name">${esc(parts.name)}</strong>${effect?` <span class="inline-effect">${effect}</span>`:''}</div>${trigger}<div class="source">資料來源：${esc(source)}</div><a class="link" href="${esc(d.url||rugia(c))}" target="_blank">開啟 Rugia 卡片頁 ↗</a>`;
 syncMobileDetail();
}
function showAuth(){$('modal').classList.remove('hidden')}function hideAuth(){$('modal').classList.add('hidden');$('authMsg').textContent=''}
function authError(e){return({'auth/invalid-email':'Email 格式不正確。','auth/email-already-in-use':'這個 Email 已經註冊。','auth/weak-password':'密碼太短。','auth/invalid-credential':'Email 或密碼不正確。'}[e.code]||e.message)}
$('loginBtn').onclick=showAuth;$('closeModal').onclick=hideAuth;
$('signup').onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);hideAuth()}catch(e){$('authMsg').textContent=authError(e)}};
$('signin').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);hideAuth()}catch(e){$('authMsg').textContent=authError(e)}};
$('logoutBtn').onclick=()=>signOut(auth);
function closeMyDecks(){
  const account=$('account'),backdrop=$('myDecksBackdrop'),toggle=$('myDecksToggle');
  if(!account)return;
  account.classList.remove('my-decks-open');
  if(backdrop)backdrop.classList.add('hidden');
  if(toggle)toggle.setAttribute('aria-expanded','false');
}
function openMyDecks(){
  const account=$('account'),backdrop=$('myDecksBackdrop'),toggle=$('myDecksToggle');
  if(!account)return;
  account.classList.add('my-decks-open');
  if(backdrop)backdrop.classList.remove('hidden');
  if(toggle)toggle.setAttribute('aria-expanded','true');
}
function toggleMyDecks(){
  const account=$('account');
  if(account?.classList.contains('my-decks-open')) closeMyDecks(); else openMyDecks();
}
$('myDecksToggle')?.addEventListener('click',toggleMyDecks);
$('myDecksBackdrop')?.addEventListener('click',closeMyDecks);

async function loadSaved(){
  if(!currentUser)return;
  const q=query(collection(db,'users',currentUser.uid,'decks'),orderBy('createdAt','desc'));
  const snap=await getDocs(q),box=$('savedDecks');
  box.innerHTML='';
  const docs=[];snap.forEach(item=>docs.push({id:item.id,...item.data()}));
  const SLOT_COUNT=10;
  for(let i=0;i<SLOT_COUNT;i++){
    const d=docs[i],slot=document.createElement('div');
    slot.className='deck-slot'+(d?.id===deck?.firestoreId?' on':'');
    if(!d){slot.classList.add('empty');slot.innerHTML=`<div class="slot-number">${i+1}</div><div class="slot-name">空白</div>`;box.appendChild(slot);continue}
    const thumbId=deckThumbnailId(d), thumbName=(DB[thumbId]?.name)||d.name||"牌組縮圖";
    slot.innerHTML=`<div class="slot-number">${i+1}</div><div class="slot-thumb">${thumbId?imageTag(thumbId,thumbName):""}</div><div class="slot-name"><span class="deck-color-dot ${deckColorClass(d.color)}" title="${deckColorName(d.color)}"></span><span>${esc(d.name||'未命名牌組')}</span></div>`;
    slot.onclick=()=>{deck={name:d.name,version:d.version,color:deckColorClass(d.color),cards:d.cards,source:d.source,thumbnailId:deckThumbnailId(d),firestoreId:d.id};selected=null;render();detail();closeMyDecks();loadSaved()};
    box.appendChild(slot);
  }
}
$('saveDeck').innerHTML=iconSvg('save');
$('reorderToggle')?.addEventListener('click',()=>{reorderMode=!reorderMode;renderReorderState()});
$('shareDeck').innerHTML=iconSvg('share');
$('clear').innerHTML=iconSvg('trash');

$('saveDeck').onclick=async()=>{
  if(!currentUser){showAuth();return}
  if(!deck)return;
  try{
    const color=deckColorClass(deck.color||$('deckColor')?.value);
    deck.color=color;
    // Always derive the thumbnail from the first card in the current order.
    deck.thumbnailId=deckThumbnailId(deck);
    const payload={name:deck.name||'新牌組',version:deck.version||'',color,cards:deck.cards,thumbnailId:deck.thumbnailId||'',source:deck.source||'',createdAt:serverTimestamp()};
    if(deck.firestoreId){
      await updateDoc(doc(db,'users',currentUser.uid,'decks',deck.firestoreId),{name:payload.name,version:payload.version,color:payload.color,cards:payload.cards,thumbnailId:payload.thumbnailId,source:payload.source});
      $('msg').textContent='牌組已更新。';
    }else{
      const ref=await addDoc(collection(db,'users',currentUser.uid,'decks'),payload);
      deck.firestoreId=ref.id;
      $('msg').textContent='牌組已儲存到你的帳號。';
    }
    $('msg').style.color='#25805b';await loadSaved();render();detail();
  }catch(e){$('msg').textContent='儲存失敗：'+e.message;$('msg').style.color='#b34b35'}
};

function closeEditDeckModal(){
  $('editDeckModal').classList.add('hidden');
}
function updateEditColorPreview(){
  const c=deckColorClass($('editDeckColor').value);
  $('editDeckColorPreview').className=`color-dot ${c}`;
}
$('editDeckColor').addEventListener('change',updateEditColorPreview);
$('closeEditDeck').onclick=closeEditDeckModal;
$('cancelEditDeck').onclick=closeEditDeckModal;
$('editDeckModal').addEventListener('click',e=>{
  if(e.target===e.currentTarget)closeEditDeckModal();
});
$('confirmEditDeck').onclick=async()=>{
  const name=$('editDeckName').value.trim();
  const color=deckColorClass($('editDeckColor').value);
  if(!name){
    $('editDeckEditMsg').textContent='牌組名稱不能為空白。';
    return;
  }
  try{
    $('confirmEditDeck').disabled=true;
    await updateDoc(doc(db,'users',currentUser.uid,'decks',deck.firestoreId),{name,color});
    deck.name=name;
    deck.color=color;
    closeEditDeckModal();
    render();
    await loadSaved();
    $('msg').textContent='牌組名稱與顏色已更新。';
    $('msg').style.color='#25805b';
  }catch(e){
    $('editDeckEditMsg').textContent='編輯失敗：'+e.message;
  }finally{
    $('confirmEditDeck').disabled=false;
  }
};function showShareToast(message='分享連結已複製！'){
  let toast=$('shareToast');
  if(!toast){
    toast=document.createElement('div');
    toast.id='shareToast';
    toast.className='share-toast';
    toast.setAttribute('role','status');
    toast.setAttribute('aria-live','polite');
    document.body.appendChild(toast);
  }
  toast.textContent=message;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(window.__shareToastTimer);
  window.__shareToastTimer=setTimeout(()=>toast.classList.remove('show'),2200);
}

async function copyShareLink(text){
  if(navigator.clipboard && window.isSecureContext){
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta=document.createElement('textarea');
  ta.value=text;
  ta.setAttribute('readonly','');
  ta.style.position='fixed';
  ta.style.opacity='0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0,ta.value.length);
  let ok=false;
  try{ok=document.execCommand('copy')}catch{}
  ta.remove();
  return ok;
}

$('shareDeck').onclick=async()=>{
  if(!deck)return;
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify({name:deck.name,version:deck.version,color:deckColorClass(deck.color),cards:deck.cards,thumbnailId:deck.thumbnailId||''}))));
  const url=location.origin+location.pathname+'?deck='+encodeURIComponent(encoded);
  try{
    const copied=await copyShareLink(url);
    if(copied){
      showShareToast('分享連結已複製！');
      $('msg').textContent='分享連結已複製。';
      $('msg').style.color='#25805b';
    }else{
      showShareToast('無法自動複製，請手動複製連結。');
      $('msg').textContent=url;
      $('msg').style.color='#68707d';
    }
  }catch{
    showShareToast('無法自動複製，請手動複製連結。');
    $('msg').textContent=url;
    $('msg').style.color='#68707d';
  }
};
function setImportPanel(open){
  const panel=$('importPanel'),btn=$('toggleImport');
  if(!panel||!btn)return;
  panel.classList.toggle('hidden',!open);
  panel.setAttribute('aria-hidden',String(!open));
  btn.setAttribute('aria-expanded',String(open));
}
$('toggleImport').onclick=()=>setImportPanel(true);
$('collapseImport').onclick=()=>setImportPanel(false);

$('go').onclick=()=>{try{deck=parse($('url').value);deck.name=$('name').value.trim()||deck.name;deck.thumbnailId=deck.cards[0]?cardId(deck.cards[0]):'';selected=null;render();detail();const missing=deck.cards.filter(c=>!DB[cardId(c)]&&!DB[cardIdNoDeck(c)]).length;$('msg').textContent=missing?`牌組匯入完成：${deck.cards.length} 種卡片。${missing} 種等待資料庫同步。`:`牌組匯入完成：${deck.cards.length} 種卡片。`;$('msg').style.color='#25805b'}catch(e){$('msg').textContent=e.message;$('msg').style.color='#b34b35'}};
$('clear').onclick=async()=>{
  if(!deck)return;
  if(!deck.firestoreId){
    $('deck').classList.add('hidden');
    deck=null;selected=null;
    return;
  }
  if(!window.confirm(`確定要刪除「${deck.name||'未命名牌組'}」嗎？\n\n刪除後將會從你的帳號牌組中永久移除。`))return;
  try{
    await deleteDoc(doc(db,'users',currentUser.uid,'decks',deck.firestoreId));
    deck=null;selected=null;
    $('deck').classList.add('hidden');
    $('detail').innerHTML='<div class="empty">點擊左側卡片查看資料。</div>';
    $('msg').textContent='牌組已刪除。';$('msg').style.color='#25805b';
    await loadSaved();
  }catch(err){
    $('msg').textContent='刪除失敗：'+err.message;$('msg').style.color='#b34b35';
  }
};
onAuthStateChanged(auth,async user=>{currentUser=user;if(user){$('userLabel').textContent=user.email;$('loginBtn').classList.add('hidden');$('logoutBtn').classList.remove('hidden');$('account').classList.remove('hidden');await loadSaved();if(window.matchMedia('(max-width: 700px)').matches)openMyDecks()}else{$('userLabel').textContent='未登入';$('loginBtn').classList.remove('hidden');$('logoutBtn').classList.add('hidden');$('account').classList.add('hidden');closeMyDecks()}});
function loadShared(){const e=new URLSearchParams(location.search).get('deck');if(!e)return;try{deck={...JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(e))))) };render();detail()}catch{}}
try{const n=await initCards();$('dbStatus').textContent=`本地卡片資料：${n} 張；支援任意 Rugia IP 牌組匯入。先執行 GitHub Actions 同步即可載入完整卡表。`;$('dbStatus').classList.remove('error');loadShared()}catch(e){$('msg').textContent=e.message;$('msg').style.color='#b34b35'}

document.addEventListener('click',e=>{
  if(e.target.closest('#mobileDetailBtn')) openMobileDetail();
  if(e.target.closest('[data-close-mobile-detail]')) closeMobileDetail();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') closeMobileDetail();
});

const deckColorInput=$('deckColor'),deckColorPreview=$('deckColorPreview');
if(deckColorInput){
  const updateDeckColor=()=>{
    const c=deckColorClass(deckColorInput.value);
    if(deckColorPreview)deckColorPreview.className=`color-dot ${c}`;
    if(deck)deck.color=c;
  };
  deckColorInput.addEventListener('change',updateDeckColor);
  updateDeckColor();
}
