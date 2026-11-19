{
/* ============================================================ constantes (moteur partagé) */
const {BOOKS,LEAGUES,PRESETS,PKEYS,DEFAULTS,prod,norm}=Engine;
const MARKETS=[["1N2","1N2"],["plus_moins_2_5","+/- 2,5 buts"],["les_deux_marquent","Les deux marquent"],["extras","Double chance, +1,5, équipe marque, sans nul"]];
const EXTRA_MARKETS="double_chance,alternate_totals,team_totals,draw_no_bet";
const API="https://api.the-odds-api.com/v4";

/* ============================================================ stockage */
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let cfg={...DEFAULTS,...store.get("cfg",{})};cfg.marches={...DEFAULTS.marches,...(cfg.marches||{})};delete cfg.mode;
let cache=store.get("cache",null);if(cache&&!cache.extras)cache.extras={};
let bets=store.get("bets",[]);
let checked=store.get("checked",{});
let standings=null,modelData=null,resultsData=null,paperData=null;
let demoCache=null,last=null,timer=null,busy=false,tab="tickets";
const saveCfg=()=>store.set("cfg",cfg),saveCache=()=>store.set("cache",cache),saveBets=()=>store.set("bets",bets);

/* ============================================================ outils */
const $=id=>document.getElementById(id);
const pct=x=>(x*100).toFixed(x<0.1?1:0)+' %';
const spct=(x,d=1)=>(x>=0?'+':'')+(x*100).toFixed(d)+' %';
const eur=x=>x.toFixed(2).replace('.',',')+' €';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const bookName=k=>(BOOKS.find(b=>b[0]===k)||[k,k.replace('_fr','')])[1];
const leagueName=k=>(LEAGUES.find(l=>l[0]===k)||[k,k])[1];
const when=iso=>{try{return new Date(iso).toLocaleString('fr-FR',{weekday:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const dateFr=iso=>{try{return new Date(iso).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}catch(e){return ''}};
const ago=iso=>{const m=Math.round((Date.now()-new Date(iso))/60000);if(m<1)return "à l’instant";if(m<60)return `il y a ${m} min`;const h=Math.round(m/60);return h<48?`il y a ${h} h`:`le ${when(iso)}`;};
const setQuota=n=>{if(n!=null&&n!=='')$('quota').innerHTML=`Crédits restants : <b>${n}</b>`;};
const modelWeight=()=>cfg.poids_modele!=null?cfg.poids_modele:(modelData&&modelData.weight)||0;

/* ============================================================ contexte */
function fatigue(ev,events){
  const t0=Date.parse(ev.commence_time),out=[];
  for(const team of [ev.home_team,ev.away_team]){
    for(const e of events){if(e.id===ev.id||(e.home_team!==team&&e.away_team!==team))continue;const d=(Date.parse(e.commence_time)-t0)/864e5;
      if(d<0&&d>=-3.2)out.push(`${team} a joué ${Math.abs(d)<1.5?'avant-hier/hier':'il y a '+Math.round(-d)+' j'} (${e.sport_title})`);
      else if(d>0&&d<=3.2)out.push(`${team} rejoue dans ${Math.round(d)} j (${e.sport_title}) : rotation possible`);}
  }
  return out;
}
const STOP=new Set(["fc","cf","sc","ac","as","ss","ssc","rc","rcd","afc","us","ud","sd","cd","sv","vfl","vfb","tsg","fsv","bsc","bv","1","club","de","of","the","calcio","sport","sporting","athletic","olympique","stade","real","deportivo","union","town","city","united","hotspur"]);
const toks=s=>norm(s).split(' ').filter(t=>t&&!STOP.has(t));
function findRow(table,team){
  const tt=toks(team);let best=null,bs=0;
  for(const r of table){const rt=toks(r.team);const s=tt.filter(t=>rt.includes(t)).length;if(s>bs){bs=s;best=r;}}
  return bs?best:null;
}
function stakes(ev){
  if(!standings)return null;
  const code=(LEAGUES.find(l=>l[0]===ev.sport_key)||[])[2];const c=code&&standings.competitions&&standings.competitions[code];if(!c||!c.table)return null;
  const out=[];const N=c.table.length,total=c.totalMatchdays||(N-1)*2;
  for(const team of [ev.home_team,ev.away_team]){
    const r=findRow(c.table,team);if(!r)continue;
    const rem=Math.max(0,total-r.played);if(rem>total*0.45){out.push(`${team} : ${r.position}e`);continue;}
    const pts=p=>(c.table.find(x=>x.position===p)||{}).points;
    const gap=(p)=>pts(p)!=null?Math.abs(r.points-pts(p)):null;
    const eur=code==="CL"?24:Math.min(6,N-1),rel=code==="CL"?null:N-2;
    const canTop=gap(1)!=null&&(r.position===1||gap(1)<=3*rem),canEur=r.position<=eur||(gap(eur)!=null&&gap(eur)<=3*rem),canRel=rel&&(r.position>=rel||(gap(rel)!=null&&gap(rel)<=3*rem));
    let lab;if(code==="CL")lab=canEur?(r.position<=8?"course au top 8":"qualif. en jeu"):"éliminé ou déjà fixé : rien à jouer";
    else if(canTop&&r.position<=3)lab="course au titre";else if(canRel&&r.position>=rel-2)lab="lutte pour le maintien";else if(canEur&&r.position<=eur+2)lab="course à l’Europe";else if(!canEur&&!canRel)lab="rien à jouer";else lab="milieu de tableau";
    out.push(`${team} : ${r.position}e, ${lab}${rem<=8?` (${rem} matchs restants)`:''}`);
  }
  return out;
}
function context(ev,events,fit){
  const f=fatigue(ev,events),s=stakes(ev)||[];
  const m=[];
  if(fit&&fit.model){const d=fit.disagree;m.push(`Modèle maison : ${ev.home_team} ${pct(fit.model.pH)} · nul ${pct(fit.model.pD)} · ${ev.away_team} ${pct(fit.model.pA)} (marché : ${pct(fit.market.pH)} · ${pct(fit.market.pD)} · ${pct(fit.market.pA)})${d>0.08?' — DÉSACCORD':''}`);}
  const warn=f.length>0||s.some(x=>/rien à jouer|éliminé/.test(x))||(fit&&fit.disagree>0.08);
  return {lines:[...s,...f,...m],warn,disagree:fit?fit.disagree:0,link:`https://www.google.com/search?q=${encodeURIComponent('compo '+ev.home_team+' '+ev.away_team)}`};
}

/* ============================================================ tickets */
function compute(c){
  const now=Date.now(),limit=now+cfg.jours_a_venir*864e5,leagues=new Set(cfg.championnats);
  const events=c.events.filter(e=>(c.demo||leagues.has(e.sport_key))&&Date.parse(e.commence_time)>now&&Date.parse(e.commence_time)<=limit);
  const w=c.demo?0:modelWeight();
  const an=Engine.analyse(events,cfg,{extras:c.extras,model:w?modelData:null,weight:w});
  const ctx={};for(const e of events)ctx[e.id]=context(e,c.events,an.fitById[e.id]);
  const p=c.params||{};
  const missing=c.demo?[]:[...leagues].filter(l=>!(p.championnats||[]).includes(l));
  const staleM=!c.demo&&["1N2","plus_moins_2_5","les_deux_marquent"].some(m=>cfg.marches[m]&&!(p.marches||{})[m]);
  const staleB=!c.demo&&cfg.mes_bookmakers.some(b=>!(p.mes_bookmakers||[]).includes(b));
  const nExtra=events.filter(e=>c.extras&&c.extras[e.id]).length;
  return {tickets:an.tickets,fitById:an.fitById,events,ctx,matches:events.length,demo:!!c.demo,fetched_at:c.fetched_at,remaining:c.remaining,logs:c.logs||[],missing,needs_refresh:!!(missing.length||staleM||staleB),nExtra,
    noExtra:cfg.marches.extras&&!c.demo&&nExtra===0,weight:w};
}

/* ============================================================ API */
const booksParam=()=>["pinnacle",...cfg.mes_bookmakers.filter(b=>b!=="pinnacle")].slice(0,10).join(",");
async function apiGet(url){
  const r=await fetch(url);const rem=r.headers.get("x-requests-remaining");
  if(r.status===401)throw new Error("Clé API refusée : vérifie-la (ou quota épuisé).");
  if(!r.ok)throw new Error(`Erreur ${r.status} du site des cotes.`);
  return [await r.json(),rem!=null?Math.round(+rem):null];
}
const K=()=>encodeURIComponent(cfg.cle_api);
async function fetchStage1(logs){
  const markets=[cfg.marches["1N2"]&&"h2h",cfg.marches.plus_moins_2_5&&"totals"].filter(Boolean).join(",")||"h2h";
  const events=[];let rem=null;
  for(const sp of cfg.championnats){
    try{const [data,r]=await apiGet(`${API}/sports/${sp}/odds/?apiKey=${K()}&bookmakers=${booksParam()}&markets=${markets}&oddsFormat=decimal`);if(r!=null)rem=r;
      if(cfg.marches.les_deux_marquent)for(const e of data){try{const [x,r2]=await apiGet(`${API}/sports/${sp}/events/${e.id}/odds?apiKey=${K()}&bookmakers=${booksParam()}&markets=btts&oddsFormat=decimal`);if(r2!=null)rem=r2;
          const byk=Object.fromEntries(e.bookmakers.map(b=>[b.key,b]));for(const b of x.bookmakers||[]){if(byk[b.key])byk[b.key].markets.push(...b.markets);else e.bookmakers.push(b);}}catch(err){logs.push(`[!] BTTS ${e.home_team} : ${err.message}`);}}
      events.push(...data);logs.push(`[ok] ${leagueName(sp)} : ${data.length} matchs`);
    }catch(err){logs.push(`[!] ${leagueName(sp)} : ${err.message}`);if(/Clé API/.test(err.message))throw err;}
  }
  return {events,rem};
}
async function fetchStage2(c,logs){
  const now=Date.now(),limit=now+cfg.jours_a_venir*864e5;
  const events=c.events.filter(e=>Date.parse(e.commence_time)>now&&Date.parse(e.commence_time)<=limit);
  const rank=events.map(e=>{const f=Engine.fairFromSharp(e);if(!f)return null;const m=Math.max(f.pH,f.pA,f.pO||0);return {e,m};}).filter(Boolean).sort((a,b)=>b.m-a.m).slice(0,cfg.preselection);
  let rem=c.remaining,n=0;
  for(const {e} of rank){
    try{const [x,r]=await apiGet(`${API}/sports/${e.sport_key}/events/${e.id}/odds?apiKey=${K()}&bookmakers=${cfg.mes_bookmakers.join(",")}&markets=${EXTRA_MARKETS}&oddsFormat=decimal`);if(r!=null)rem=r;
      c.extras[e.id]=x;n+=(x.bookmakers||[]).length?1:0;}
    catch(err){logs.push(`[!] marchés ${e.home_team} : ${err.message}`);}
  }
  logs.push(`[ok] marchés supplémentaires : ${n}/${rank.length} matchs avec cotes`);
  return rem;
}
async function fetchAll(){
  const logs=[];
  const {events,rem}=await fetchStage1(logs);
  const c={fetched_at:new Date().toISOString(),demo:false,events,logs,remaining:rem,extras:{},params:{championnats:cfg.championnats,marches:cfg.marches,mes_bookmakers:cfg.mes_bookmakers}};
  if(cfg.marches.extras){$('status').textContent='Marchés supplémentaires…';c.remaining=await fetchStage2(c,logs)??rem;}
  return c;
}
async function quota(){if(!cfg.cle_api)return null;const [,rem]=await apiGet(`${API}/sports/?apiKey=${K()}`);return rem;}
async function loadFile(name){
  try{const r=await fetch(`./data/${name}.json?t=${Math.floor(Date.now()/36e5)}`);if(r.ok){const d=await r.json();store.set("f_"+name,d);return d;}}catch(e){}
  return store.get("f_"+name,null);
}
async function loadData(){
  let latest;
  [standings,modelData,resultsData,paperData,latest]=await Promise.all(["standings","model","results","paper","latest"].map(loadFile));
  const lev=latest?(latest.events||Object.values(latest.by_league||{}).flatMap(b=>b.events||[])):[];
  if(latest&&latest.fetched_at&&lev.length&&(!cache||cache.robot||Date.parse(latest.fetched_at)>Date.parse(cache.fetched_at||0))){
    cache={fetched_at:latest.fetched_at,demo:false,events:lev,extras:{},logs:[`[robot] relevé automatique : ${lev.length} matchs à venir`,...Object.entries(latest.by_league||{}).map(([k,b])=>`  ${leagueName(k)} : ${(b.events||[]).length} matchs, relevé ${ago(b.fetched_at)}`)],remaining:latest.remaining,robot:true,
      params:{championnats:latest.leagues,marches:{"1N2":true,plus_moins_2_5:true,les_deux_marquent:false,extras:false},mes_bookmakers:latest.books}};
    saveCache();
  }
  if(standings&&!standings.updated)standings=null;
  if(resultsData&&!resultsData.updated)resultsData=null;
  if(paperData&&!paperData.updated)paperData=null;
  if(modelData&&!modelData.updated)modelData=null;
}

/* ============================================================ carnet */
function placeBet(t){
  const legs=t.legs.map(l=>({...l}));
  bets.unshift({id:Date.now().toString(36),placed_at:new Date().toISOString(),legs,odds:t.odds,prob:t.prob,stake:t.stake,status:"pending",demo:!!(last&&last.demo)});
  saveBets();renderBets();
}
function manualBet(){
  const label=$('mLabel').value.trim(),odds=parseFloat(String($('mOdds').value).replace(',','.')),stake=parseFloat(String($('mStake').value).replace(',','.'));
  if(!label||!(odds>1)||!(stake>0)){$('mErr').textContent="Remplis le libellé, la cote (> 1) et la mise.";return;}
  bets.unshift({id:Date.now().toString(36),placed_at:new Date().toISOString(),legs:[],label,odds,prob:null,stake,status:$('mStatus').value,manual:true});
  settleOne(bets[0]);saveBets();renderBets();$('mLabel').value=$('mOdds').value=$('mStake').value='';$('mErr').textContent='';
}
function settleOne(b){
  if(b.manual){b.profit=b.status==="won"?b.stake*(b.odds-1):b.status==="lost"?-b.stake:0;return;}
  if(b.legs.every(l=>l.result)){
    if(b.legs.some(l=>l.result==="lose")){b.status="lost";b.profit=-b.stake;}
    else{const odds=prod(b.legs.map(l=>l.result==="push"?1:l.price));b.status=odds>1?"won":"void";b.profit=b.stake*(odds-1);b.odds_final=odds;}
  }
}
function settleFromResults(){
  if(!resultsData)return 0;let n=0;
  for(const b of bets){if(b.manual||b.status!=="pending"||b.demo)continue;
    for(const l of b.legs){if(l.result)continue;
      const d=l.kickoff.slice(0,10);
      const cands=resultsData.matches.filter(m=>m.sport_key===l.sport_key&&Math.abs(Date.parse(m.date)-Date.parse(d))<=1.01*864e5);
      let best=null,bs=0;for(const m of cands){const sc=Engine.sim(l.home,m.home)+Engine.sim(l.away,m.away);if(sc>bs){bs=sc;best=m;}}
      if(!best||bs<1.2)continue;
      l.score=`${best.hg}-${best.ag}`;l.result=Model.settle(l,best.hg,best.ag);n++;
      if(best.closing){const cf=Model.fit(best.closing.pH,best.closing.pD,best.closing.pA,best.closing.pO);l.prob_close=Model.prob(cf,l);l.clv=l.price*l.prob_close-1;}
    }
    settleOne(b);}
  if(n)saveBets();return n;
}
async function settleBets(useApi){
  const pend=bets.filter(b=>!b.manual&&b.status==="pending"&&!b.demo);
  if(!pend.length){$('bStatus').textContent="Aucun ticket en attente.";return;}
  const n0=settleFromResults();
  const still=pend.filter(b=>b.status==="pending"&&b.legs.some(l=>!l.result&&Date.parse(l.kickoff)<Date.now()-115*60e3));
  if(!useApi||!still.length){$('bStatus').textContent=n0?`${n0} paris réglés (résultats du robot).`:still.length?"Résultats pas encore publiés par le robot (chaque nuit). Tu peux forcer via l’API ci-dessous.":"Les matchs ne sont pas encore terminés.";renderBets();return;}
  if(!cfg.cle_api){$('bStatus').textContent="Colle ta clé API dans les réglages.";return;}
  const sports=[...new Set(still.flatMap(b=>b.legs.filter(l=>!l.result).map(l=>l.sport_key)))];
  $('bStatus').textContent=`Récupération des scores via l’API (${sports.length*2} crédits)…`;
  const scores={};let rem=null;
  for(const sp of sports){try{const [data,r]=await apiGet(`${API}/sports/${sp}/scores/?apiKey=${K()}&daysFrom=3`);if(r!=null)rem=r;for(const g of data)if(g.completed&&g.scores)scores[g.id]=g;}catch(err){$('bStatus').textContent=err.message;return;}}
  let n=0;
  for(const b of still){for(const l of b.legs){if(l.result)continue;const g=scores[l.match_id];if(!g)continue;
      const sc=Object.fromEntries(g.scores.map(s=>[s.name,+s.score]));const h=sc[l.home],a=sc[l.away];if(h==null||a==null)continue;
      l.score=`${h}-${a}`;l.result=Model.settle(l,h,a);n++;}
    settleOne(b);}
  saveBets();if(rem!=null){setQuota(rem);if(cache){cache.remaining=rem;saveCache();}}
  $('bStatus').textContent=n?`${n+n0} paris réglés.`:"Pas encore de score disponible.";
  renderBets();
}
function betStats(){
  const done=bets.filter(b=>b.status!=="pending");const staked=done.reduce((a,b)=>a+b.stake,0),profit=done.reduce((a,b)=>a+(b.profit||0),0);
  const legs=bets.flatMap(b=>b.legs.filter(l=>l.result&&l.result!=="push"));
  const buckets=[[0,.35],[.35,.5],[.5,.65],[.65,.8],[.8,1.01]].map(([lo,hi])=>{const ls=legs.filter(l=>l.prob>=lo&&l.prob<hi);return {lo,hi,n:ls.length,hit:ls.length?ls.filter(l=>l.result==="win").length/ls.length:null,pred:ls.length?ls.reduce((a,l)=>a+l.prob,0)/ls.length:null};});
  const clvs=bets.flatMap(b=>b.legs.filter(l=>l.clv!=null).map(l=>l.clv));
  return {n:bets.length,done:done.length,won:done.filter(b=>b.status==="won").length,staked,profit,roi:staked?profit/staked:null,pending:bets.filter(b=>b.status==="pending").length,buckets,legs:legs.length,clv:clvs.length?clvs.reduce((a,b)=>a+b,0)/clvs.length:null,clvN:clvs.length};
}
function renderBets(){
  const s=betStats();
  $('stats').innerHTML=`
   <div class="kpi"><b class="num ${s.profit>0?'up':s.profit<0?'down':''}">${s.profit>=0?'+':''}${eur(s.profit)}</b><span>bilan net</span></div>
   <div class="kpi"><b class="num">${s.roi==null?'—':(s.roi*100).toFixed(1)+' %'}</b><span>ROI</span></div>
   <div class="kpi"><b class="num">${s.won}/${s.done}</b><span>tickets gagnés</span></div>
   <div class="kpi"><b class="num">${s.pending}</b><span>en attente</span></div>
   <div class="kpi"><b class="num ${s.clv>0?'up':s.clv<0?'down':''}">${s.clv==null?'—':spct(s.clv)}</b><span>valeur à la clôture (${s.clvN} paris)</span></div>`;
  $('clvHelp').textContent=s.clvN?"Valeur à la clôture = ta cote ÷ la cote juste de Pinnacle au coup d’envoi. Positif = tu bats le marché, même si le ticket perd. C’est l’indicateur le plus fiable sur la durée.":"";
  $('calib').innerHTML=s.legs<10?`<p class="hint">La calibration (les « 70 % » passent-ils 7 fois sur 10 ?) s’affiche à partir de 10 paris réglés. Pour l’instant : ${s.legs}.</p>`
   :`<p class="lab">Calibration des probabilités (${s.legs} paris réglés)</p>`+s.buckets.filter(b=>b.n).map(b=>`<div class="cal"><span>${Math.round(b.lo*100)}–${Math.round(Math.min(b.hi,1)*100)} %</span><div class="bar"><i style="width:${b.hit*100}%"></i><em style="left:${b.pred*100}%"></em></div><span>${Math.round(b.hit*100)} % réel · ${b.n}</span></div>`).join('')+`<p class="hint">Barre = taux réel, trait = taux prédit. Barre plus courte que le trait = l’appli est trop optimiste.</p>`;
  const box=$('bets');
  if(!bets.length){box.innerHTML=`<div class="empty">Aucun ticket joué. Sur un ticket, appuie sur <b>Je joue</b> pour l’enregistrer ici.</div>`;return;}
  const st={pending:"en attente",won:"gagné",lost:"perdu",void:"remboursé"};
  box.innerHTML=bets.map(b=>`<article class="t b-${b.status}">
    <div class="t-top"><div><div class="t-rank">${when(b.placed_at)}${b.demo?' · démo':''}${b.manual?' · saisi à la main':''}</div><div class="t-odds num"><small>cote</small>${(b.odds_final||b.odds).toFixed(2)}</div></div>
     <div class="t-prob"><div class="num">${b.status==="pending"?(b.prob!=null?pct(b.prob):'—'):(b.profit>=0?'+':'')+eur(b.profit||0)}</div><div>${b.status==="pending"?'de chances':st[b.status]}</div></div></div>
    ${b.manual?`<ul class="legs"><li><span class="lp">${esc(b.label)}</span></li></ul>`:`<ul class="legs">${b.legs.map(l=>`<li class="r-${l.result||'none'}"><span class="lm">${esc(l.match)} · ${when(l.kickoff)}${l.score?' · <b>'+l.score+'</b>':''}</span><span class="lp">${esc(l.pick)}</span><span class="lo"><span class="num">${l.price.toFixed(2)}</span><span>${l.result?({win:'✓ gagné',lose:'✗ perdu',push:'remboursé'})[l.result]+(l.clv!=null?' · CLV '+spct(l.clv):''):bookName(l.book)}</span></span></li>`).join('')}</ul>`}
    <div class="t-foot"><span>Mise ${eur(b.stake)}${b.status==="pending"?` → <b>${eur(b.stake*b.odds)}</b>`:''}</span>
     <span class="acts">${b.status==="pending"&&b.manual?`<button class="copy" data-res="won" data-id="${b.id}">Gagné</button><button class="copy" data-res="lost" data-id="${b.id}">Perdu</button>`:''}<button class="copy" data-del="${b.id}">Suppr.</button></span></div></article>`).join('');
  box.onclick=e=>{const d=e.target.closest('[data-del]'),r=e.target.closest('[data-res]');
    if(d){bets=bets.filter(b=>b.id!==d.dataset.del);saveBets();renderBets();}
    if(r){const b=bets.find(x=>x.id===r.dataset.id);if(b){b.status=r.dataset.res;settleOne(b);saveBets();renderBets();}}};
}
function exportBets(){const blob=new Blob([JSON.stringify({bets,cfg:{...cfg,cle_api:undefined}},null,1)],{type:"application/json"});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`combi-carnet-${new Date().toISOString().slice(0,10)}.json`;a.click();}
function importBets(file){const rd=new FileReader();rd.onload=()=>{try{const d=JSON.parse(rd.result);const inc=Array.isArray(d)?d:d.bets||[];const ids=new Set(bets.map(b=>b.id));bets=[...inc.filter(b=>!ids.has(b.id)),...bets];saveBets();renderBets();$('bStatus').textContent=`${inc.length} tickets importés.`;}catch(e){$('bStatus').textContent="Fichier illisible.";}};rd.readAsText(file);}

/* ============================================================ interface */
const chips=(el,list,isOn,toggle)=>{el.innerHTML=list.map(([k,l])=>`<button class="chip" data-k="${k}" aria-pressed="${isOn(k)}">${l}</button>`).join('');el.onclick=e=>{const b=e.target.closest('.chip');if(!b)return;toggle(b.dataset.k);b.setAttribute('aria-pressed',isOn(b.dataset.k));changed();};};
const seg=(el,get,set)=>{const paint=()=>el.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v)===String(get())));el.onclick=e=>{const b=e.target.closest('button');if(!b)return;set(b.dataset.v);paint();changed();};paint();return paint;};
const toggleIn=(arr,k)=>arr.includes(k)?arr.filter(x=>x!==k):[...arr,k];
const currentPreset=()=>Object.keys(PRESETS).find(p=>Engine.samePreset(cfg,PRESETS[p]))||'';
function cost(){const nm=(cfg.marches["1N2"]?1:0)+(cfg.marches.plus_moins_2_5?1:0)||1;return cfg.championnats.length*nm+(cfg.marches.extras?cfg.preselection*4:0);}
function labels(){
  const n=cost();$('runCost').textContent=`(≈ ${n} crédits${cfg.marches.les_deux_marquent?' + 1/match':''})`;
  $('cost').textContent="Changer les filtres est gratuit : seul « Actualiser les cotes » consomme des crédits.";
  $('bttsWarn').hidden=!cfg.marches.les_deux_marquent;$('extraWarn').hidden=!cfg.marches.extras;$('preselBox').hidden=!cfg.marches.extras;
  $('pMinV').textContent=Math.round(cfg.proba_min_par_selection*100)+' %';$('daysV').textContent=cfg.jours_a_venir+' jour'+(cfg.jours_a_venir>1?'s':'');
  $('preselV').textContent=cfg.preselection+' matchs';
  const p=currentPreset();$('presetHint').textContent=p?PRESETS[p].label:"Réglages perso";$('preset').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===p));
  const w=modelWeight();$('wModV').textContent=Math.round(w*100)+' %'+(cfg.poids_modele==null?' (auto)':'');
  $('modInfo').textContent=modelData?`${modelData.verdict} Poids auto : ${Math.round((modelData.weight||0)*100)} %.`:"Modèle maison pas encore calculé (robot GitHub hebdomadaire).";
}
function changed(){labels();saveCfg();clearTimeout(timer);timer=setTimeout(()=>show(last&&last.demo?demoCache:cache),250);}
function bind(){
  $('key').value=cfg.cle_api;$('key').oninput=e=>{cfg.cle_api=e.target.value.trim();saveCfg();};$('key').onchange=loadQuota;
  seg($('classement'),()=>cfg.classement,v=>cfg.classement=v);
  seg($('lies'),()=>cfg.paris_lies?'1':'0',v=>cfg.paris_lies=v==='1');
  seg($('valmin'),()=>cfg.valeur_mini?'1':'0',v=>cfg.valeur_mini=v==='1');
  $('preset').onclick=e=>{const b=e.target.closest('button');if(!b)return;const p=PRESETS[b.dataset.v];PKEYS.forEach(k=>cfg[k]=p[k]);bind();changed();};
  chips($('books'),BOOKS,k=>cfg.mes_bookmakers.includes(k),k=>cfg.mes_bookmakers=toggleIn(cfg.mes_bookmakers,k));
  chips($('leagues'),LEAGUES,k=>cfg.championnats.includes(k),k=>cfg.championnats=toggleIn(cfg.championnats,k));
  chips($('markets'),MARKETS,k=>!!cfg.marches[k],k=>cfg.marches[k]=!cfg.marches[k]);
  let pMax,pMin;
  pMin=seg($('legsMin'),()=>cfg.matchs_min_par_combi,v=>{cfg.matchs_min_par_combi=+v;if(cfg.matchs_max_par_combi<+v){cfg.matchs_max_par_combi=+v;pMax&&pMax();}});
  pMax=seg($('legsMax'),()=>cfg.matchs_max_par_combi,v=>{cfg.matchs_max_par_combi=+v;if(cfg.matchs_min_par_combi>+v){cfg.matchs_min_par_combi=+v;pMin();}});
  const num=(id,key,toUi=x=>x,fromUi=x=>x)=>{$(id).value=toUi(cfg[key]);$(id).oninput=e=>{const v=parseFloat(String(e.target.value).replace(',','.'));if(!isNaN(v)){cfg[key]=fromUi(v);changed();}};};
  num('oMin','cote_totale_min');num('oMax','cote_totale_max');num('bank','bankroll');num('stake','mise_fixe_pct',x=>+(x*100).toFixed(1),x=>x/100);num('top','nombre_de_combis_affiches',x=>x,x=>Math.max(1,Math.min(50,Math.round(x))));
  $('pMin').value=Math.round(cfg.proba_min_par_selection*100);$('pMin').oninput=e=>{cfg.proba_min_par_selection=e.target.value/100;changed();};
  $('days').value=cfg.jours_a_venir;$('days').oninput=e=>{cfg.jours_a_venir=+e.target.value;changed();};
  $('presel').value=cfg.preselection;$('presel').oninput=e=>{cfg.preselection=+e.target.value;changed();};
  $('wMod').value=Math.round(modelWeight()*100);$('wMod').oninput=e=>{cfg.poids_modele=e.target.value/100;changed();};
  $('wModAuto').onclick=()=>{cfg.poids_modele=null;$('wMod').value=Math.round(modelWeight()*100);changed();};
  labels();
}
const ticketText=(t,i)=>`Combiné #${i+1} — cote ${t.odds.toFixed(2)} (${pct(t.prob)} de chances)\n`+t.legs.map(l=>`• ${l.match} : ${l.pick} @${l.price.toFixed(2)} (${bookName(l.book)})`).join('\n')+`\nMise ${eur(t.stake)} → ${eur(t.gain)}`;

