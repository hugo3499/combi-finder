/* Moteur partagé : lecture des cotes, probabilités justes, sélections, tickets.
   Fonctionne dans le navigateur (global Engine) et dans Node (module.exports).
   Aucune interface ici : tout prend `cfg` en paramètre. Dépend de Model. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./model.js'));
  else root.Engine = factory(typeof Model !== 'undefined' ? Model : root.Model);
})(typeof self !== 'undefined' ? self : this, function (Model) {

const BOOKS=[["betclic_fr","Betclic"],["winamax_fr","Winamax"],["unibet_fr","Unibet"],["parionssport_fr","Parions Sport"],["pmu_fr","PMU"],["netbet_fr","NetBet"]];
/* [clé Odds API, nom, code football-data.org, code football-data.co.uk] */
const LEAGUES=[["soccer_france_ligue_one","Ligue 1","FL1","F1"],["soccer_france_ligue_two","Ligue 2",null,"F2"],["soccer_epl","Premier League","PL","E0"],["soccer_spain_la_liga","Liga","PD","SP1"],["soccer_italy_serie_a","Serie A","SA","I1"],["soccer_germany_bundesliga","Bundesliga","BL1","D1"],["soccer_uefa_champs_league","Ligue des champions","CL",null],["soccer_uefa_europa_league","Ligue Europa",null,null],["soccer_portugal_primeira_liga","Portugal","PPL","P1"],["soccer_netherlands_eredivisie","Eredivisie","DED","N1"]];
/* Profils réglés « en pro » : pour une même cote, moins de paris = moins de marge
   payée ; plus le ticket est risqué, plus la mise est petite. Tout est appliqué d'un
   coup (téléphone ET robot du test papier). */
const PRESETS={
  prudent:{cote_totale_min:1.6,cote_totale_max:2.4,matchs_min_par_combi:2,matchs_max_par_combi:2,proba_min_par_selection:0.6,classement:"mixte",paris_lies:true,valeur_mini:false,mise_fixe_pct:0.02,
    label:"Cote 1,6 à 2,4 · 2 paris · chaque pari ≥ 60 % · classés en mixte · mise 2 %"},
  equilibre:{cote_totale_min:2.2,cote_totale_max:4,matchs_min_par_combi:2,matchs_max_par_combi:3,proba_min_par_selection:0.42,classement:"valeur",paris_lies:true,valeur_mini:false,mise_fixe_pct:0.015,
    label:"Cote 2,2 à 4 · 2 à 3 paris · chaque pari ≥ 42 % · classés par valeur · mise 1,5 %"},
  risque:{cote_totale_min:4,cote_totale_max:10,matchs_min_par_combi:2,matchs_max_par_combi:3,proba_min_par_selection:0.28,classement:"valeur",paris_lies:true,valeur_mini:false,mise_fixe_pct:0.01,
    label:"Cote 4 à 10 · 2 à 3 paris · chaque pari ≥ 28 % · classés par valeur · mise 1 %"},
  gros:{cote_totale_min:10,cote_totale_max:40,matchs_min_par_combi:3,matchs_max_par_combi:4,proba_min_par_selection:0.2,classement:"valeur",paris_lies:true,valeur_mini:false,mise_fixe_pct:0.005,
    label:"Cote 10 à 40 · 3 à 4 paris · chaque pari ≥ 20 % · classés par valeur · mise 0,5 %"}
};
const PKEYS=["cote_totale_min","cote_totale_max","matchs_min_par_combi","matchs_max_par_combi","proba_min_par_selection","classement","paris_lies","valeur_mini","mise_fixe_pct"];
const samePreset=(cfg,p)=>PKEYS.every(k=>typeof p[k]==="number"?Math.abs(p[k]-cfg[k])<1e-9:p[k]===cfg[k]);
const DEFAULTS={cle_api:"",preselection:10,
  championnats:["soccer_france_ligue_one","soccer_epl","soccer_spain_la_liga","soccer_italy_serie_a","soccer_germany_bundesliga","soccer_uefa_champs_league"],
  mes_bookmakers:["betclic_fr"],marches:{"1N2":true,plus_moins_2_5:true,les_deux_marquent:false,extras:true},jours_a_venir:7,
  bankroll:100,nombre_de_combis_affiches:10,poids_modele:null};
for(const k of PKEYS)DEFAULTS[k]=PRESETS.equilibre[k];
const SHARP=["pinnacle","betfair_ex_eu","matchbook"];

