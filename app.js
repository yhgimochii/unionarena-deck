import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, getDoc, serverTimestamp, query, orderBy, deleteDoc, doc, updateDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
let DB={},deck=null,selected=null,currentUser=null;
let sharedDeck=null,authReady=false,cardsReady=false;
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
 // Try the site's regional paths first, then English and Japanese.
 // Keep the remaining candidates as onerror fallbacks.
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
 // Do not suppress the HTTP Referer: the official card-image host may use
 // it for hotlink checks. Let the browser send its normal cross-origin
 // referrer (origin only) and keep the existing locale/path fallbacks.
 return `<img class="${cls}" src="${esc(first)}" alt="${esc(name||id)}" loading="lazy" data-fallbacks='${esc(JSON.stringify(urls))}' onerror="window.uaImageFallback(this)">`;
}
