const S=require('path').join(__dirname, '..', 'engines') + '/';
const E={P:require(S+'flightline-physics.js'),FB:require(S+'flightline-basket.js'),CT:require(S+'ddm-contact.js'),MATS:require(S+'ddm-materials.js')};
const HW=require('../src/holeworld.js'), PL=require('../src/play.js');
for (let seed=1; seed<=8; seed++) {
  const d=HW.randomHole('tunnel', seed*977); const W=HW.world(d); PL.setWorld(W);
  const lie=d.tee, b=d.basket, dist=Math.hypot(b.x-lie.x,b.y-lie.y);
  const sol=PL.solveTo(E,lie,PL.discForDist(dist),{x:b.x,y:b.y,z:W.H(b.x,b.y)+1.08,air:true});
  const rec=PL.throwFrom(E,lie,sol,3); let peak=0; rec.samples.forEach(s=>peak=Math.max(peak,s.z*0.3048));
  const o=d.objs.find(o=>o.k==='path');
  console.log(seed,'ft',Math.round(dist/0.3048),'mph',Math.round(sol.armSpeed),'peak m',peak.toFixed(1),'went',Math.round(Math.hypot(rec.rest.x-lie.x,rec.rest.y-lie.y)/0.3048),'ft',PL.readThrow(rec,E).join(','),'| path',o.w,o.clear);
}
