const S=require('path').join(__dirname, '..', 'engines') + '/';
const E={P:require(S+'flightline-physics.js'),FB:require(S+'flightline-basket.js'),CT:require(S+'ddm-contact.js'),MATS:require(S+'ddm-materials.js')};
const W=require('../src/world.js'), PL=require('../src/play.js');
const lie={x:0,y:0};
for (const [di,tx,ty,air] of [[5,-4,120,0],[6,2,150,0],[4,0,90,0],[3,0,60,0]]) {
  const tz = air? 0 : W.G(tx,ty);
  let t0=Date.now(); const sol=PL.solveTo(E,lie,di,{x:tx,y:ty,z:tz,air:!!air});
  const ms=Date.now()-t0;
  const rec=PL.throwFrom(E,lie,sol,5);
  const land=rec.events.find(e=>e.type!=='release'); 
  console.log(PL.DISCS[di].name,'target',tx,ty,'mph',sol.armSpeed.toFixed(1),'aim',sol.aim.toFixed(1),'oor',sol.outOfReach,'ms',ms,'first touch',land&&land.type, land&&(land.x*0.3048).toFixed(1), land&&(land.y*0.3048).toFixed(1),'rest',rec.rest.x.toFixed(1),rec.rest.y.toFixed(1));
}
// putt from 10 m at the chains
const l2={x:W.BASKET.x-1,y:W.BASKET.y-10}; let made=0;
const sol=PL.solveTo(E,l2,0,{x:W.BASKET.x,y:W.BASKET.y,z:W.H(W.BASKET.x,W.BASKET.y)+1.08,air:true});
for(let i=0;i<10;i++){ const r=PL.throwFrom(E,l2,sol,100+i); if(r.made) made++; }
console.log('putt 33ft mph',sol.armSpeed.toFixed(1),'made',made,'/10');
