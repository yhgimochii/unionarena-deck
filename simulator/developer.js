import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let savedDecks=[];
let game=null;
let currentUser=null;

function cardId(card,version=""){
  const num=String(card.num||"");
  const match=num.match(/^(\d)(\d{3})$/);
  const code=match?match[1]+"-"+match[2]:num;
  return String(card.set||"")+"/"+(version?version+"-":"")+code;
}
function imageCandidates(id){
  const [set,...rest]=String(id).split("/");
  const code=rest.join("/");
  const variants=[set+"_"+code,String(id).replaceAll("/","_"),set+"-"+code,String(id)];
  const urls=[];
  for(const locale of ["tc","en","jp"])for(const file of variants)urls.push("https://www.unionarena-tcg.com/"+locale+"/images/cardlist/card/"+encodeURIComponent(file)+".png");
  return [...new Set(urls)];
}
function shuffle(list){
  const a=[...list];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a;
}
function expandDeck(deck){
  const cards=[];
  (Array.isArray(deck.cards)?deck.cards:[]).forEach((entry,index)=>{
    const qty=Math.max(0,Math.min(100,Number.parseInt(entry.qty,10)||0));
    for(let copy=0;copy<qty;copy++){
      const id=cardId(entry,deck.version||"");
      cards.push({uid:deck.id+"-"+index+"-"+copy+"-"+Math.random().toString(36).slice(2,7),id,name:id,zone:"deck"});
    }
  });
  return shuffle(cards);
}
function makePlayer(deck,number){
  const cards=expandDeck(deck);
  return {number,deckId:deck.id,deckName:deck.name||"未命名牌組",version:deck.version||"",cards,hand:[],front:[],energy:[],actionPoint:[],life:[],discard:[],removed:[]};
}
function draw(player,count=1){
  const amount=Math.max(0,Math.min(20,Number(count)||1));
  for(let i=0;i<amount&&player.cards.length;i++){const card=player.cards.shift();card.zone="hand";player.hand.push(card)}
}
function startGame(){
  const first=savedDecks.find(d=>d.id===$("deckOne").value);
  const second=savedDecks.find(d=>d.id===$("deckTwo").value);
  if(!first||!second){$("setupMessage").textContent="請先為雙方選擇牌組。";return}
  game={players:{1:makePlayer(first,1),2:makePlayer(second,2)}};
  draw(game.players[1],7);draw(game.players[2],7);
  $("setupMessage").textContent="";
  $("deckSetup").classList.add("hidden");
  $("gamePanel").classList.remove("hidden");
  renderGame();
}
function cardMarkup(card,playerNo){
  const urls=imageCandidates(card.id);
  return '<div class="play-card" draggable="true" data-card="'+esc(card.uid)+'" data-player="'+playerNo+'" title="'+esc(card.id)+'"><img src="'+esc(urls[0])+'" data-fallbacks="'+esc(JSON.stringify(urls.slice(1)))+'" alt="'+esc(card.id)+'"><small>'+esc(card.id)+'</small><button class="card-action" type="button" data-action="discard" data-card="'+esc(card.uid)+'" data-player="'+playerNo+'">棄牌</button></div>';
}
function zoneMarkup(player,key,label,capacity=0){
  const isHand=key==="hand";
  const isDeck=key==="deck";
  const cards=isDeck?player.cards:(player[key]||[]);
  const controls=isHand?'<div class="zone-tools"><button type="button" data-action="draw" data-player="'+player.number+'">抽 1 張</button><button type="button" data-action="mulligan" data-player="'+player.number+'">重抽 7 張</button><button type="button" data-action="return-hand" data-player="'+player.number+'">手牌洗回牌組</button></div>':"";
  const cardNodes=cards.map(c=>cardMarkup(c,player.number)).join("");
  const emptySlots=capacity?Array.from({length:Math.max(0,capacity-cards.length)},()=>'<div class="empty-slot" aria-hidden="true"></div>').join(""):"";
  const contents=isDeck
    ? '<div class="deck-stack" aria-hidden="true"><span></span><span></span><span></span></div><strong class="deck-count">'+player.cards.length+'</strong>'
    : (cardNodes||"")+(emptySlots||(!cards.length?'<div class="empty-zone">拖曳卡片到這裡</div>':""));
  return '<section class="zone '+(isHand?"hand-zone ":"")+(isDeck?"deck-zone ":"")+'" data-zone="'+key+'" data-player="'+player.number+'" '+(capacity?'data-capacity="'+capacity+'"':"")+'><div class="zone-head"><strong>'+label+'</strong><span>'+cards.length+' 張</span></div>'+controls+'<div class="zone-cards">'+contents+'</div></section>';
}
function boardMarkup(player){
  const n=player.number;
  return '<div class="board-head"><div class="board-title"><span class="player-marker"></span><div><h3>PLAYER '+(n===1?"A":"B")+'</h3><div class="board-deck-name">'+esc(player.deckName)+'</div></div></div><div class="board-tools"><button type="button" data-action="shuffle" data-player="'+n+'">洗牌</button><button type="button" data-action="draw" data-player="'+n+'">抽 1 張</button><button type="button" data-action="reset-player" data-player="'+n+'">重設此玩家</button></div></div><div class="board-stats"><span class="stat-pill">牌組 <strong>'+player.cards.length+'</strong></span><span class="stat-pill">手牌 <strong>'+player.hand.length+'</strong></span><span class="stat-pill">場上 <strong>'+(player.front.length+player.energy.length+player.actionPoint.length)+'</strong></span><span class="stat-pill">棄牌 <strong>'+player.discard.length+'</strong></span></div><div class="playmat '+(n===1?"mat-player-a":"mat-player-b")+'"><div class="mat-zone life-position">'+zoneMarkup(player,"life","生命 LIFE",7)+'</div><div class="mat-zone front-position">'+zoneMarkup(player,"front","前線 FRONT LINE",3)+'</div><div class="mat-zone deck-position">'+zoneMarkup(player,"deck","牌組 DECK")+'<button class="mat-draw-button" type="button" data-action="draw" data-player="'+n+'">抽牌</button></div><div class="mat-zone energy-position">'+zoneMarkup(player,"energy","能源線 ENERGY LINE",4)+'</div><div class="mat-zone ap-position">'+zoneMarkup(player,"actionPoint","行動點 ACTION POINT",3)+'</div><div class="mat-zone banish-position">'+zoneMarkup(player,"removed","移除區 BANISH")+'</div><div class="mat-zone sideline-position">'+zoneMarkup(player,"discard","場外區 SIDELINE")+'</div></div>';
}
function renderGame(){
  // Keep existing card DOM nodes keyed by UID so their already-loaded images
  // survive board updates, card moves, draws and shuffles.
  const existingCards=new Map(
    [...document.querySelectorAll(".play-card")].map(el=>[el.dataset.card,el])
  );

  $("playerOneBoard").innerHTML=boardMarkup(game.players[1]);
  $("playerTwoBoard").innerHTML=boardMarkup(game.players[2]);
  $("playerOneHand").innerHTML=zoneMarkup(game.players[1],"hand","手牌 HAND");
  $("playerTwoHand").innerHTML=zoneMarkup(game.players[2],"hand","手牌 HAND");

  document.querySelectorAll(".play-card").forEach(fresh=>{
    const previous=existingCards.get(fresh.dataset.card);
    let cardEl=fresh;
    if(previous){
      previous.dataset.player=fresh.dataset.player;
      previous.dataset.card=fresh.dataset.card;
      previous.title=fresh.title;
      fresh.replaceWith(previous);
      cardEl=previous;
    }
    cardEl.ondragstart=e=>{
      e.dataTransfer.setData("text/plain",JSON.stringify({
        uid:cardEl.dataset.card,
        player:Number(cardEl.dataset.player)
      }));
      e.dataTransfer.effectAllowed="move";
    };
  });

  document.querySelectorAll(".play-card img").forEach(img=>{
    img.onerror=()=>{
      let list=[];
      try{list=JSON.parse(img.dataset.fallbacks||"[]")}catch{}
      const next=list.shift();
      img.dataset.fallbacks=JSON.stringify(list);
      if(next)img.src=next;
      else{
        const box=document.createElement("div");
        box.className="card-placeholder";
        box.textContent=img.alt;
        img.replaceWith(box);
      }
    };
    img.draggable=false;
  });

  document.querySelectorAll("[data-zone]").forEach(zone=>{
    zone.addEventListener("dragover",e=>{
      e.preventDefault();
      zone.classList.add("drop-target");
    });
    zone.addEventListener("dragleave",()=>zone.classList.remove("drop-target"));
    zone.addEventListener("drop",e=>{
      e.preventDefault();
      zone.classList.remove("drop-target");
      try{
        const payload=JSON.parse(e.dataTransfer.getData("text/plain"));
        moveCard(payload.uid,payload.player,Number(zone.dataset.player),zone.dataset.zone);
      }catch(err){console.warn("Card drop failed",err)}
    });
  });
}
function findCard(player,uid){
  for(const zone of ["hand","front","energy","actionPoint","life","discard","removed"]){
    const index=player[zone].findIndex(c=>c.uid===uid);
    if(index>=0)return {zone,index,card:player[zone][index]};
  }
  const index=player.cards.findIndex(c=>c.uid===uid);
  if(index>=0)return {zone:"deck",index,card:player.cards[index]};
  return null;
}
function moveCard(uid,fromNo,toNo,toZone){
  if(!game||!game.players[fromNo]||!game.players[toNo])return;
  const source=findCard(game.players[fromNo],uid);
  if(!source||!["hand","front","energy","actionPoint","life","discard","removed","deck"].includes(toZone))return;
  const card=source.card;
  if(source.zone==="deck")game.players[fromNo].cards.splice(source.index,1);
  else game.players[fromNo][source.zone].splice(source.index,1);
  card.zone=toZone;
  if(toZone==="deck")game.players[toNo].cards.push(card);
  else game.players[toNo][toZone].push(card);
  renderGame();
}
function resetPlayer(number){
  const old=game.players[number];
  const deck=savedDecks.find(d=>d.id===old.deckId);
  if(deck){game.players[number]=makePlayer(deck,number);draw(game.players[number],7)}
}
function handleAction(action,number,uid){
  const player=game?.players[number];if(!player)return;
  if(action==="draw"){draw(player,1)}
  if(action==="shuffle"){player.cards=shuffle(player.cards)}
  if(action==="return-hand"){player.cards=shuffle([...player.cards,...player.hand.map(c=>({...c,zone:"deck"}))]);player.hand=[]}
  if(action==="mulligan"){player.cards=shuffle([...player.cards,...player.hand.map(c=>({...c,zone:"deck"}))]);player.hand=[];draw(player,7)}
  if(action==="reset-player")resetPlayer(number);
  if(action==="discard"){
    const found=findCard(player,uid);
    if(found){if(found.zone==="deck")player.cards.splice(found.index,1);else player[found.zone].splice(found.index,1);found.card.zone="discard";player.discard.push(found.card)}
  }
  renderGame();
}
document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-action]");if(!btn)return;
  handleAction(btn.dataset.action,Number(btn.dataset.player),btn.dataset.card);
});
$("startGame").addEventListener("click",startGame);
$("backToSetup").addEventListener("click",()=>{$("gamePanel").classList.add("hidden");$("deckSetup").classList.remove("hidden")});
$("resetBoth").addEventListener("click",()=>{if(!game)return;resetPlayer(1);resetPlayer(2);renderGame()});
function renderDeckOptions(){
  const options=savedDecks.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name||"未命名牌組")+'</option>').join("");
  $("deckOne").innerHTML=options;$("deckTwo").innerHTML=options;
  if(savedDecks.length){$("deckTwo").selectedIndex=Math.min(1,savedDecks.length-1)}
  updateDeckMeta();
  $("startGame").disabled=!savedDecks.length;
}
function updateDeckMeta(){
  for(const [selectId,metaId] of [["deckOne","deckOneMeta"],["deckTwo","deckTwoMeta"]]){
    const d=savedDecks.find(x=>x.id===$(selectId).value);
    $(metaId).textContent=d?((d.version||"作品未標示")+" · "+d.cards.reduce((n,c)=>n+(Number(c.qty)||0),0)+" 張"):"";
  }
}
$("deckOne").addEventListener("change",updateDeckMeta);
$("deckTwo").addEventListener("change",updateDeckMeta);
async function loadDeckLibrary(user){
  $("authMessage").textContent="正在讀取你的牌組庫…";
  try{
    const snap=await getDocs(query(collection(db,"users",user.uid,"decks"),orderBy("createdAt","desc")));
    savedDecks=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
      const ai=Number.isFinite(Number(a.orderIndex))?Number(a.orderIndex):0;
      const bi=Number.isFinite(Number(b.orderIndex))?Number(b.orderIndex):0;
      return ai-bi;
    }).filter(d=>Array.isArray(d.cards)&&d.cards.length);
    $("accountLabel").textContent=user.email||"已登入";
    $("authPanel").classList.add("hidden");
    $("deckSetup").classList.remove("hidden");
    $("authMessage").textContent="";
    if(!savedDecks.length){$("setupMessage").textContent="你的牌組庫目前沒有可用牌組。請先返回主網站建立或匯入牌組。"}
    else{$("setupMessage").textContent="已載入 "+savedDecks.length+" 副牌組。"}
    renderDeckOptions();
  }catch(error){
    console.error(error);$("authMessage").textContent="讀取牌組庫失敗："+error.message;
    $("authPanel").classList.remove("hidden");
  }
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();$("loginButton").disabled=true;$("authMessage").textContent="登入中…";
  try{await signInWithEmailAndPassword(auth,$("email").value.trim(),$("password").value)}
  catch(error){$("authMessage").textContent="登入失敗："+error.message}
  finally{$("loginButton").disabled=false}
});
$("signOut").addEventListener("click",async()=>{await signOut(auth);savedDecks=[];$("deckSetup").classList.add("hidden");$("authPanel").classList.remove("hidden")});
onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(user){await loadDeckLibrary(user)}
  else{$("authPanel").classList.remove("hidden");$("deckSetup").classList.add("hidden")}
});
document.addEventListener("click",e=>{
  const cardEl=e.target.closest(".play-card");
  if(!cardEl)return;
  const playerNo=Number(cardEl.dataset.player);
  const player=game?.players[playerNo];
  const found=player&&findCard(player,cardEl.dataset.card);
  if(!found)return;
  const target=$(playerNo===1?"playerOneDescription":"playerTwoDescription");
  target.innerHTML='<h3>Card description</h3><p class="selected-card-code">'+esc(found.card.id)+'</p><p>'+esc(found.card.name||found.card.id)+'</p><small>Player '+(playerNo===1?"A":"B")+'</small>';
});
