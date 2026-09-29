import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, serverTimestamp, query, orderBy, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
let DB={},deck=null,selected=null,currentUser=null;
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function initCards(){const r=await fetch("cards.json");if(!r.ok)throw Error("cards.json 載入失敗");const data=await r.json();data.forEach(c=>DB[c.id]=c);return data.length}
function parse(raw){raw=raw.trim();if(!raw)throw Error("請先貼上 Rugia deckEdit 連結。");let u;try{u=new URL(raw)}catch{throw Error("這不是有效的網址。")}const version=u.searchParams.get("Version")||"",source=u.searchParams.get("Deck")||"";if(!source)throw Error("找不到 Deck 參數。");const cards=source.split("|").filter(Boolean).map(item=>{const m=item.match(/^(\d+)([A-Za-z0-9]+)_(\d+)(?:_(\d+))?$/);if(!m)throw Error("無法辨識："+item);return{qty:+m[1],set:m[2],num:m[3],alt:m[4]||""}});return{name:u.searchParams.get("Name")||"",version,cards,source:raw}}
function cardId(c){const m=c.num.match(/^(\d)(\d{3})$/);return `${c.set}/${deck?.version||""}${deck?.version?"-":""}${m?m[1]+"-"+m[2]:c.num}`}
function cardIdNoDeck(c){const m=c.num.match(/^(\d)(\d{3})$/);return `${c.set}/${m?m[1]+"-"+m[2]:c.num}`}
function rugia(c){const code=cardId(c).replace("/","_");return `https://rugiacreation.com/ua/search?Name=HK&Card=${encodeURIComponent(code)}#${encodeURIComponent(code)}`}
function officialSearch(c){const id=cardId(c);return `https://www.unionarena-tcg.com/en/cardlist/?search=true&keyword=${encodeURIComponent(id)}`}
function cardImage(id){const file=String(id||"").replace("/","_");return `https://www.unionarena-tcg.com/tc/images/cardlist/card/${encodeURIComponent(file)}.png?v5=`}
function imageTag(id,name,cls="thumb"){return `<img class="${cls}" src="${esc(cardImage(id))}" alt="${esc(name||id)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`}
const COMBAT_KEYWORDS=["衝擊無效","無效化衝擊","雙重攻擊","雙重阻擋","突襲","衝擊","狙擊","Step","Damage","Raid","Impact","Double Attack","Double Block","Snipe","Nullify Impact"];
const EFFECT_KEYWORDS=["攻擊結束時","主階段結束時","起動・主要","登場時","退場時","攻擊時","阻擋時","被攻擊時","主起動","自己回合中","對手回合中","激活時","休息時","When Played","When Sidelined","When Attacking","When Blocking","When Attacked","On Your Turn","On Opponent's Turn","On Opponent’s Turn","Activate: Main","Once Per Turn","每回合1次","回合1次"];
function escapeRegex(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function keywordClass(k){
  const value=String(k||"").toLowerCase();
  return COMBAT_KEYWORDS.some(x=>x.toLowerCase()===value)||/^(?:impact|damage|衝擊|傷害)/i.test(value)?"combat":"effect";
}
function highlightEffect(text, traitKeywords=[]){
  let out=esc(text||"");
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

  return out.replace(/\n/g,"<br>");
}

function render(){
  if(!deck)return;
  $('deck').classList.remove('hidden');
  $('title').textContent=deck.name||"新牌組";
  $('meta').textContent=`${deck.version||"未知作品"} · ${deck.cards.reduce((n,c)=>n+c.qty,0)} 張 · ${deck.cards.length} 種`;

  $('cards').innerHTML=deck.cards.map((c,i)=>{
    const d=DB[cardId(c)]||DB[cardIdNoDeck(c)];
    const id=cardId(c),name=d?.name||`未收錄：${id}`;
    return `<div class="card ${selected===i?"on":""}" data-i="${i}" role="button" tabindex="0" aria-label="查看 ${esc(name)}">
      ${imageTag(id,name)}
      <div class="cardbody"><div class="nm">${esc(name)}</div><div class="id">${esc(id)}</div></div>
      ${d?.rarity?`<span class="rar">${esc(d.rarity)}</span>`:""}
      <div class="qty">×${c.qty}</div>
    </div>`;
  }).join('');

  // Bind directly to each card. Selection does NOT re-render the card grid.
  $('cards').querySelectorAll('.card').forEach(card=>{
    const selectCard=()=>{
      selected=Number(card.dataset.i);
      $('cards').querySelectorAll('.card').forEach(x=>x.classList.toggle('on',x===card));
      detail();
    };
    card.onclick=selectCard;
    card.onkeydown=e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        selectCard();
      }
    };
  });
}

