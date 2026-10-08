export const RANKS = [
  {name:'Recruit', tag:'R1', xp:0}, {name:'Private',tag:'R2',xp:250}, {name:'Private II',tag:'R3',xp:600},
  {name:'Corporal',tag:'R4',xp:1100}, {name:'Sergeant',tag:'R5',xp:1800}, {name:'Sergeant II',tag:'R6',xp:2800},
  {name:'Lieutenant',tag:'R7',xp:4200}, {name:'Captain',tag:'R8',xp:6200}, {name:'Major',tag:'R9',xp:9000},
  {name:'Colonel',tag:'R10',xp:12500}, {name:'General',tag:'R11',xp:17000}, {name:'Elite',tag:'R12',xp:23000}
];
export const rankForXp = (xp=0) => { let r=RANKS[0]; for(const x of RANKS) if(Number(xp)>=x.xp) r=x; else break; return r; };
export const rankIndex = (xp=0) => Math.max(0, RANKS.findIndex(x => x === rankForXp(xp)));
