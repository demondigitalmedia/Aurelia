const S=require('path').join(__dirname, '..', 'engines') + '/';
const E={P:require(S+'flightline-physics.js'),FB:require(S+'flightline-basket.js'),CT:require(S+'ddm-contact.js'),MATS:require(S+'ddm-materials.js')};
const HW=require('../src/holeworld.js'), PL=require('../src/play.js');
for (const A of HW.ARCHETYPES) {
  const d=HW.randomHole(A.id, 1234); const enc=HW.encode(d), kb=JSON.stringify(enc).length/1024; const d2=HW.decode(enc);
  const W=HW.world(d2); PL.setWorld(W); const w=PL.world();
  const lie=d2.tee, b=d2.basket, dist=Math.hypot(b.x-lie.x,b.y-lie.y);
  const tgt={x: lie.x+(b.x-lie.x)*0.6, y: lie.y+(b.y-lie.y)*0.6}; tgt.z=W.G(tgt.x,tgt.y);
  const sol=PL.solveTo(E,lie,PL.discForDist(dist),tgt); const rec=PL.throwFrom(E,lie,sol,3);
  const types={}; d2.trees.forEach(t=>types[HW.TYPES[t[0]]]=(types[HW.TYPES[t[0]]]||0)+1);
  console.log(A.id.padEnd(9),'par',d2.par,'ft',Math.round(dist/0.3048),'drop',Math.round((W.TEE_Z-W.H(b.x,b.y))/0.3048),'kb',kb.toFixed(0),'trees',d2.trees.length,JSON.stringify(types),'objs',d2.objs.map(o=>o.k).join(','),'| throw',Math.round(Math.hypot(rec.rest.x-lie.x,rec.rest.y-lie.y)/0.3048),'ft',PL.readThrow(rec,E).join(','));
}