window.selectCardFromUI=(index)=>{
  if(!deck || !Number.isInteger(Number(index)))return;
  selected=Number(index);
  $('cards').querySelectorAll('.card').forEach((x,i)=>x.classList.toggle('on',i===selected));
  detail();
};

function detail(){
 if(selected===null){$('detail').innerHTML='<div class="empty">點擊左側卡片查看資料。</div>';return}
 const c=deck.cards[selected],id=cardId(c),d=DB[id]||DB[cardIdNoDeck(c)];
 if(!d){$('detail').innerHTML=`${imageTag(id,id,'detailimg')}<div class="id">${esc(id)}</div><h2>尚未收錄本地資料</h2><p class="muted">這張卡可以正常加入牌組，但目前你的本地資料庫尚未同步到它。</p><div class="missing"><b>你可以直接查看：</b><a class="link" href="${esc(rugia(c))}" target="_blank">Rugia 中文卡頁 ↗</a><a class="link" href="${esc(officialSearch(c))}" target="_blank">UNION ARENA 官方卡表 ↗</a></div><p class="muted smallnote">完成 GitHub Actions 的資料同步後，所有已公開的 IP 卡片會逐步加入 cards.json。</p>`;return}
 const bp=d.bp==null?'—':d.bp, energy=d.energy==null?'—':`${d.energyColor||''}${d.energy}`.trim(),ap=d.ap==null?'—':d.ap;
 const keywords=(d.keywords||[]).filter(Boolean).map(x=>`<span class="tag ${keywordClass(x)}">${esc(x)}</span>`).join('');
 const traits=(d.traits||[]).filter(Boolean).map(x=>`<span class="tag trait">${esc(x)}</span>`).join('');
 const effect=highlightEffect(d.effect||'',d.traits||[]);
 const trigger=d.trigger?`<div class="trigger"><b>觸發器</b><div>${highlightEffect(d.trigger,d.traits||[])}</div></div>`:'';
 const source=d.source||'Rugia / 本地資料庫';
 $('detail').innerHTML=`${imageTag(d.id||id,d.name||id,'detailimg')}<div class="id">${esc(d.id||id)} (${esc(d.rarity||'—')})</div><h2>${esc(d.name||'')}</h2><div class="qtybig">×${c.qty}</div><div class="stats"><div><small>能源需求</small><strong>${esc(energy)}</strong></div><div><small>AP消耗</small><strong>${esc(ap)}</strong></div><div><small>BP</small><strong>${esc(bp)}</strong></div><div><small>卡類</small><strong>${esc(d.type||'—')}</strong></div></div>${traits?`<div class="tags">${traits}</div>`:''}${keywords?`<div class="tags">${keywords}</div>`:''}<div class="effect"><b>效果</b><div>${effect||'—'}</div></div>${trigger}<div class="source">資料來源：${esc(source)}</div><a class="link" href="${esc(d.url||rugia(c))}" target="_blank">開啟 Rugia 卡片頁 ↗</a>`
}
function showAuth(){$('modal').classList.remove('hidden')}function hideAuth(){$('modal').classList.add('hidden');$('authMsg').textContent=''}
function authError(e){return({'auth/invalid-email':'Email 格式不正確。','auth/email-already-in-use':'這個 Email 已經註冊。','auth/weak-password':'密碼太短。','auth/invalid-credential':'Email 或密碼不正確。'}[e.code]||e.message)}
$('loginBtn').onclick=showAuth;$('closeModal').onclick=hideAuth;
$('signup').onclick=async()=>{try{await createUserWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);hideAuth()}catch(e){$('authMsg').textContent=authError(e)}};
$('signin').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);hideAuth()}catch(e){$('authMsg').textContent=authError(e)}};
$('logoutBtn').onclick=()=>signOut(auth);
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
    if(!d){slot.classList.add('empty');slot.innerHTML=`<div class="slot-number">牌組 ${i+1}</div><div class="slot-name">空白</div>`;box.appendChild(slot);continue}
    slot.innerHTML=`<div class="slot-number">牌組 ${i+1}</div><div class="slot-name">${esc(d.name||'未命名牌組')}</div><div class="slot-count">${(d.cards||[]).reduce((n,c)=>n+c.qty,0)} 張</div><button class="slot-delete" type="button" title="刪除牌組" aria-label="刪除牌組">×</button>`;
    slot.onclick=()=>{deck={name:d.name,version:d.version,cards:d.cards,source:d.source,firestoreId:d.id};selected=null;render();detail();loadSaved()};
    slot.querySelector('.slot-delete').onclick=async e=>{
      e.preventDefault();e.stopPropagation();
      if(!window.confirm(`確定要刪除「${d.name||'未命名牌組'}」嗎？\n\n刪除後將會從你的帳號牌組中永久移除。`))return;
      try{
        await deleteDoc(doc(db,'users',currentUser.uid,'decks',d.id));
        if(deck?.firestoreId===d.id){deck=null;selected=null;$('deck').classList.add('hidden');$('detail').innerHTML='<div class="empty">點擊左側卡片查看資料。</div>'}
        $('msg').textContent='牌組已刪除。';$('msg').style.color='#25805b';await loadSaved();
      }catch(err){$('msg').textContent='刪除失敗：'+err.message;$('msg').style.color='#b34b35'}
    };
    box.appendChild(slot);
  }
}
$('saveDeck').onclick=async()=>{if(!currentUser){showAuth();return}if(!deck)return;try{const ref=await addDoc(collection(db,'users',currentUser.uid,'decks'),{name:deck.name||'新牌組',version:deck.version||'',cards:deck.cards,source:deck.source||'',createdAt:serverTimestamp()});deck.firestoreId=ref.id;$('msg').textContent='牌組已儲存到你的帳號。';$('msg').style.color='#25805b';await loadSaved()}catch(e){$('msg').textContent='儲存失敗：'+e.message}};
$('shareDeck').onclick=async()=>{if(!deck)return;const encoded=btoa(unescape(encodeURIComponent(JSON.stringify({name:deck.name,version:deck.version,cards:deck.cards}))));const url=location.origin+location.pathname+'?deck='+encodeURIComponent(encoded);try{await navigator.clipboard.writeText(url);$('msg').textContent='分享連結已複製。';$('msg').style.color='#25805b'}catch{$('msg').textContent=url}};
$('go').onclick=()=>{try{deck=parse($('url').value);deck.name=$('name').value.trim()||deck.name;selected=null;render();detail();const missing=deck.cards.filter(c=>!DB[cardId(c)]&&!DB[cardIdNoDeck(c)]).length;$('msg').textContent=missing?`牌組匯入完成：${deck.cards.length} 種卡片。${missing} 種等待資料庫同步。`:`牌組匯入完成：${deck.cards.length} 種卡片。`;$('msg').style.color='#25805b'}catch(e){$('msg').textContent=e.message;$('msg').style.color='#b34b35'}};
$('clear').onclick=()=>{$('deck').classList.add('hidden');deck=null;selected=null};
onAuthStateChanged(auth,async user=>{currentUser=user;if(user){$('userLabel').textContent=user.email;$('loginBtn').classList.add('hidden');$('logoutBtn').classList.remove('hidden');$('account').classList.remove('hidden');await loadSaved()}else{$('userLabel').textContent='未登入';$('loginBtn').classList.remove('hidden');$('logoutBtn').classList.add('hidden');$('account').classList.add('hidden')}});
function loadShared(){const e=new URLSearchParams(location.search).get('deck');if(!e)return;try{deck={...JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(e))))) };render();detail()}catch{}}
try{const n=await initCards();$('dbStatus').textContent=`本地卡片資料：${n} 張；支援任意 Rugia IP 牌組匯入。先執行 GitHub Actions 同步即可載入完整卡表。`;$('dbStatus').classList.remove('error');loadShared()}catch(e){$('msg').textContent=e.message;$('msg').style.color='#b34b35'}
