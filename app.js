{
/* ============================================================ constantes */
const BOOKS=[["betclic_fr","Betclic"],["winamax_fr","Winamax"],["unibet_fr","Unibet"],["parionssport_fr","Parions Sport"],["pmu_fr","PMU"],["netbet_fr","NetBet"]];
const LEAGUES=[["soccer_france_ligue_one","Ligue 1","FL1"],["soccer_france_ligue_two","Ligue 2",null],["soccer_epl","Premier League","PL"],["soccer_spain_la_liga","Liga","PD"],["soccer_italy_serie_a","Serie A","SA"],["soccer_germany_bundesliga","Bundesliga","BL1"],["soccer_uefa_champs_league","Ligue des champions","CL"],["soccer_uefa_europa_league","Ligue Europa",null],["soccer_portugal_primeira_liga","Portugal","PPL"],["soccer_netherlands_eredivisie","Eredivisie","DED"]];
const MARKETS=[["1N2","1N2"],["plus_moins_2_5","+/- 2,5 buts"],["les_deux_marquent","Les deux marquent"],["extras","Double chance, +1,5, équipe marque, sans nul"]];
const EXTRA_MARKETS="double_chance,alternate_totals,team_totals,draw_no_bet";
const PRESETS={
  prudent:{cote_totale_min:1.5,cote_totale_max:3,proba_min_par_selection:0.65,matchs_min_par_combi:2,matchs_max_par_combi:3,label:"Cote 1,5 à 3 · chaque pari ≥ 65 % · 2 à 3 paris"},
  equilibre:{cote_totale_min:2,cote_totale_max:5,proba_min_par_selection:0.5,matchs_min_par_combi:2,matchs_max_par_combi:4,label:"Cote 2 à 5 · chaque pari ≥ 50 % · 2 à 4 paris"},
  risque:{cote_totale_min:5,cote_totale_max:15,proba_min_par_selection:0.35,matchs_min_par_combi:3,matchs_max_par_combi:4,label:"Cote 5 à 15 · chaque pari ≥ 35 % · 3 à 4 paris"},
  gros:{cote_totale_min:15,cote_totale_max:80,proba_min_par_selection:0.2,matchs_min_par_combi:4,matchs_max_par_combi:4,label:"Cote 15 à 80 · chaque pari ≥ 20 % · 4 paris"}
};
const PKEYS=["cote_totale_min","cote_totale_max","proba_min_par_selection","matchs_min_par_combi","matchs_max_par_combi"];
const DEFAULTS={cle_api:"",classement:"mixte",valeur_mini:false,paris_lies:true,preselection:10,
  championnats:["soccer_france_ligue_one","soccer_epl","soccer_spain_la_liga","soccer_italy_serie_a","soccer_germany_bundesliga","soccer_uefa_champs_league"],
  mes_bookmakers:["betclic_fr"],marches:{"1N2":true,plus_moins_2_5:true,les_deux_marquent:false,extras:true},jours_a_venir:7,
  matchs_min_par_combi:2,matchs_max_par_combi:4,cote_totale_min:2,cote_totale_max:5,proba_min_par_selection:0.5,
  bankroll:100,mise_fixe_pct:0.02,nombre_de_combis_affiches:10};
const API="https://api.the-odds-api.com/v4";
const SHARP=["pinnacle","betfair_ex_eu","matchbook"];

/* ============================================================ stockage */
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
let cfg={...DEFAULTS,...store.get("cfg",{})};cfg.marches={...DEFAULTS.marches,...(cfg.marches||{})};delete cfg.mode;
let cache=store.get("cache",null);if(cache&&!cache.extras)cache.extras={};
let bets=store.get("bets",[]);
let checked=store.get("checked",{});
let standings=null;
let demoCache=null,last=null,timer=null,busy=false,tab="tickets";
const saveCfg=()=>store.set("cfg",cfg),saveCache=()=>store.set("cache",cache),saveBets=()=>store.set("bets",bets);

/* ============================================================ outils */
const $=id=>document.getElementById(id);
const prod=a=>a.reduce((x,y)=>x*y,1);
const pct=x=>(x*100).toFixed(x<0.1?1:0)+' %';
const eur=x=>x.toFixed(2).replace('.',',')+' €';
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const bookName=k=>(BOOKS.find(b=>b[0]===k)||[k,k.replace('_fr','')])[1];
const leagueName=k=>(LEAGUES.find(l=>l[0]===k)||[k,k])[1];
const when=iso=>{try{return new Date(iso).toLocaleString('fr-FR',{weekday:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
const ago=iso=>{const m=Math.round((Date.now()-new Date(iso))/60000);if(m<1)return "à l’instant";if(m<60)return `il y a ${m} min`;const h=Math.round(m/60);return h<48?`il y a ${h} h`:`le ${when(iso)}`;};
const setQuota=n=>{if(n!=null&&n!=='')$('quota').innerHTML=`Crédits restants : <b>${n}</b>`;};
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ');
function devig(prices){const imp=prices.map(p=>1/p),s0=imp.reduce((a,b)=>a+b,0);if(s0<=1)return imp.map(x=>x/s0);let lo=1,hi=5;for(let i=0;i<60;i++){const k=(lo+hi)/2;const s=imp.reduce((a,x)=>a+x**k,0);if(s>1)lo=k;else hi=k;}const k=(lo+hi)/2;return imp.map(x=>x**k);}

/* ============================================================ lecture des cotes */
function marketBooks(ev,mkey,point){
  const books={};
  for(const b of ev.bookmakers||[])for(const m of b.markets||[]){
    if(m.key!==mkey)continue;
    let outs=m.outcomes;
    if(point!=null)outs=outs.filter(o=>Math.abs((o.point||0)-point)<1e-9);
    if(outs.length)books[b.key]=Object.fromEntries(outs.map(o=>[o.name,o.price]));
  }
  return books;
}
function fairFromSharp(ev){
  const h2h=marketBooks(ev,"h2h"),tot=marketBooks(ev,"totals",2.5);
  const pick=(bk)=>SHARP.find(k=>k in bk);
  let pH,pD,pA,pO,ref;
  const sh=pick(h2h);
  if(sh){[pH,pD,pA]=devig([h2h[sh][ev.home_team],h2h[sh].Draw,h2h[sh][ev.away_team]]);ref=sh;}
  else{const all=Object.values(h2h).filter(b=>ev.home_team in b&&"Draw" in b&&ev.away_team in b);if(all.length<3)return null;
    const ps=all.map(b=>devig([b[ev.home_team],b.Draw,b[ev.away_team]]));[pH,pD,pA]=[0,1,2].map(i=>ps.reduce((a,p)=>a+p[i],0)/ps.length);ref="consensus";}
  const st=pick(tot);
  if(st)[pO]=devig([tot[st].Over,tot[st].Under]);
  else{const all=Object.values(tot).filter(b=>"Over" in b&&"Under" in b);if(all.length>=3){const ps=all.map(b=>devig([b.Over,b.Under]));pO=ps.reduce((a,p)=>a+p[0],0)/ps.length;}}
  return {pH,pD,pA,pO:pO??null,ref};
}
const fits=new Map();
function fitFor(ev){
  if(fits.has(ev.id))return fits.get(ev.id);
  const f=fairFromSharp(ev);const r=f?{...Model.fit(f.pH,f.pD,f.pA,f.pO),fair:f}:null;
  fits.set(ev.id,r);return r;
}
/* best price among my bookmakers for an outcome */
function bestPrice(books,name){
  let best=null;
  for(const [k,v] of Object.entries(books)){if(SHARP.includes(k)||(cfg.mes_bookmakers.length&&!cfg.mes_bookmakers.includes(k)))continue;if(name in v&&(!best||v[name]>best.price))best={book:k,price:v[name]};}
  return best;
}
function mkSel(ev,fit,mkey,side,point,team,label,bp,extra){
  const sel={id:`${ev.id}|${mkey}|${side}|${point??''}|${team??''}`,match_id:ev.id,sport_key:ev.sport_key,match:`${ev.home_team} - ${ev.away_team}`,home:ev.home_team,away:ev.away_team,
    league:ev.sport_title||"",kickoff:ev.commence_time,mkey,side,point,team,pick:label,price:bp.price,book:bp.book,extra:!!extra};
  sel.prob=Model.prob(fit,sel);sel.edge=sel.price*sel.prob-1;return sel;
}
function selectionsFor(ev){
  const fit=fitFor(ev);if(!fit||fit.err>2e-3)return [];
  const out=[],H=ev.home_team,A=ev.away_team;
  if(cfg.marches["1N2"]){const b=marketBooks(ev,"h2h");for(const [name,side,label] of [[H,'H',H],["Draw",'D',"Nul"],[A,'A',A]]){const bp=bestPrice(b,name);if(bp)out.push(mkSel(ev,fit,"h2h",side,null,null,label,bp));}}
  if(cfg.marches.plus_moins_2_5){const b=marketBooks(ev,"totals",2.5);for(const [name,side,label] of [["Over",'O',"+2,5 buts"],["Under",'U',"-2,5 buts"]]){const bp=bestPrice(b,name);if(bp)out.push(mkSel(ev,fit,"totals",side,2.5,null,label,bp));}}
  if(cfg.marches.les_deux_marquent){const b=marketBooks(ev,"btts");for(const [name,side,label] of [["Yes",'Y',"Les deux marquent"],["No",'N',"Pas les deux"]]){const bp=bestPrice(b,name);if(bp)out.push(mkSel(ev,fit,"btts",side,null,null,label,bp));}}
  const ex=cache&&cache.extras&&cache.extras[ev.id];
  if(cfg.marches.extras&&ex)out.push(...extraSelections(ev,fit,ex));
  return out;
}
/* marchés supplémentaires : parsing tolérant des noms d'issues */
function extraSelections(ev,fit,ex){
  const out=[],H=ev.home_team,A=ev.away_team,nh=norm(H),na=norm(A);
  const side=(name)=>{const n=norm(name);const hasH=n.includes(nh),hasA=n.includes(na),hasD=/draw|nul/.test(n);
    if(hasH&&hasD||/^1x$/.test(n.trim()))return '1X';if(hasA&&hasD||/^x2$/.test(n.trim()))return 'X2';if(hasH&&hasA||/^12$/.test(n.trim()))return '12';if(hasH)return 'H';if(hasA)return 'A';return null;};
  const byMarket={};
  for(const b of ex.bookmakers||[]){if(SHARP.includes(b.key)||(cfg.mes_bookmakers.length&&!cfg.mes_bookmakers.includes(b.key)))continue;
    for(const m of b.markets||[])for(const o of m.outcomes||[]){const key=m.key+"|"+o.name+"|"+(o.point??'')+"|"+(o.description??'');(byMarket[key]=byMarket[key]||{m:m.key,o,best:null});
      if(!byMarket[key].best||o.price>byMarket[key].best.price)byMarket[key].best={book:b.key,price:o.price};}}
  for(const {m,o,best} of Object.values(byMarket)){
    if(m==="double_chance"){const s=side(o.name);if(!['1X','X2','12'].includes(s))continue;const lab={'1X':`${H} ou nul`,'X2':`${A} ou nul`,'12':`${H} ou ${A}`}[s];out.push(mkSel(ev,fit,"double_chance",s,null,null,lab,best,true));}
    else if(m==="draw_no_bet"){const s=side(o.name);if(s!=='H'&&s!=='A')continue;out.push(mkSel(ev,fit,"draw_no_bet",s,null,null,`${s==='H'?H:A} (nul remboursé)`,best,true));}
    else if(m==="alternate_totals"||m==="totals"){const pt=+o.point;if(!(pt%1===0.5)||pt===2.5||pt<0.5||pt>4.5)continue;const s=/over/i.test(o.name)?'O':/under/i.test(o.name)?'U':null;if(!s)continue;
      out.push(mkSel(ev,fit,"totals",s,pt,null,`${s==='O'?'+':'-'}${String(pt).replace('.',',')} buts`,best,true));}
    else if(m==="team_totals"||m==="alternate_team_totals"){const pt=+o.point;if(!(pt%1===0.5)||pt<0.5||pt>2.5)continue;const t=side(o.description||'');if(t!=='H'&&t!=='A')continue;const s=/over/i.test(o.name)?'O':/under/i.test(o.name)?'U':null;if(!s)continue;
      const tn=t==='H'?H:A;out.push(mkSel(ev,fit,"team_totals",s,pt,t,pt===0.5&&s==='O'?`${tn} marque`:`${tn} ${s==='O'?'+':'-'}${String(pt).replace('.',',')} buts`,best,true));}
  }
  return out;
}

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
function context(ev,events){
  const f=fatigue(ev,events),s=stakes(ev)||[];
  const warn=f.length>0||s.some(x=>/rien à jouer|éliminé/.test(x));
  return {lines:[...s,...f],warn,link:`https://www.google.com/search?q=${encodeURIComponent('compo '+ev.home_team+' '+ev.away_team)}`};
}

/* ============================================================ tickets */
function* combinations(arr,n,start=0,acc=[]){if(acc.length===n){yield acc;return;}for(let i=start;i<=arr.length-(n-acc.length);i++)yield* combinations(arr,n,i+1,[...acc,arr[i]]);}
const scoreOf=(odds,prob)=>cfg.classement==="chances"?prob:cfg.classement==="valeur"?odds*prob:odds*prob**1.5;
function ticketProb(legs,evById){
  const byM={};for(const l of legs)(byM[l.match_id]=byM[l.match_id]||[]).push(l);
  let p=1,linked=false,indep=1;
  for(const [mid,ls] of Object.entries(byM)){
    const pi=prod(ls.map(l=>l.prob));indep*=pi;
    if(ls.length===1){p*=pi;continue;}
    const fit=fitFor(evById[mid]);const j=Model.joint(fit,ls);
    // pari redondant (l'un implique l'autre) : inutile
    if(j>0.98*Math.min(...ls.map(l=>l.prob)))return null;
    linked=true;p*=j;
  }
  return {prob:p,linked,indep};
}
function buildTickets(sel,evById){
  let pool=sel.filter(s=>s.prob>=cfg.proba_min_par_selection&&(!cfg.valeur_mini||s.edge>=0));
  // au plus 3 sélections par match dans le pool, les meilleures par score
  const byM={};for(const s of pool.sort((a,b)=>scoreOf(b.price,b.prob)-scoreOf(a.price,a.prob)))(byM[s.match_id]=byM[s.match_id]||[]).push(s);
  pool=Object.values(byM).flatMap(ls=>ls.slice(0,cfg.paris_lies?3:1)).sort((a,b)=>scoreOf(b.price,b.prob)-scoreOf(a.price,a.prob)).slice(0,42);
  const out=[];let count=0;
  for(let n=cfg.matchs_min_par_combi;n<=cfg.matchs_max_par_combi;n++)for(const legs of combinations(pool,n)){
    if(++count>250000)break;
    const nM=new Set(legs.map(l=>l.match_id)).size;
    if(!cfg.paris_lies&&nM<n)continue;
    if(nM<n&&(n-nM)>1)continue;             // au plus une paire liée par ticket
    if(nM<2&&n>=2&&legs.length>2)continue;
    const odds=prod(legs.map(l=>l.price));if(odds<cfg.cote_totale_min||odds>cfg.cote_totale_max)continue;
    const tp=ticketProb(legs,evById);if(!tp)continue;
    out.push({legs,odds,prob:tp.prob,linked:tp.linked,boost:tp.prob/tp.indep-1,ev:odds*tp.prob-1});
  }
  return out.sort((a,b)=>scoreOf(b.odds,b.prob)-scoreOf(a.odds,a.prob)).slice(0,cfg.nombre_de_combis_affiches)
    .map(t=>{const stake=cfg.bankroll*cfg.mise_fixe_pct;return {...t,stake,gain:stake*t.odds};});
}
function compute(c){
  fits.clear();
  const now=Date.now(),limit=now+cfg.jours_a_venir*864e5,leagues=new Set(cfg.championnats);
  const events=c.events.filter(e=>(c.demo||leagues.has(e.sport_key))&&Date.parse(e.commence_time)>now&&Date.parse(e.commence_time)<=limit);
  const evById=Object.fromEntries(c.events.map(e=>[e.id,e]));
  const sel=events.flatMap(selectionsFor);
  const tickets=buildTickets(sel,evById);
  const ctx={};for(const e of events)ctx[e.id]=context(e,c.events);
  const p=c.params||{};
  const missing=c.demo?[]:[...leagues].filter(l=>!(p.championnats||[]).includes(l));
  const staleM=!c.demo&&["1N2","plus_moins_2_5","les_deux_marquent"].some(m=>cfg.marches[m]&&!(p.marches||{})[m]);
  const staleB=!c.demo&&cfg.mes_bookmakers.some(b=>!(p.mes_bookmakers||[]).includes(b));
  const nExtra=events.filter(e=>c.extras&&c.extras[e.id]).length;
  return {tickets,events,ctx,matches:events.length,demo:!!c.demo,fetched_at:c.fetched_at,remaining:c.remaining,logs:c.logs||[],missing,needs_refresh:!!(missing.length||staleM||staleB),nExtra,
    noExtra:cfg.marches.extras&&!c.demo&&nExtra===0};
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
  const rank=events.map(e=>{const f=fitFor(e);if(!f)return null;const m=Math.max(f.fair.pH,f.fair.pA,f.fair.pO||0);return {e,m};}).filter(Boolean).sort((a,b)=>b.m-a.m).slice(0,cfg.preselection);
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
  fits.clear();
  if(cfg.marches.extras){$('status').textContent='Marchés supplémentaires…';c.remaining=await fetchStage2(c,logs)??rem;}
  return c;
}
async function quota(){if(!cfg.cle_api)return null;const [,rem]=await apiGet(`${API}/sports/?apiKey=${K()}`);return rem;}
async function loadStandings(){
  try{const r=await fetch(`./data/standings.json?t=${Math.floor(Date.now()/36e5)}`);if(r.ok){standings=await r.json();store.set("standings",standings);}}catch(e){}
  if(!standings)standings=store.get("standings",null);
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
async function settleBets(){
  const pend=bets.filter(b=>!b.manual&&b.status==="pending"&&!b.demo);
  if(!pend.length){$('bStatus').textContent="Aucun ticket en attente.";return;}
  if(!cfg.cle_api){$('bStatus').textContent="Colle ta clé API dans les réglages.";return;}
  const sports=[...new Set(pend.flatMap(b=>b.legs.filter(l=>!l.result&&Date.parse(l.kickoff)<Date.now()-115*60e3).map(l=>l.sport_key)))];
  if(!sports.length){$('bStatus').textContent="Les matchs ne sont pas encore terminés.";return;}
  $('bStatus').textContent=`Récupération des scores (${sports.length*2} crédits)…`;
  const scores={};let rem=null;
  for(const sp of sports){try{const [data,r]=await apiGet(`${API}/sports/${sp}/scores/?apiKey=${K()}&daysFrom=3`);if(r!=null)rem=r;for(const g of data)if(g.completed&&g.scores)scores[g.id]=g;}catch(err){$('bStatus').textContent=err.message;return;}}
  let n=0;
  for(const b of pend){for(const l of b.legs){if(l.result)continue;const g=scores[l.match_id];if(!g)continue;
      const sc=Object.fromEntries(g.scores.map(s=>[s.name,+s.score]));const h=sc[l.home],a=sc[l.away];if(h==null||a==null)continue;
      l.score=`${h}-${a}`;l.result=Model.settle(l,h,a);n++;}
    settleOne(b);}
  saveBets();if(rem!=null){setQuota(rem);if(cache){cache.remaining=rem;saveCache();}}
  $('bStatus').textContent=n?`${n} paris réglés.`:"Pas encore de score disponible (l’API les publie après le match).";
  renderBets();
}
function betStats(){
  const done=bets.filter(b=>b.status!=="pending");const staked=done.reduce((a,b)=>a+b.stake,0),profit=done.reduce((a,b)=>a+(b.profit||0),0);
  const legs=bets.flatMap(b=>b.legs.filter(l=>l.result&&l.result!=="push"));
  const buckets=[[0,.35],[.35,.5],[.5,.65],[.65,.8],[.8,1.01]].map(([lo,hi])=>{const ls=legs.filter(l=>l.prob>=lo&&l.prob<hi);return {lo,hi,n:ls.length,hit:ls.length?ls.filter(l=>l.result==="win").length/ls.length:null,pred:ls.length?ls.reduce((a,l)=>a+l.prob,0)/ls.length:null};});
  return {n:bets.length,done:done.length,won:done.filter(b=>b.status==="won").length,staked,profit,roi:staked?profit/staked:null,pending:bets.filter(b=>b.status==="pending").length,buckets,legs:legs.length};
}
function renderBets(){
  const s=betStats();
  $('stats').innerHTML=`
   <div class="kpi"><b class="num ${s.profit>0?'up':s.profit<0?'down':''}">${s.profit>=0?'+':''}${eur(s.profit)}</b><span>bilan net</span></div>
   <div class="kpi"><b class="num">${s.roi==null?'—':(s.roi*100).toFixed(1)+' %'}</b><span>ROI</span></div>
   <div class="kpi"><b class="num">${s.won}/${s.done}</b><span>tickets gagnés</span></div>
   <div class="kpi"><b class="num">${s.pending}</b><span>en attente</span></div>`;
  $('calib').innerHTML=s.legs<10?`<p class="hint">La calibration (les « 70 % » passent-ils 7 fois sur 10 ?) s’affiche à partir de 10 paris réglés. Pour l’instant : ${s.legs}.</p>`
   :`<p class="lab">Calibration des probabilités (${s.legs} paris réglés)</p>`+s.buckets.filter(b=>b.n).map(b=>`<div class="cal"><span>${Math.round(b.lo*100)}–${Math.round(Math.min(b.hi,1)*100)} %</span><div class="bar"><i style="width:${b.hit*100}%"></i><em style="left:${b.pred*100}%"></em></div><span>${Math.round(b.hit*100)} % réel · ${b.n}</span></div>`).join('')+`<p class="hint">Barre = taux réel, trait = taux prédit. Barre plus courte que le trait = l’appli est trop optimiste.</p>`;
  const box=$('bets');
  if(!bets.length){box.innerHTML=`<div class="empty">Aucun ticket joué. Sur un ticket, appuie sur <b>Je joue</b> pour l’enregistrer ici.</div>`;return;}
  const st={pending:"en attente",won:"gagné",lost:"perdu",void:"remboursé"};
  box.innerHTML=bets.map(b=>`<article class="t b-${b.status}">
    <div class="t-top"><div><div class="t-rank">${when(b.placed_at)}${b.demo?' · démo':''}${b.manual?' · saisi à la main':''}</div><div class="t-odds num"><small>cote</small>${(b.odds_final||b.odds).toFixed(2)}</div></div>
     <div class="t-prob"><div class="num">${b.status==="pending"?(b.prob!=null?pct(b.prob):'—'):(b.profit>=0?'+':'')+eur(b.profit||0)}</div><div>${b.status==="pending"?'de chances':st[b.status]}</div></div></div>
    ${b.manual?`<ul class="legs"><li><span class="lp">${esc(b.label)}</span></li></ul>`:`<ul class="legs">${b.legs.map(l=>`<li class="r-${l.result||'none'}"><span class="lm">${esc(l.match)} · ${when(l.kickoff)}${l.score?' · <b>'+l.score+'</b>':''}</span><span class="lp">${esc(l.pick)}</span><span class="lo"><span class="num">${l.price.toFixed(2)}</span><span>${l.result?({win:'✓ gagné',lose:'✗ perdu',push:'remboursé'})[l.result]:bookName(l.book)}</span></span></li>`).join('')}</ul>`}
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
const currentPreset=()=>Object.keys(PRESETS).find(p=>PKEYS.every(k=>Math.abs(PRESETS[p][k]-cfg[k])<1e-9))||'';
function cost(){const nm=(cfg.marches["1N2"]?1:0)+(cfg.marches.plus_moins_2_5?1:0)||1;return cfg.championnats.length*nm+(cfg.marches.extras?cfg.preselection*4:0);}
function labels(){
  const n=cost();$('runCost').textContent=`(≈ ${n} crédits${cfg.marches.les_deux_marquent?' + 1/match':''})`;
  $('cost').textContent="Changer les filtres est gratuit : seul « Actualiser les cotes » consomme des crédits.";
  $('bttsWarn').hidden=!cfg.marches.les_deux_marquent;$('extraWarn').hidden=!cfg.marches.extras;$('preselBox').hidden=!cfg.marches.extras;
  $('pMinV').textContent=Math.round(cfg.proba_min_par_selection*100)+' %';$('daysV').textContent=cfg.jours_a_venir+' jour'+(cfg.jours_a_venir>1?'s':'');
  $('preselV').textContent=cfg.preselection+' matchs';
  const p=currentPreset();$('presetHint').textContent=p?PRESETS[p].label:"Réglages perso";$('preset').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===p));
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
  labels();
}
const ticketText=(t,i)=>`Combiné #${i+1} — cote ${t.odds.toFixed(2)} (${pct(t.prob)} de chances)\n`+t.legs.map(l=>`• ${l.match} : ${l.pick} @${l.price.toFixed(2)} (${bookName(l.book)})`).join('\n')+`\nMise ${eur(t.stake)} → ${eur(t.gain)}`;

function show(c){
  const box=$('tickets'),note=$('note');
  if(!c){last=null;box.innerHTML=`<div class="empty">Aucune cote enregistrée pour l’instant.<br>Colle ta clé API dans les réglages puis appuie sur <b>Actualiser les cotes</b>, ou essaie la <b>Démo</b>.</div>`;$('status').textContent='';note.innerHTML='';$('logsBox').hidden=true;return;}
  const res=compute(c);last=res;
  $('status').innerHTML=res.demo?'Démo : matchs inventés, ne les joue pas.':`<span class="fresh">Cotes récupérées ${ago(res.fetched_at)}</span> · ${res.matches} matchs · ${res.tickets.length} tickets`;
  setQuota(res.remaining);
  const warn=[];
  if(res.missing.length)warn.push(`Pas encore de cotes pour : ${res.missing.map(leagueName).join(', ')}.`);else if(res.needs_refresh)warn.push("Tu as ajouté un bookmaker ou un type de pari.");
  if(!res.demo&&res.fetched_at&&(Date.now()-new Date(res.fetched_at))>6*3600e3)warn.push("Les cotes ont plus de 6 h, elles ont pu bouger.");
  if(res.noExtra&&c.params)warn.push("Aucune cote trouvée pour les marchés supplémentaires chez tes bookmakers : l’API ne les couvre peut-être pas encore pour eux.");
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
    <details class="ctx"><summary>Contexte des matchs${mids.some(m=>res.ctx[m].warn)?' · <b>⚠ à lire</b>':''}</summary>${ctxHtml}</details>
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
function setTab(t){tab=t;document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-pressed',b.dataset.t===t));$('viewTickets').hidden=t!=="tickets";$('settings').style.display=t==="tickets"?"":"none";$('viewBets').hidden=t!=="bets";if(t==="bets")renderBets();}

$('run').onclick=()=>refresh(false);$('demo').onclick=()=>refresh(true);
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.t));
$('settle').onclick=settleBets;$('mAdd').onclick=manualBet;$('exportB').onclick=exportBets;$('importB').onchange=e=>{if(e.target.files[0])importBets(e.target.files[0]);e.target.value='';};
bind();
if(matchMedia('(max-width:860px)').matches&&cache)$('settings').open=false;
loadStandings().then(()=>{show(cache);$('standInfo').textContent=standings?`Classements du ${new Date(standings.updated).toLocaleDateString('fr-FR')}`:"Classements pas encore disponibles (robot GitHub à activer).";});
if(cache&&cache.remaining!=null)setQuota(cache.remaining);else loadQuota();
if('serviceWorker' in navigator){try{navigator.serviceWorker.register('./sw.js').catch(()=>{});}catch(e){}}
}
