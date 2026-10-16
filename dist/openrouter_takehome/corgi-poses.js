(function(root) {
 'use strict';
 // Directions describe the office floor, not a CSS rotation of a flat sprite.
 const directions = {
  SE:{forward:[1,0],across:[0,1]}, SW:{forward:[0,1],across:[-1,0]},
  NW:{forward:[-1,0],across:[0,-1]}, NE:{forward:[0,-1],across:[1,0]}
 };
 const desk = {
  direction:'SE', seat:{forward:-1.16,across:0},
  contact:{forward:-.18,across:0,z:54},
  actor:{
   source:'assets/pip-desk-se-v3.png', direction:'SE',
   frames:[[228,79,500,566],[854,79,500,566],[1488,79,500,566]],
   sequence:[0,1,0,2], fps:5, scale:.18,
   // A common point between the two resting paws, registered across complete poses.
   contact:[352,520],
   // Only the rear hip is hidden. Head, shoulders, both forelegs and paws form one image.
   visible:[[0,0],[500,0],[500,566],[285,566],[205,493],[125,430],[112,365],[0,335]]
  }
 };
 function world(origin,forward,across=0,direction='SE') {
  const d=directions[direction];
  return {u:origin.u+forward*d.forward[0]+across*d.across[0],v:origin.v+forward*d.forward[1]+across*d.across[1]};
 }
 function deskFrame({busy=false,calm=false,time=0}={}) {
  const a=desk.actor;
  return a.frames[busy&&!calm?a.sequence[Math.floor(Math.max(0,time)*a.fps)%a.sequence.length]:0];
 }
 const chalk={source:'assets/pip-chalk-back-v2.png',frames:[[110,65,420,600],[653,65,420,600],[1196,65,420,600],[1739,65,420,600]],sequence:[0,1,2,1,0,3],fps:5,scale:.18,feet:[160,588],chalkTips:[[380,275],[372,140],[398,261],[341,287]]};
 function chalkFrame({time=0,calm=false}={}){return chalk.frames[calm?0:chalk.sequence[Math.floor(Math.max(0,time)*chalk.fps)%chalk.sequence.length]];}
 const deskBack={source:'assets/pip-desk-back-v1.png',frames:[[222,65,480,580],[866,65,480,580],[1533,65,480,580]],sequence:[0,1,0,2],fps:5,scale:.18,contact:[88,345]};
 const chalkFront={source:'assets/pip-chalk-v1.png',frames:[[72,65,440,600],[588,65,440,600],[1120,65,440,600],[1670,65,440,600]],sequence:[0,1,2,1,0,3],fps:5,scale:.18,feet:[188,595],chalkTips:[[380,300],[374,170],[398,268],[347,310]]};
 function rotateOffset(origin,u,v){const a=(origin.rotation||0)*Math.PI/2;return {u:origin.u+u*Math.cos(a)-v*Math.sin(a),v:origin.v+u*Math.sin(a)+v*Math.cos(a)};}
 const owl={
  desk:{source:'assets/owl-desk-v1.png',frames:[[80,90,400,430],[565,90,400,430],[1076,90,400,430]],sequence:[0,1,0,2],fps:5,scale:.22,contact:[270,388],visible:[[0,0],[400,0],[400,395],[215,395],[150,350],[100,310],[0,310]]},
  back:{source:'assets/owl-desk-v1.png',frames:[[72,550,410,410],[584,550,410,410],[1096,550,410,410]],sequence:[0,1,0,2],fps:5,scale:.22,contact:[95,308]},
  actions:{source:'assets/owl-actions-v1.png',walk:[[40,35,360,410],[494,35,360,410],[944,35,360,410],[1408,35,360,410]],rest:[[60,474,320,376],[520,474,320,376]],chalk:[[932,465,400,390],[1370,465,400,390]]}
 };
 const review={source:'assets/pip-review-v1.png',front:{frames:[[100,80,400,440],[573,80,400,440],[1047,80,400,440]],sequence:[0,1,0,1,2,2],fps:2,scale:.24,contact:[255,370],visible:[[0,0],[400,0],[400,440],[210,440],[170,370],[80,310],[70,240],[0,220]]},back:{frames:[[90,550,420,410],[600,550,420,410],[1079,550,420,410]],sequence:[0,1,0,1,2,2],fps:2,scale:.25,contact:[112,274]}};
 const api={review,owl,directions,desk,deskBack,chalk,chalkFront,rotateOffset,world,deskFrame,chalkFrame};
 if(typeof module!=='undefined')module.exports=api;else root.CorgiPoses=api;
})(typeof window!=='undefined'?window:globalThis);
