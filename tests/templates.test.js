const S=require('path').join(__dirname, '..', 'engines') + '/';
const E={P:require(S+'flightline-physics.js'),FB:require(S+'flightline-basket.js'),CT:require(S+'ddm-contact.js'),MATS:require(S+'ddm-materials.js')};
const HW=require('../src/holeworld.js'), PL=require('../src/play.js');
for (const t of HW.TEMPLATES) {
  let t0=Date.now(); const d=HW.fromTemplate(t.id); const gen=Date.now()-t0;
  const enc=HW.encode(d), size=JSON.stringify(enc).length; const d2=HW.decode(enc);
  t0=Date.now(); const W=HW.world(d2); PL.setWorld(W); const w=PL.world(); const wt=Date.now()-t0;
  const lie=d2.tee, b=d2.basket, dist=Math.hypot(b.x-lie.x,b.y-lie.y);
  const di=PL.discForDist(dist);
  const tgt={x: lie.x+(b.x-lie.x)*0.55, y: lie.y+(b.y-lie.y)*0.55}; tgt.z=W.G(tgt.x,tgt.y);
  t0=Date.now(); const sol=PL.solveTo(E,lie,di,tgt); const rec=PL.throwFrom(E,lie,sol,3); const tt=Date.now()-t0;
  console.log(t.id,'gen',gen,'ms trees',d.trees.length,'objs',d.objs.length,'docKB',(size/1024).toFixed(0),'world',wt,'ms solids',w.solids.length,'| throw',(Math.hypot(rec.rest.x-lie.x,rec.rest.y-lie.y)/0.3048).toFixed(0),'ft surf',W.surfaceAt(rec.rest.x,rec.rest.y),'tags',PL.readThrow(rec,E).join(','),tt,'ms par',HW.suggestPar(d2),'teeZ',W.TEE_Z.toFixed(1),'bz',W.H(b.x,b.y).toFixed(1));
}