const prod=a=>a.reduce((x,y)=>x*y,1);
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function devig(prices){const imp=prices.map(p=>1/p),s0=imp.reduce((a,b)=>a+b,0);if(s0<=1)return imp.map(x=>x/s0);let lo=1,hi=5;for(let i=0;i<60;i++){const k=(lo+hi)/2;const s=imp.reduce((a,x)=>a+x**k,0);if(s>1)lo=k;else hi=k;}const k=(lo+hi)/2;return imp.map(x=>x**k);}

/* ---------- rapprochement des noms d'équipes entre sources ---------- */
const STOP=new Set(["fc","cf","sc","ac","as","ss","ssc","rc","rcd","afc","us","ud","sd","cd","sv","vfl","vfb","tsg","fsv","bsc","bv","1","club","de","of","the","calcio","sport","sporting","athletic","olympique","stade","union","town","city","united","hotspur","and","ss","sv","fk","sk","1901","1899","1904","1909","1846","1860","04","05","09"]);
const ALIAS={"paris sg":"psg","paris saint germain":"psg","man united":"manchester united","man city":"manchester city","ath madrid":"atletico madrid","atletico de madrid":"atletico madrid","ath bilbao":"athletic bilbao","athletic club":"athletic bilbao","wolves":"wolverhampton","nott m forest":"nottingham forest","nottm forest":"nottingham forest","inter":"internazionale","inter milan":"internazionale","fc internazionale milano":"internazionale","milan":"ac milan","ac milan":"ac milan","spurs":"tottenham","leverkusen":"bayer leverkusen","m gladbach":"monchengladbach","borussia monchengladbach":"monchengladbach","gladbach":"monchengladbach","dortmund":"borussia dortmund","bayern":"bayern munich","bayern munchen":"bayern munich","fc bayern munchen":"bayern munich","st etienne":"saint etienne","as saint etienne":"saint etienne","marseille":"olympique marseille","olympique de marseille":"olympique marseille","lyon":"olympique lyonnais","olympique lyonnais":"olympique lyonnais","rb leipzig":"leipzig","rasenballsport leipzig":"leipzig","ein frankfurt":"eintracht frankfurt","fc koln":"koln","1 fc koln":"koln","cologne":"koln","mainz":"mainz","1 fsv mainz 05":"mainz","newcastle":"newcastle united","brighton":"brighton hove albion","brighton and hove albion":"brighton hove albion","west ham":"west ham united","villa":"aston villa","sociedad":"real sociedad","betis":"real betis","vallecano":"rayo vallecano","alaves":"deportivo alaves","celta":"celta vigo","espanol":"espanyol","verona":"hellas verona","roma":"as roma","lazio":"ss lazio","napoli":"ssc napoli","juventus":"juventus","atalanta":"atalanta","lens":"rc lens","lille":"lille osc","nice":"ogc nice","rennes":"stade rennais","brest":"stade brestois","le havre":"le havre","auxerre":"aj auxerre","angers":"angers sco","nantes":"fc nantes","monaco":"as monaco","strasbourg":"rc strasbourg","toulouse":"fc toulouse","reims":"stade de reims","montpellier":"montpellier hsc","lorient":"fc lorient","metz":"fc metz","paris fc":"paris fc"};
function canon(name){
  let n=norm(name).replace(/\b(fc|cf|sc|ac|afc|ssc|rcd|ud|sd|cd|sv|vfl|vfb|tsg|fsv|bsc|bv|fk|sk)\b/g,' ').replace(/\s+/g,' ').trim();
  if(ALIAS[n])return ALIAS[n];
  const raw=norm(name);if(ALIAS[raw])return ALIAS[raw];
  return n;
}
const toks=s=>canon(s).split(' ').filter(t=>t&&!STOP.has(t)&&t.length>1);
/* score de ressemblance 0..1 entre deux noms */
function sim(a,b){
  const ca=canon(a),cb=canon(b);if(ca===cb)return 1;
  const ta=toks(a),tb=toks(b);if(!ta.length||!tb.length)return 0;
  const common=ta.filter(t=>tb.includes(t)||tb.some(u=>u.length>4&&t.length>4&&(u.startsWith(t)||t.startsWith(u)))).length;
  return common/Math.max(ta.length,tb.length)*(common?1:0);
}
function findTeam(name,candidates,getName=x=>x){
  let best=null,bs=0;for(const c of candidates){const s=sim(name,getName(c));if(s>bs){bs=s;best=c;}}
  return bs>=0.5?best:null;
}

