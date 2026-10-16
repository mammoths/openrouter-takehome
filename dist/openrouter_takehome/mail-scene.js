(function(){
'use strict';
const idle={phase:'idle',ids:[],deposited:0,elapsed:0};
const postFrames=[[121,90,332,449],[623,92,325,447],[1092,92,366,447],[56,613,444,344],[574,614,426,345],[1066,614,430,344]];
const meiliFrames=[[75,107,336,430],[541,138,474,400],[1087,108,376,430],[49,589,459,359],[561,594,439,354],[1060,593,460,356]];
function sprite(scene,atlas,src,u,v,height=82,mirror=false,z=0){
 if(!(atlas?.getContext?atlas.width>0:atlas?.complete&&atlas.naturalWidth))return;
 const [x,y]=scene.p(u,v,z),c=scene.ctx,ratio=scene.canvas.width/scene.width,w=height*src[2]/src[3];
 const left=Math.round((scene.ox+(x-w/2)*scene.scale)*ratio),top=Math.round((scene.oy+(y-height)*scene.scale)*ratio),ow=Math.round(w*scene.scale*ratio),oh=Math.round(height*scene.scale*ratio);
 c.save();c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;
 if(mirror){c.translate(left+ow,top);c.scale(-1,1);c.drawImage(atlas,...src,0,0,ow,oh);}else c.drawImage(atlas,...src,left,top,ow,oh);c.restore();
}
function load(scene,key,file){const im=new Image();scene[key]=im;im.onload=()=>{try{scene[key+'Cutout']=scene.pixelCutout(im);}catch{/* Some file-origin WebKit sessions deny pixel reads; retain the supplied alpha. */}scene.render();};im.src='assets/'+file;}
function bottle(scene,x,y,size=1,tilt=0){const c=scene.ctx;c.save();c.translate(x,y);c.rotate(tilt);c.scale(size,size);scene.poly([[-8,0],[8,0],[8,-23],[4,-28],[4,-34],[-4,-34],[-4,-28],[-8,-23]],'#dbe5ce','#6f8166',1.4);c.fillStyle='#fdf8e6';c.fillRect(-4,-22,8,17);c.fillStyle='#b85f48';c.fillRect(-2,-17,4,4);c.fillStyle='#b6946b';c.fillRect(-4,-37,8,5);c.fillStyle='#f9fcef';c.fillRect(-6,-22,2,12);c.restore();}
function tube(scene,points){for(const [color,width]of [['#94a28c',15],['#dce2d3',12],['#f5f5eb',7]]){const c=scene.ctx;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.lineCap='round';c.stroke();}}
class WritingRoomScene extends OfficeScene{
 constructor(...args){super(...args);this.layout.tray={u:2.6,v:1.1};load(this,'meiliAtlas','meili-mail-v1.png');load(this,'meiliReturnAtlas','meili-return-v1.png');load(this,'emptyDesk','meili-empty-desk-v1.png');}
 meiliDesk(){
  if(!this.state.meiliAway){super.meiliDesk();return;}
  const {u,v}=this.layout.desk,[x,y]=this.p(u,v),im=this.emptyDeskCutout||this.emptyDesk;
  if(im?.complete&&im.naturalWidth||im?.getContext){const c=this.ctx;c.save();c.imageSmoothingEnabled=false;c.drawImage(im,x-125,y-181,242,242);c.restore();}
  this.tagAt('desk',u,v,75,220,215,'Meili’s desk · the writing room');
 }
 validPlacement(key,pose){return super.validPlacement(key,pose)&&!!this.planWalk(this.deskSeat(),{u:pose.u-.3,v:pose.v+.55});}
 pickFurniture(point){return this.pointInHull(point,this.furnitureHull('chute'))?'chute':null;}
 motion(){return this.state.calm?idle:this.transit?.snapshot(performance.now())||idle;}
 render(){
  const m=this.motion();this.state.meiliAway=!!(m.carrying||m.depositing||m.returning);
  super.render();if(!this.width||!this.height)return;
  const {u:cu,v:cv}=this.layout.chute,a=this.p(cu,cv,51),out=this.p(cu,cv,-14);
  tube(this,[a,out]);this.tubePort=out;
  if(m.phase==='gathering'){for(let i=0;i<m.ids.length;i++){const f=(m.elapsed-i*5300-2700)/800;if(f>=0&&f<1)bottle(this,a[0],a[1]+(out[1]-a[1])*f*f,.5,0);}}
  this.box(cu-.35,cv-.30,.55,.65,33,'#d8ddc9','#acb79f');this.box(cu-.36,cv-.31,.59,.69,5,'#f3eddb','#93a085',33);
  const [ix,iy]=this.p(cu,cv,39);this.line([ix-12,iy],[ix+9,iy-5],'#65765c',5);
  this.tagAt('mail-chute',cu,cv,60,70,100,'Bottle chute · drafts for the Mail Room');
  if(this.arrange)this.poly(this.furnitureHull('chute'),null,this.blocked?'#be7758':'#6d805d',2);
  // The route follows the open aisle around the front of the writing desk.
  const route=t=>{
   const signature=JSON.stringify(this.layout);
   if(this.mailRouteSignature!==signature){this.mailRouteSignature=signature;this.mailRoute=this.planWalk(this.deskSeat(),{u:cu-.3,v:cv+.55})||[this.deskSeat()];}
   const pts=this.mailRoute,lengths=pts.slice(1).map((p,i)=>Math.hypot((p.u-pts[i].u)-(p.v-pts[i].v),((p.u-pts[i].u)+(p.v-pts[i].v))*.5));
   let distance=Math.max(0,Math.min(.99999,t))*lengths.reduce((a,b)=>a+b,0),i=0;
   while(i<lengths.length-1&&distance>lengths[i])distance-=lengths[i++];
   if(!lengths.length)return pts[0];const a=pts[i],b=pts[i+1],f=distance/lengths[i];
   return {u:a.u+(b.u-a.u)*f,v:a.v+(b.v-a.v)*f,facing:(b.u-a.u)-(b.v-a.v)<0?-1:1};
  };
  let p=route(0),frame=0,atlas=this.meiliAtlasCutout||this.meiliAtlas,mirror=false;
  if(m.carrying){p=route(m.local/2200);frame=3+Math.floor(m.local/180)%3;mirror=p.facing<0;}
  else if(m.depositing){p=route(1);frame=2;}
  else if(m.returning){p=route(1-(m.local-2700)/2200);frame=3+Math.floor(m.local/180)%3;atlas=this.meiliReturnAtlasCutout||this.meiliReturnAtlas;mirror=p.facing>0;}
  if(this.state.meiliAway)sprite(this,atlas,meiliFrames[frame],p.u,p.v,frame===0?82:77,mirror);
  if(m.depositing){const f=(m.local-2200)/500;const [x,y]=this.p(p.u,p.v,43);bottle(this,x+20+(a[0]-x-20)*f,y+(a[1]-y)*f,1-f*.5,-.25);}
  const target=this.state.meiliAway?p:this.layout.desk;this.tagAt('meili',target.u,target.v,this.state.meiliAway?45:103,92,100,m.carrying||m.depositing?'Meili · carrying a bottled draft to the chute':'Meili · at her writing desk');
  this.updateHotspots();
 }
}
class MailRoomScene extends OfficeScene{
 constructor(...args){super(...args);load(this,'postAtlas','post-corgi-v1.png');this.shelveAt=0;this.shelvedCount=null;}
 setState(state){if(Number.isFinite(state.leadCount)){if(this.shelvedCount!==null&&state.leadCount>this.shelvedCount)this.shelveAt=performance.now();this.shelvedCount=state.leadCount;}super.setState(state);}
 motion(){return this.state.calm?idle:this.transit?.snapshot(performance.now())||idle;}
 elevator(){super.elevator();}
 pickFurniture(point){return this.pointInHull(point,this.furnitureHull('receiver'))?'receiver':null;}
 footprint(key,pose=this.layout[key]){if(key!=='receiver')return super.footprint(key,pose);const corners=[[-.4,-.44],[.43,-.44],[.43,.48],[-.4,.48]].map(([u,v])=>({u:pose.u+u,v:pose.v+v}));return {corners,h:65,minU:pose.u-.4,maxU:pose.u+.43,minV:pose.v-.44,maxV:pose.v+.48};}
 validPlacement(key,p){if(key!=='receiver')return false;const f=this.footprint(key,p);return f.minU>.1&&f.maxU<7.9&&f.minV>.9&&f.maxV<5.8&&!(f.minU<6.95&&f.maxU>4.5&&f.minV<4.8&&f.maxV>3.1)&&!(f.minU<2.2&&f.minV<1.4);}

 board(){
  // Useful pigeonholes, not another status billboard.
  this.box(3.8,.1,3.2,.38,91,'#b5bba8','#8c9980',35);
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){
   const u=3.95+col*.75,z=42+row*27;
   this.plane(u,.5,u+.61,.5,z,z+21,'#7d8c70','#adb79f');
   const slot=row*4+col,count=Math.max(0,Math.floor(((this.state.leadCount||0)+11-slot)/12));
   for(let n=0;n<Math.min(3,count);n++){const [x,y]=this.p(u+.2+n*.14,.53,z+3);bottle(this,x,y,.34,-.04);}
   if(count>3){const [x,y]=this.p(u+.48,.54,z+12);this.ctx.fillStyle='#fff7df';this.ctx.font='9px monospace';this.ctx.fillText('+'+(count-3),x,y);}
  }
  this.wallText('DRAFTS',4.6,.53,133,'right',12,'#718363');
  this.tagAt('mail-cabinet',5.3,.5,85,204,140,'Mail cabinet · '+this.state.leadCount+' unsent drafts');
 }
 render(){
  if(!this.width||!this.height)return;
  this.turn=this.state.workOpen&&!this.state.calm?Math.sin(this.time/46*Math.PI*2)*.07:0;
  const c=this.ctx,rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.canvas.width,this.canvas.height);c.setTransform(rx*this.scale,0,0,ry*this.scale,rx*this.ox,ry*this.oy);this.regions={};this.room();
  const m=this.motion(),receiver=this.layout.receiver||{u:6.9,v:1.55},cu=receiver.u,cv=receiver.v;
  const entrance=this.p(cu,.035,161),elbow=this.p(cu,cv-.20,161),end=this.p(cu,cv-.20,39),pipePoints=[entrance,elbow,end];
  // A mounted inlet above the cabinet feeds a continuous tube into the open bin.
  this.plane(cu-.24,.025,cu+.24,.025,147,172,'#e9e8d7','#8a9a79');
  for(const du of [-.16,.16])for(const z of [151,168]){const [x,y]=this.p(cu+du,.035,z);c.fillStyle='#8a9a79';c.fillRect(x-1,y-1,2,2);}
  this.box(cu-.40,cv-.44,.83,.92,9,'#8d9c80','#9cab8e');
  this.box(cu-.40,cv-.44,.83,.10,31,'#e9e8d7','#a9b69a',9);
  this.box(cu-.40,cv-.34,.10,.82,31,'#e9e8d7','#a9b69a',9);
  this.poly([this.p(cu-.29,cv-.33,10),this.p(cu+.32,cv-.33,10),this.p(cu+.32,cv+.37,10),this.p(cu-.29,cv+.37,10)],'#718269','#8a9a79',1);
  tube(this,pipePoints);this.tubePort=entrance;
  for(const z of [149,44]){const [x,y]=this.p(cu,cv-.20,z);this.line([x-8,y],[x+8,y],'#71856c',4);this.line([x-7,y-2],[x+7,y-2],'#c8d2bd',2);}
  // The outlet meets a recessed receiving slot instead of hovering above a lid.
  const [ex,ey]=end;this.poly([[ex-8,ey-2],[ex+8,ey-2],[ex+8,ey+3],[ex-8,ey+3]],'#718269','#94a28c',1);
  if(m.phase==='pulse'&&m.pulse>.68){
   const lengths=pipePoints.slice(1).map((p,i)=>Math.hypot(p[0]-pipePoints[i][0],p[1]-pipePoints[i][1])),total=lengths.reduce((sum,n)=>sum+n,0),f=(m.pulse-.68)/.32;
   for(let i=0;i<m.ids.length;i++){const progress=f-i*.1;if(progress<0||progress>1)continue;let distance=progress*total,segment=0;while(segment<lengths.length-1&&distance>lengths[segment])distance-=lengths[segment++];const a=pipePoints[segment],b=pipePoints[segment+1],t=distance/lengths[segment];bottle(this,a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.38,segment?0:Math.atan2(b[1]-a[1],b[0]-a[0])+Math.PI/2);}
  }
  if(m.phase==='arrived'||m.phase==='idle'&&this.state.pendingCount){const [bx,by]=this.p(cu-.12,cv+.10,20);bottle(this,bx,by,.42,Math.PI/2);}
  // Near walls occlude delivered mail, keeping it visibly inside the receiver.
  this.box(cu+.33,cv-.34,.10,.82,31,'#e9e8d7','#9cab8e',9);
  this.box(cu-.40,cv+.38,.83,.10,31,'#e9e8d7','#9cab8e',9);
  this.plane(cu-.22,cv+.49,cu+.16,cv+.49,17,24,'#e9e8d7','#8a9a79');
  this.tagAt('mail-receiver',cu,cv,50,78,90,'Receiving chute · review drafted mail');
  const sentAge=(Date.now()-(this.state.sentAt||0))/1000;if(sentAge>=0&&sentAge<2.5){const [sx,sy]=this.p(5.7,4,55);bottle(this,sx,sy-sentAge*65,Math.max(.08,1-sentAge/2.5),sentAge*.3);}
  // One low sorting table, a lamp, and an empty outbox. No invented sent letters.
  for(const [u,v]of [[4.8,3.5],[6.6,3.5],[4.8,4.4],[6.6,4.4]])this.box(u,v,.1,.1,40,'#9ca78e','#87957b');
  this.box(4.65,3.35,2.2,1.25,6,'#d5be96','#afa17e',40);
  this.box(5.6,3.5,.95,.6,6,'#95a786','#788c6b',46);
  this.wallText('REVIEW',5.7,4.61,28,'right',9,'#748668');
  const [lx,ly]=this.p(5,3.7,46);this.line([lx,ly],[lx,ly-35],'#75846b',3);this.poly([[lx-13,ly-27],[lx-7,ly-40],[lx+8,ly-40],[lx+16,ly-27]],'#eee6d0','#9ea48d');
  this.tagAt('mail-desk',5.7,4,65,170,100,'Review desk · unsent drafts');
  const active=m.phase!=='idle',walkIn=active&&m.elapsed<2200,walkOut=m.phase==='arrived'&&m.elapsed>m.release+1900;
  const t=walkIn?m.elapsed/2200:walkOut?Math.max(0,1-(m.elapsed-m.release-1900)/1600):active?1:0;
  let u=5.3+(Math.min(7.6,cu+.4)-5.3)*t,v=5.05+(Math.min(5.7,cv+1)-5.05)*t;
  let frame=walkIn||walkOut?3+Math.floor(this.time*5)%3:active?1+(Math.floor(this.time*1.2)%2):0;
  const delivery=this.productionDelivery?.snapshot(performance.now())||{phase:'idle'};
  let deliveryMirror=false;
  const walking=['mail','mail-return'].includes(delivery.phase);if(walking){const f=delivery.phase==='mail'?delivery.f:1-delivery.f;const pts=[{u:5.3,v:5.05},{u:3.6,v:5.05},{u:2.8,v:2.0},{u:1.43,v:.65}],n=Math.min(2,Math.floor(f*3)),q=f*3-n;u=pts[n].u+(pts[n+1].u-pts[n].u)*q;v=pts[n].v+(pts[n+1].v-pts[n].v)*q;const screenDx=(pts[n+1].u-pts[n].u)-(pts[n+1].v-pts[n].v);const forwardLeft=screenDx<-.05;deliveryMirror=delivery.phase==='mail'?forwardLeft:!forwardLeft;frame=3+Math.floor(this.time*5)%3;}
  const shelfAge=(performance.now()-this.shelveAt)/1000,shelving=this.shelveAt>0&&shelfAge<4.8&&!this.state.calm&&delivery.phase==='idle';
  if(shelving){const f=shelfAge<2.4?shelfAge/2.4:1-(shelfAge-2.4)/2.4;u=5.3+(5.2-5.3)*f;v=5.05+(.95-5.05)*f;frame=3+Math.floor(this.time*5)%3;const [x,y]=this.p(u,v,34);bottle(this,x+14,y,.6,-.12);}
  if(delivery.phase==='idle'||walking)sprite(this,this.postAtlasCutout||this.postAtlas,postFrames[frame],u,v,frame<3?86:69,walking?deliveryMirror:walkIn);
  if(walkOut&&!walking){const [px,py]=this.p(u,v,34);bottle(this,px+14,py,.6,-.12);}
  this.tagAt('elevator',1.43,0,64,64,120,'Elevator · Production Labs');
  if(this.arrange)this.poly(this.furnitureHull('receiver'),null,this.blocked?'#be7758':'#6d805d',2);
  this.tagAt('post-corgi',u,v,45,96,105,active?'Post-corgi · waiting for Meili’s bottled mail':'Post-corgi · on standby');
  this.updateHotspots();
 }
}
window.WritingRoomScene=WritingRoomScene;window.MailRoomScene=MailRoomScene;
})();