function show(c){
  const box=$('tickets'),note=$('note');
  if(!c){last=null;box.innerHTML=`<div class="empty">Aucune cote enregistrée pour l’instant.<br>Colle ta clé API dans les réglages puis appuie sur <b>Actualiser les cotes</b>, ou essaie la <b>Démo</b>.</div>`;$('status').textContent='';note.innerHTML='';$('logsBox').hidden=true;return;}
  const res=compute(c);last=res;
  $('status').innerHTML=res.demo?'Démo : matchs inventés, ne les joue pas.':`<span class="fresh">Cotes ${c.robot?'du robot, relevées':'récupérées'} ${ago(res.fetched_at)}</span> · ${res.matches} matchs · ${res.tickets.length} tickets${res.weight?` · modèle ${Math.round(res.weight*100)} %`:''}`;
  setQuota(res.remaining);
  const warn=[];
  if(res.missing.length)warn.push(`Pas encore de cotes pour : ${res.missing.map(leagueName).join(', ')}.`);else if(res.needs_refresh)warn.push("Tu as ajouté un bookmaker ou un type de pari.");
  if(!res.demo&&res.fetched_at&&(Date.now()-new Date(res.fetched_at))>6*3600e3)warn.push("Les cotes ont plus de 6 h, elles ont pu bouger.");
  if(res.noExtra&&c.params&&!c.robot)warn.push("Aucune cote trouvée pour les marchés supplémentaires chez tes bookmakers : l’API ne les couvre peut-être pas encore pour eux.");
  if(c.robot&&cfg.marches.extras)warn.push("Cotes relevées par le robot (sans marchés supplémentaires). Actualise à la main seulement si tu veux double chance, +1,5, etc.");
  note.innerHTML=warn.length?`<div class="note">${warn.join(' ')}${warn.some(w=>/Actualiser|ajouté|Pas encore|plus de 6/.test(w))?' Appuie sur <b>Actualiser les cotes</b> pour mettre à jour.':''}</div>`:'';
  $('logs').textContent=res.logs.join('\n');$('logsBox').hidden=!res.logs.length;
  if(!res.tickets.length){box.innerHTML=`<div class="empty">${res.matches?`Aucun ticket ne passe tes filtres sur ${res.matches} matchs.<br>Essaie un autre profil de risque ou baisse la chance mini par pari.`:`Aucun match à venir sur la période.<br>Augmente le nombre de jours (trêve internationale ?) ou actualise les cotes.`}</div>`;return;}
  box.innerHTML=res.tickets.map((t,i)=>{
    const mids=[...new Set(t.legs.map(l=>l.match_id))];
    const ctxHtml=mids.map(mid=>{const cx=res.ctx[mid],ev=res.events.find(e=>e.id===mid);const ok=!!checked[mid];
      return `<div class="cx ${cx.warn?'cx-warn':''}">${cx.lines.length?cx.lines.map(l=>`<div>${esc(l)}</div>`).join(''):`<div>${esc(ev.home_team)} - ${esc(ev.away_team)} : pas de signal particulier</div>`}
        <div class="cx-acts"><a href="${cx.link}" target="_blank" rel="noopener">Vérifier les compos ↗</a><label><input type="checkbox" data-chk="${mid}" ${ok?'checked':''}> compos vérifiées</label></div></div>`;}).join('');
    return `<article class="t" style="animation-delay:${Math.min(i,8)*40}ms">
    <div class="t-top"><div><div class="t-rank">Ticket #${i+1} · ${t.legs.length} paris${t.linked?` · <span class="tag">paris liés ${t.boost>0?'+':''}${Math.round(t.boost*100)} %</span>`:''}${t.ev>0?` · <span class="tag tag-val">valeur +${(t.ev*100).toFixed(0)} %</span>`:''}</div><div class="t-odds num"><small>cote</small>${t.odds.toFixed(2)}</div></div>
     <div class="t-prob"><div class="num">${pct(t.prob)}</div><div>de chances</div></div></div>
    <div class="meter"><i style="width:${Math.min(100,t.prob*100)}%"></i></div>
    <ul class="legs">${t.legs.map(l=>`<li><span class="lm">${esc(l.match)} · ${when(l.kickoff)}</span><span class="lp">${esc(l.pick)}</span><span class="lo"><span class="num">${l.price.toFixed(2)}</span><span>${bookName(l.book)} · ${pct(l.prob)}${l.edge>0.02?' · <b>+'+Math.round(l.edge*100)+' %</b>':''}</span></span></li>`).join('')}</ul>
    <details class="ctx"><summary>Contexte des matchs${mids.some(m=>res.ctx[m].disagree>0.08)?' · <span class="tag tag-warn">désaccord modèle</span>':''}${mids.some(m=>res.ctx[m].warn)?' · <b>⚠ à lire</b>':''}</summary>${ctxHtml}</details>
    <div class="t-foot"><span>Mise ${eur(t.stake)} → <b>${eur(t.gain)}</b></span><span class="acts"><button class="copy" data-i="${i}">Copier</button><button class="copy play" data-play="${i}">Je joue</button></span></div></article>`;}).join('');
  box.onclick=async e=>{const b=e.target.closest('.copy[data-i]'),p=e.target.closest('[data-play]');
    if(b){try{await navigator.clipboard.writeText(ticketText(last.tickets[+b.dataset.i],+b.dataset.i));b.textContent='Copié ✓';}catch(err){b.textContent='Copie impossible';}setTimeout(()=>b.textContent='Copier',1800);}
    if(p){placeBet(last.tickets[+p.dataset.play]);p.textContent='Enregistré ✓';p.disabled=true;}};
  box.onchange=e=>{const c=e.target.closest('[data-chk]');if(c){checked[c.dataset.chk]=c.checked;store.set("checked",checked);}};
}
async function refresh(demo){
  if(busy)return;$('error').innerHTML='';
  if(!demo&&!cfg.cle_api){$('error').innerHTML='<div class="err">Colle d’abord ta clé API dans les réglages.</div>';$('settings').open=true;return;}
  if(!cfg.championnats.length||!cfg.mes_bookmakers.length){$('error').innerHTML='<div class="err">Choisis au moins un championnat et un bookmaker.</div>';return;}
  busy=true;$('run').disabled=$('demo').disabled=true;$('status').textContent=demo?'Chargement de la démo…':'Récupération des cotes…';
  try{
    if(demo){demoCache={fetched_at:new Date().toISOString(),demo:true,events:Demo.events(),extras:Demo.extras(),logs:["[démo] matchs fictifs"],remaining:null};show(demoCache);}
    else{cache=await fetchAll();saveCache();show(cache);}
    if(matchMedia('(max-width:860px)').matches)$('settings').open=false;
  }catch(err){$('error').innerHTML=`<div class="err">${esc(err.message)}</div>`;$('status').textContent='';}
  finally{busy=false;$('run').disabled=$('demo').disabled=false;}
}
function loadQuota(){quota().then(setQuota).catch(()=>{});}
function setTab(t){tab=t;document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===t));$('viewTickets').hidden=t!=="tickets";$('settings').style.display=t==="tickets"?"":"none";$('viewBets').hidden=t!=="bets";$('viewTest').hidden=t!=="test";if(t==="bets")renderBets();if(t==="test")renderTest();}
function renderTest(){
  const P=paperData,box=$('test');
  if(!P){box.innerHTML=`<div class="empty">Le test papier n’a pas encore tourné.<br>Il démarre dès que les clés sont dans les secrets GitHub (voir README).</div>`;return;}
  const st={prudent:"Prudent",equilibre:"Équilibré",risque:"Risqué",gros:"Gros coup"};
  const prof=Object.values(P.profiles||{});
  const maxAbs=Math.max(1,...prof.flatMap(p=>(P.series[p.name]||[]).map(x=>Math.abs(x.cum))));
  const spark=name=>{const s=P.series[name]||[];if(s.length<2)return '';const W=300,H=60;const pts=s.map((x,i)=>`${(i/(s.length-1)*W).toFixed(1)},${(H/2-x.cum/maxAbs*(H/2-4)).toFixed(1)}`).join(' ');return `<svg viewBox="0 0 ${W} ${H}" class="spark"><line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}"/><polyline points="${pts}"/></svg>`;};
  box.innerHTML=`
   <p class="status">Depuis le ${P.first_day?dateFr(P.first_day):'—'} · ${P.days} journées · ${P.events} matchs · ${P.settled} paris réglés · mis à jour ${ago(P.updated)}</p>
   <div class="stats">
    <div class="kpi"><b class="num ${P.clv.avg>0?'up':P.clv.avg<0?'down':''}">${P.clv.avg==null?'—':spct(P.clv.avg)}</b><span>valeur à la clôture, moyenne (${P.clv.n} paris)</span></div>
    <div class="kpi"><b class="num">${P.clv.positive==null?'—':pct(P.clv.positive)}</b><span>paris qui battent la clôture</span></div>
    <div class="kpi"><b class="num">${P.logloss.market==null?'—':P.logloss.market.toFixed(3)}</b><span>log-loss marché${P.logloss.blend!=null&&P.weight_used?` · mélange ${P.logloss.blend.toFixed(3)}`:''}</span></div>
   </div>
   <p class="lab">Bilan par profil (bankroll fictive 100 €, mise 2 € par ticket, 5 tickets par journée)</p>
   <div class="tickets">${prof.map(p=>`<article class="t"><div class="t-top"><div><div class="t-rank">${st[p.name]||p.name} · ${p.label}</div><div class="t-odds num ${p.profit>0?'up':p.profit<0?'down':''}">${p.settled?(p.profit>=0?'+':'')+eur(p.profit):'—'}</div></div>
     <div class="t-prob"><div class="num">${p.roi==null?'—':spct(p.roi,0)}</div><div>ROI · ${p.won}/${p.settled} gagnés</div></div></div>${spark(p.name)}
     <ul class="legs"><li><span class="lm">Valeur à la clôture moyenne</span><span class="lp">${p.clv_avg==null?'—':spct(p.clv_avg)}</span></li><li><span class="lm">Tickets avec paris liés</span><span class="lp">${p.linked}</span></li></ul></article>`).join('')}</div>
   <div class="panel" style="margin-top:16px"><p class="lab">Calibration des probabilités (${P.settled} paris)</p>
    ${(P.calib.blend||[]).filter(b=>b.n>=5).map(b=>`<div class="cal"><span>${Math.round(b.lo*100)}–${Math.round(Math.min(b.hi,1)*100)} %</span><div class="bar"><i style="width:${b.hit*100}%"></i><em style="left:${b.pred*100}%"></em></div><span>${Math.round(b.hit*100)} % réel · ${b.n}</span></div>`).join('')||'<p class="hint">Pas encore assez de paris réglés.</p>'}
    <p class="hint">Barre = taux réel, trait = taux prédit. Si la barre est plus courte que le trait, l’appli est trop optimiste sur cette tranche.</p></div>
   <div class="panel" style="margin-top:16px"><p class="lab">Par type de pari</p>
    ${Object.entries(P.byMarket||{}).map(([k,m])=>`<div class="cal"><span>${esc(k)}</span><div class="bar"><i style="width:${m.hit*100}%"></i><em style="left:${m.pred*100}%"></em></div><span>${Math.round(m.hit*100)} % · ${m.n} · ROI ${spct(m.roi)}</span></div>`).join('')||'<p class="hint">—</p>'}</div>
   <details class="panel" style="margin-top:16px"><summary>Derniers tickets réglés</summary>${(P.recent||[]).map(t=>`<article class="t b-${t.won?'won':'lost'}" style="margin-top:10px"><div class="t-top"><div><div class="t-rank">${st[t.profile]||t.profile} · ${dateFr(t.date)}${t.linked?' · <span class="tag">liés</span>':''}</div><div class="t-odds num"><small>cote</small>${t.odds.toFixed(2)}</div></div><div class="t-prob"><div class="num ${t.profit>=0?'up':'down'}">${(t.profit>=0?'+':'')+eur(t.profit)}</div><div>${pct(t.prob)} prévu</div></div></div>
     <ul class="legs">${t.legs.map(l=>`<li class="r-${l.result}"><span class="lm">${esc(l.match)} · ${l.score}</span><span class="lp">${esc(l.pick)}</span><span class="lo"><span class="num">${l.price.toFixed(2)}</span><span>${pct(l.prob)}${l.clv!=null?' · CLV '+spct(l.clv):''}</span></span></li>`).join('')}</ul></article>`).join('')||'<p class="hint">Aucun pour l’instant.</p>'}</details>
   ${modelData?`<div class="panel" style="margin-top:16px"><p class="lab">Modèle maison (backtest ${modelData.backtest.n} matchs)</p><p class="hint">${esc(modelData.verdict)}</p><p class="hint">Log-loss 1N2 : marché ${modelData.backtest.ll['0']} · modèle seul ${modelData.backtest.ll.model_only} · ${Object.entries(modelData.backtest.ll).filter(([k])=>!isNaN(k)&&+k>0).map(([k,v])=>`mélange ${Math.round(k*100)} % → ${v}`).join(' · ')}. Plus bas = mieux.</p></div>`:''}`;
}

$('run').onclick=()=>refresh(false);$('demo').onclick=()=>refresh(true);
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.t));
$('settle').onclick=()=>settleBets(false);$('settleApi').onclick=()=>settleBets(true);$('mAdd').onclick=manualBet;$('exportB').onclick=exportBets;$('importB').onchange=e=>{if(e.target.files[0])importBets(e.target.files[0]);e.target.value='';};
bind();
if(matchMedia('(max-width:860px)').matches&&cache)$('settings').open=false;
loadData().then(()=>{bind();show(cache);settleFromResults();$('standInfo').textContent=standings?`Classements du ${new Date(standings.updated).toLocaleDateString('fr-FR')}`:"Classements pas encore disponibles (robot GitHub à activer).";});
if(cache&&cache.remaining!=null)setQuota(cache.remaining);else loadQuota();
if('serviceWorker' in navigator){try{navigator.serviceWorker.register('./sw.js').catch(()=>{});}catch(e){}}
}