/* ---------- cotes → probabilités ---------- */
function marketBooks(ev,mkey,point){
  const books={};
  for(const b of ev.bookmakers||[])for(const m of b.markets||[]){
    if(m.key!==mkey)continue;let outs=m.outcomes;
    if(point!=null)outs=outs.filter(o=>Math.abs((o.point||0)-point)<1e-9);
    if(outs.length)books[b.key]=Object.fromEntries(outs.map(o=>[o.name,o.price]));
  }
  return books;
}
function fairFromSharp(ev){
  const h2h=marketBooks(ev,"h2h"),tot=marketBooks(ev,"totals",2.5);
  const pick=bk=>SHARP.find(k=>k in bk);
  let pH,pD,pA,pO=null,ref;
  const sh=pick(h2h);
  if(sh&&h2h[sh][ev.home_team]&&h2h[sh].Draw&&h2h[sh][ev.away_team]){[pH,pD,pA]=devig([h2h[sh][ev.home_team],h2h[sh].Draw,h2h[sh][ev.away_team]]);ref=sh;}
  else{const all=Object.values(h2h).filter(b=>ev.home_team in b&&"Draw" in b&&ev.away_team in b);if(all.length<3)return null;
    const ps=all.map(b=>devig([b[ev.home_team],b.Draw,b[ev.away_team]]));[pH,pD,pA]=[0,1,2].map(i=>ps.reduce((a,p)=>a+p[i],0)/ps.length);ref="consensus";}
  const st=pick(tot);
  if(st&&tot[st].Over&&tot[st].Under)[pO]=devig([tot[st].Over,tot[st].Under]);
  else{const all=Object.values(tot).filter(b=>"Over" in b&&"Under" in b);if(all.length>=3){const ps=all.map(b=>devig([b.Over,b.Under]));pO=ps.reduce((a,p)=>a+p[0],0)/ps.length;}}
  return {pH,pD,pA,pO,ref};
}
/* probabilités du modèle maison (data/model.json) pour un match, ou null */
function modelProbs(ev,model){
  if(!model||!model.leagues)return null;
  const lg=model.leagues[ev.sport_key];if(!lg)return null;
  const h=findTeam(ev.home_team,Object.keys(lg.teams)),a=findTeam(ev.away_team,Object.keys(lg.teams));if(!h||!a)return null;
  const lh=Math.exp(lg.home_adv+lg.teams[h].att-lg.teams[a].def),la=Math.exp(lg.teams[a].att-lg.teams[h].def);
  const f={lh,la,m:Model.matrixFor(lh,la)};
  return {pH:Model.sum(f.m,(x,y)=>x>y),pD:Model.sum(f.m,(x,y)=>x===y),pA:Model.sum(f.m,(x,y)=>x<y),pO:Model.sum(f.m,(x,y)=>x+y>2.5),lh,la};
}
/* ajustement complet d'un match : marché (+ mélange modèle si poids > 0) */
function fitEvent(ev,opts={}){
  const f=fairFromSharp(ev);if(!f)return null;
  let fair={...f},mp=null,w=0;
  if(opts.model&&(opts.weight||0)>0){mp=modelProbs(ev,opts.model);
    if(mp){w=opts.weight;const mix=(a,b)=>a==null?b:b==null?a:(1-w)*a+w*b;fair={pH:mix(f.pH,mp.pH),pD:mix(f.pD,mp.pD),pA:mix(f.pA,mp.pA),pO:mix(f.pO,mp.pO),ref:f.ref};}}
  const fit=Model.fit(fair.pH,fair.pD,fair.pA,fair.pO);
  const disagree=mp?Math.max(Math.abs(mp.pH-f.pH),Math.abs(mp.pA-f.pA)):0;
  return {...fit,fair,market:f,model:mp,weight:w,disagree};
}

