const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT='/home/user/Baseball-GM-Classic';
const files=['js/data/constants.js','js/data/name_pools.js','js/data/intl_name_pools.js','js/data/city_pools.js','js/data/teams.js','js/util/rng.js','js/util/dates.js','js/generation/ballparks.js','js/generation/league.js','js/generation/players.js','js/engine/schedule.js','js/engine/stats.js','js/engine/injuries.js','js/engine/fatigue.js','js/engine/roster.js','js/engine/progression.js','js/engine/minors.js','js/engine/flavorleagues.js','js/engine/trades.js','js/engine/freeagency.js','js/engine/waivers.js','js/engine/staff.js','js/engine/scouting.js','js/engine/draft.js','js/engine/intl.js','js/engine/rule5.js','js/engine/awards.js','js/engine/simulation.js','js/engine/standings.js','js/engine/offseason.js'];
const sandbox={window:{},console,Math,JSON,Array,Object,Date};vm.createContext(sandbox);
for(const f of files)vm.runInContext(fs.readFileSync(path.join(ROOT,f),'utf8'),sandbox,{filename:f});
const W=sandbox.window, C=W.BBGM_CONSTANTS;
const HIT=['contactVsR','contactVsL','powerVsR','powerVsL','discipline','defense','arm'], PIT=['velocity','movement','control','stuff'];
const avg=(a)=>(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1);
function report(label, list){
  for(const side of [false,true]){
    const ks=side?PIT:HIT; const g=list.filter(p=>p.isPitcher===side);
    const mean=g.map(p=>ks.reduce((a,k)=>a+(p.hidden.ceiling[k]||0),0)/ks.length);
    const best=g.map(p=>Math.max(...ks.map(k=>p.hidden.ceiling[k]||0)));
    const cur=g.map(p=>W.BBGM_ROSTER.overall(p));
    const ceilOvr=g.map(p=>{ const q=JSON.parse(JSON.stringify(p)); for(const k of ks) q.ratings[k]=p.hidden.ceiling[k]; if(!side){q.ratings.speed=p.hidden.ceiling.speed||p.ratings.speed;} return W.BBGM_ROSTER.overall(q); });
    console.log(`${label} ${side?'pitchers':'hitters '} n=${g.length}: meanCeil ${avg(mean)} bestCeil ${avg(best)} | OVR-at-ceiling ${avg(ceilOvr)} | current OVR ${avg(cur)}`);
  }
}
// genesis
const rng=W.BBGM_RNG.makeRng(777); const league=W.BBGM_LEAGUE_GEN.generate(rng); const players=W.BBGM_PLAYER_GEN.generate(rng,league);
const gen=Object.values(players).filter(p=>!p.retired);
report('GENESIS all      ', gen);
report('GENESIS 26-man   ', gen.filter(p=>p.rosterStatus==='26-man'));
report('GENESIS minors   ', gen.filter(p=>p.status==='minors'));
// draft classes x3
const state={meta:{seed:777,userTeamId:league.teams[0].id,currentDate:{year:2026,month:5,day:1}},league,players,news:[],freeAgents:[],history:{seasons:[]}};
W.BBGM_STAFF.ensureStaff(state); W.BBGM_SCOUT.ensureTiers(state);
let dc=[]; for(let i=0;i<3;i++){ W.BBGM_DRAFT.generateClass(state); dc=dc.concat(Object.values(state.draft.prospects)); state.draft=null; }
report('DRAFT class x3   ', dc);
report('DRAFT top-100    ', dc.slice(0,100));
let ic=[]; for(let i=0;i<3;i++){ W.BBGM_INTL.generateClass(state,2027+i); ic=ic.concat(Object.values(state.intl.prospects)); }
report('INTL class x3    ', ic);