/* ---------- sélections ---------- */
function bestPrice(books,name,myBooks){
  let best=null;
  for(const [k,v] of Object.entries(books)){if(SHARP.includes(k)||(myBooks.length&&!myBooks.includes(k)))continue;if(name in v&&(!best||v[name]>best.price))best={book:k,price:v[name]};}
  return best;
}
function mkSel(ev,fit,mkey,side,point,team,label,bp,extra){
  const sel={id:`${ev.id}|${mkey}|${side}|${point??''}|${team??''}`,match_id:ev.id,sport_key:ev.sport_key,match:`${ev.home_team} - ${ev.away_team}`,home:ev.home_team,away:ev.away_team,
    league:ev.sport_title||"",kickoff:ev.commence_time,mkey,side,point:point??null,team:team??null,pick:label,price:bp.price,book:bp.book,extra:!!extra};
  sel.prob=Model.prob(fit,sel);sel.edge=sel.price*sel.prob-1;return sel;
}
function selectionsFor(ev,fit,cfg,extras){
  if(!fit||fit.err>2e-3)return [];
  const out=[],H=ev.home_team,A=ev.away_team,my=cfg.mes_bookmakers||[];
  if(cfg.marches["1N2"]){const b=marketBooks(ev,"h2h");for(const [name,side,label] of [[H,'H',H],["Draw",'D',"Nul"],[A,'A',A]]){const bp=bestPrice(b,name,my);if(bp)out.push(mkSel(ev,fit,"h2h",side,null,null,label,bp));}}
  if(cfg.marches.plus_moins_2_5){const b=marketBooks(ev,"totals",2.5);for(const [name,side,label] of [["Over",'O',"+2,5 buts"],["Under",'U',"-2,5 buts"]]){const bp=bestPrice(b,name,my);if(bp)out.push(mkSel(ev,fit,"totals",side,2.5,null,label,bp));}}
  if(cfg.marches.les_deux_marquent){const b=marketBooks(ev,"btts");for(const [name,side,label] of [["Yes",'Y',"Les deux marquent"],["No",'N',"Pas les deux"]]){const bp=bestPrice(b,name,my);if(bp)out.push(mkSel(ev,fit,"btts",side,null,null,label,bp));}}
  const ex=extras&&extras[ev.id];
  if(cfg.marches.extras&&ex)out.push(...extraSelections(ev,fit,ex,my));
  return out;
}
function extraSelections(ev,fit,ex,my){
  const out=[],H=ev.home_team,A=ev.away_team,nh=norm(H),na=norm(A);
  const side=name=>{const n=norm(name);const hasH=n.includes(nh),hasA=n.includes(na),hasD=/draw|nul/.test(n);
    if(hasH&&hasD||/^1x$/.test(n))return '1X';if(hasA&&hasD||/^x2$/.test(n))return 'X2';if(hasH&&hasA||/^12$/.test(n))return '12';if(hasH)return 'H';if(hasA)return 'A';return null;};
  const byKey={};
  for(const b of ex.bookmakers||[]){if(SHARP.includes(b.key)||(my.length&&!my.includes(b.key)))continue;
    for(const m of b.markets||[])for(const o of m.outcomes||[]){const key=m.key+"|"+o.name+"|"+(o.point??'')+"|"+(o.description??'');(byKey[key]=byKey[key]||{m:m.key,o,best:null});
      if(!byKey[key].best||o.price>byKey[key].best.price)byKey[key].best={book:b.key,price:o.price};}}
  for(const {m,o,best} of Object.values(byKey)){
    if(m==="double_chance"){const s=side(o.name);if(!['1X','X2','12'].includes(s))continue;out.push(mkSel(ev,fit,"double_chance",s,null,null,{'1X':`${H} ou nul`,'X2':`${A} ou nul`,'12':`${H} ou ${A}`}[s],best,true));}
    else if(m==="draw_no_bet"){const s=side(o.name);if(s!=='H'&&s!=='A')continue;out.push(mkSel(ev,fit,"draw_no_bet",s,null,null,`${s==='H'?H:A} (nul remboursé)`,best,true));}
    else if(m==="alternate_totals"||m==="totals"){const pt=+o.point;if(!(pt%1===0.5)||pt===2.5||pt<0.5||pt>4.5)continue;const s=/over/i.test(o.name)?'O':/under/i.test(o.name)?'U':null;if(!s)continue;
      out.push(mkSel(ev,fit,"totals",s,pt,null,`${s==='O'?'+':'-'}${String(pt).replace('.',',')} buts`,best,true));}
    else if(m==="team_totals"||m==="alternate_team_totals"){const pt=+o.point;if(!(pt%1===0.5)||pt<0.5||pt>2.5)continue;const t=side(o.description||'');if(t!=='H'&&t!=='A')continue;const s=/over/i.test(o.name)?'O':/under/i.test(o.name)?'U':null;if(!s)continue;
      const tn=t==='H'?H:A;out.push(mkSel(ev,fit,"team_totals",s,pt,t,pt===0.5&&s==='O'?`${tn} marque`:`${tn} ${s==='O'?'+':'-'}${String(pt).replace('.',',')} buts`,best,true));}
  }
  return out;
}

/* ---------- tickets ---------- */
function* combinations(arr,n,start=0,acc=[]){if(acc.length===n){yield acc;return;}for(let i=start;i<=arr.length-(n-acc.length);i++)yield* combinations(arr,n,i+1,[...acc,arr[i]]);}
const scoreOf=(cfg,odds,prob)=>cfg.classement==="chances"?prob:cfg.classement==="valeur"?odds*prob:odds*prob**1.5;
function ticketProb(legs,fitById){
  const byM={};for(const l of legs)(byM[l.match_id]=byM[l.match_id]||[]).push(l);
  let p=1,linked=false,indep=1;
  for(const [mid,ls] of Object.entries(byM)){
    const pi=prod(ls.map(l=>l.prob));indep*=pi;
    if(ls.length===1){p*=pi;continue;}
    const j=Model.joint(fitById[mid],ls);
    if(j>0.98*Math.min(...ls.map(l=>l.prob)))return null;   // redondant
    linked=true;p*=j;
  }
  return {prob:p,linked,indep};
}
function buildTickets(sel,fitById,cfg){
  const cand=sel.filter(s=>s.prob>=cfg.proba_min_par_selection&&(!cfg.valeur_mini||s.edge>=0));
  const sc=s=>scoreOf(cfg,s.price,s.prob);
  /* Présélection adaptée à la cote visée : pour n paris, la cote « typique » d'un pari
     est (cote cible)^(1/n). On garde, pour chaque n, les meilleurs paris proches de
     cette cote, puis on réunit le tout. Sans ça, avec beaucoup de matchs, il ne reste
     que des gros favoris et les profils à grosse cote ne trouvent plus rien. */
  const target=Math.sqrt(cfg.cote_totale_min*cfg.cote_totale_max);
  const perMatch=cfg.paris_lies?3:1,picked=new Map();
  for(let n=cfg.matchs_min_par_combi;n<=cfg.matchs_max_par_combi;n++){
    const t=target**(1/n);
    const ranked=[...cand].sort((a,b)=>sc(b)*Math.exp(-1.5*Math.abs(Math.log(b.price/t)))-sc(a)*Math.exp(-1.5*Math.abs(Math.log(a.price/t))));
    const cnt={};let k=0;
    for(const s of ranked){if(k>=Math.ceil(42/(cfg.matchs_max_par_combi-cfg.matchs_min_par_combi+1))+6)break;if((cnt[s.match_id]||0)>=perMatch)continue;cnt[s.match_id]=(cnt[s.match_id]||0)+1;picked.set(s.id,s);k++;}
  }
  /* + l'ancienne présélection telle quelle (les 42 meilleurs paris), pour ne rien perdre */
  const byM={};for(const s of [...cand].sort((a,b)=>sc(b)-sc(a)))(byM[s.match_id]=byM[s.match_id]||[]).push(s);
  for(const s of Object.values(byM).flatMap(ls=>ls.slice(0,perMatch)).sort((a,b)=>sc(b)-sc(a)).slice(0,42))picked.set(s.id,s);
  const pool=[...picked.values()].sort((a,b)=>sc(b)-sc(a)).slice(0,64);
  const out=[];let count=0;
  for(let n=cfg.matchs_min_par_combi;n<=cfg.matchs_max_par_combi;n++)for(const legs of combinations(pool,n)){
    if(++count>700000)break;
    const nM=new Set(legs.map(l=>l.match_id)).size;
    if(!cfg.paris_lies&&nM<n)continue;
    if(n-nM>1)continue;
    const odds=prod(legs.map(l=>l.price));if(odds<cfg.cote_totale_min||odds>cfg.cote_totale_max)continue;
    const tp=ticketProb(legs,fitById);if(!tp)continue;
    out.push({legs,odds,prob:tp.prob,linked:tp.linked,boost:tp.prob/tp.indep-1,ev:odds*tp.prob-1});
  }
  const stake=cfg.bankroll*cfg.mise_fixe_pct;
  return out.sort((a,b)=>scoreOf(cfg,b.odds,b.prob)-scoreOf(cfg,a.odds,a.prob)).slice(0,cfg.nombre_de_combis_affiches).map(t=>({...t,stake,gain:stake*t.odds}));
}
/* pipeline complet sur une liste de matchs */
function analyse(events,cfg,opts={}){
  const fitById={},sel=[];
  for(const e of events){const f=fitEvent(e,opts);if(!f)continue;fitById[e.id]=f;sel.push(...selectionsFor(e,f,cfg,opts.extras));}
  return {fitById,selections:sel,tickets:buildTickets(sel,fitById,cfg)};
}

return {BOOKS,LEAGUES,PRESETS,PKEYS,samePreset,DEFAULTS,SHARP,prod,norm,devig,canon,sim,findTeam,marketBooks,fairFromSharp,modelProbs,fitEvent,selectionsFor,buildTickets,ticketProb,scoreOf,analyse};
});
