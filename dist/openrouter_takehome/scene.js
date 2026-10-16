(function(){
'use strict';
const P=window.CorgiPoses;
const C={ink:'#343b32',edge:'#747b69',wall:'#e5e4de',wall2:'#efeee8',floor:'#f4f0e4',line:'#d4d7c8',wood:'#d5be96',woodEdge:'#afa17e',paper:'#fffced',sage:'#a8b49b',orange:'#d98742',grey:'#9ca292'};
class OfficeScene {
 constructor(canvas,hotspots,onSelect,onLayout,options={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.hotspots=hotspots;this.onSelect=onSelect;this.onLayout=onLayout;this.state={busy:false,leadCount:0,calm:false,mode:'idle'};this.time=0;this.arrange=false;this.hover=null;this.last=0;
  this.floor=options.floor||'sourcing';this.hintId=options.hintId||'objectHint';this.away=false;this.visible=true;this.turn=0;this.typingPreviewUntil=0;
  this.layout=MeiliDomain.makeState().layout;this.layout.board ||= {u:1.4,v:2.7};this.selectedFurniture=null;
  this.atlas=new Image();this.atlas.src='assets/pip-atlas.png';this.atlas.onload=()=>this.render();
  this.deskBackAtlas=new Image();this.deskBackAtlas.src=P.deskBack.source;this.deskBackAtlas.onload=()=>this.render();
  this.chalkFrontAtlas=new Image();this.chalkFrontAtlas.src=P.chalkFront.source;this.chalkFrontAtlas.onload=()=>this.render();
  this.chalkAtlas=new Image();this.chalkAtlas.src=P.chalk.source;this.chalkAtlas.onload=()=>this.render();
  this.walkAtlas=new Image();this.walkAtlas.src='assets/pip-walk-v2.png';this.walkAtlas.onload=()=>this.render();
  this.walkFrames=[[35,102,480,354],[537,102,480,354],[1044,102,480,354],[36,572,480,354],[537,573,480,354],[1044,573,480,354]];
  this.reviewAtlas=new Image();this.reviewAtlas.onload=()=>{this.reviewCutout=this.pixelCutout(this.reviewAtlas);this.render();};this.reviewAtlas.src=P.review.source;
  this.deskAtlas=new Image();this.deskAtlas.onload=()=>this.render();this.deskAtlas.src=P.desk.actor.source;
  this.thoughtAtlas=new Image();this.thoughtAtlas.onload=()=>{this.thoughtCutout=this.pixelCutout(this.thoughtAtlas);this.render();};this.thoughtAtlas.src='assets/delivery-thought-v1.png';
  this.meiliFrames=Array.from({length:4},(_,i)=>{const image=new Image();image.onload=()=>this.render();image.src=`assets/meili-writing-${i}.png`;return image;});
  this.actor='pip';this.owlRuntime={tour:null,away:false,typingPreviewUntil:0};
  this.owlDeskAtlas=new Image();this.owlDeskAtlas.onload=()=>{this.owlDeskCutout=this.pixelCutout(this.owlDeskAtlas);this.render();};this.owlDeskAtlas.src=P.owl.desk.source;
  this.owlActionAtlas=new Image();this.owlActionAtlas.onload=()=>{this.owlActionCutout=this.pixelCutout(this.owlActionAtlas);this.render();};this.owlActionAtlas.src=P.owl.actions.source;
  this.owlIdleAtlas=new Image();this.owlIdleAtlas.onload=()=>{this.owlIdleCutout=this.pixelCutout(this.owlIdleAtlas);this.render();};this.owlIdleAtlas.src='assets/owl-idle-v1.png';
  this.frames={idle:[134,114,400,544],type:[718,114,400,544],walk:[71,714,585,441],rest:[696,775,522,363]};
  this.regions={};this.buttons={};this.tour=null;this.drawingTrip=null;this.lastDrawingStamp=0;
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);
  canvas.addEventListener('pointerdown',e=>this.pointerDown(e));canvas.addEventListener('pointermove',e=>this.pointerMove(e));canvas.addEventListener('pointerup',e=>this.pointerUp(e));canvas.addEventListener('pointercancel',()=>{if(this.drag){this.layout[this.drag.key]=this.drag.start;this.drag=null;this.render();}});
  document.addEventListener('keydown',e=>{if(this.arrange&&e.key?.toLowerCase()==='r'&&!['INPUT','TEXTAREA'].includes(e.target?.tagName)){e.preventDefault();this.rotateSelected(e.shiftKey?-1:1);}});
  document.addEventListener('visibilitychange',()=>this.last=0);
  this.visibilityObserver=new IntersectionObserver(entries=>{this.visible=entries[0].isIntersecting;});this.visibilityObserver.observe(canvas);
  const loop=t=>{requestAnimationFrame(loop);if(document.hidden||(!this.visible&&!this.tour&&!this.owlRuntime.tour))return;if(t-this.last<(this.state.calm&&!this.tour?1000:this.tour?32:65))return;this.last=t;this.time=this.state.calm?0:t/1000;if(this.pixelRatio!==(window.devicePixelRatio||1))this.resize();else this.render();};requestAnimationFrame(loop);
 }
 pixelCutout(image){const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d');x.drawImage(image,0,0);const pixels=x.getImageData(0,0,c.width,c.height);for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=pixels.data[i]>=220?255:0;x.putImageData(pixels,0,0);return c;}
 forWorker(actor,fn){
  if(actor!=='owl'||this.actor==='owl')return fn();
  const previous={actor:this.actor,layout:this.layout,state:this.state,tour:this.tour,away:this.away,typingPreviewUntil:this.typingPreviewUntil,drawingTrip:this.drawingTrip,lastDrawingStamp:this.lastDrawingStamp};
  this.actor='owl';this.layout={...previous.layout,desk:previous.layout.owlDesk,owlDesk:previous.layout.desk};
  this.tour=this.owlRuntime.tour;this.away=this.owlRuntime.away;this.typingPreviewUntil=this.owlRuntime.typingPreviewUntil;this.drawingTrip=null;this.lastDrawingStamp=0;
  this.state={...previous.state,busy:!!previous.state.owlBusy,work:previous.state.owlWork,resting:!previous.state.owlBusy&&performance.now()>=this.typingPreviewUntil,boardAt:0};
  try{return fn();}finally{this.owlRuntime={tour:this.tour,away:this.away,typingPreviewUntil:this.typingPreviewUntil};Object.assign(this,previous);}
 }
 owlDesk(){this.forWorker('owl',()=>this.desk());}
 workerAtHome(){return !this.state.busy&&!this.tour&&!this.away&&performance.now()>=this.typingPreviewUntil;}
 owlAtHome(){return !this.state.owlBusy&&!this.owlRuntime.tour&&!this.owlRuntime.away&&performance.now()>=this.owlRuntime.typingPreviewUntil;}
 owlSprite(u,v,kind='walk',pose={},z=0){
  if(!this.owlActionAtlas.complete||!this.owlActionAtlas.naturalWidth||(kind==='alert'&&!this.owlIdleAtlas.naturalWidth))return;
  const atlas=kind==='alert'?(this.owlIdleCutout||this.owlIdleAtlas):(this.owlActionCutout||this.owlActionAtlas),frames=kind==='alert'?[[242,242,725,923]]:P.owl.actions[kind],index=kind==='alert'?0:this.state.calm?0:kind==='walk'?Math.floor((pose.distance||0)/8)%frames.length:Math.floor(this.time/2)%frames.length,src=frames[index],height=['rest','alert'].includes(kind)?62:72,width=height*src[2]/src[3],[x,y]=this.p(u,v,z),c=this.ctx,rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;
  const bob=this.state.calm||kind!=='walk'?0:Math.sin((pose.distance||0)/32*Math.PI*2)*1.2,left=Math.round((this.ox+(x-width/2)*this.scale)*rx),top=Math.round((this.oy+(y-height+bob)*this.scale)*ry),w=Math.round(width*this.scale*rx),h=Math.round(height*this.scale*ry);
  c.save();c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;if(kind==='walk'&&pose.facing<0){c.translate(left+w,top);c.scale(-1,1);c.drawImage(atlas,...src,0,0,w,h);}else c.drawImage(atlas,...src,left,top,w,h);c.restore();this.spriteHotspot('owl',left,top,w,h);
 }
 spriteHotspot(actor,left,top,width,height){
  if(this.floor!=='sourcing')return;
  const rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;
  this.regions['visitor-'+actor]={x:(left/rx-this.ox)/this.scale,y:(top/ry-this.oy)/this.scale,w:width/rx/this.scale,h:height/ry/this.scale,label:'Get in touch with '+(actor==='owl'?'Owl':'Pip')};
 }
 resize(){
  const r=this.canvas.getBoundingClientRect();this.width=r.width;this.height=r.height;this.pixelRatio=window.devicePixelRatio||1;
  // Pixel art belongs in the sprite, not in a low-resolution buffer stretched across a Retina display.
  const width=Math.max(1,Math.round(r.width*this.pixelRatio)),height=Math.max(1,Math.round(r.height*this.pixelRatio));
  if(this.canvas.width!==width)this.canvas.width=width;
  if(this.canvas.height!==height)this.canvas.height=height;
  this.canvas.style.imageRendering='auto';this.scale=Math.min(r.width/1040,r.height/665);this.ox=(r.width-1040*this.scale)/2;this.oy=(r.height-665*this.scale)/2+10;this.render();
 }
 setState(state){this.state={...this.state,...state};if(state.layout)this.layout=state.layout;this.render();}
 p(u,v,z=0){if(this.objectTransform){const t=this.objectTransform,a=(t.rotation||0)*Math.PI/2,du=u-t.u,dv=v-t.v;u=t.u+du*Math.cos(a)-dv*Math.sin(a);v=t.v+du*Math.sin(a)+dv*Math.cos(a);}const co=Math.cos(this.turn),si=Math.sin(this.turn);return [554+((u-4)*(co+si)-(v-3)*(co-si))*54,408+((u-4)*(co-si)+(v-3)*(co+si))*27-z];}
 poly(pts,fill,stroke=C.edge,width=1.6){const c=this.ctx;c.beginPath();pts.forEach((p,i)=>i?c.lineTo(Math.round(p[0]),Math.round(p[1])):c.moveTo(Math.round(p[0]),Math.round(p[1])));c.closePath();if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.lineJoin='miter';c.stroke()}}
 line(a,b,color=C.edge,width=1.5){const c=this.ctx;c.beginPath();c.moveTo(...a);c.lineTo(...b);c.strokeStyle=color;c.lineWidth=width;c.stroke()}
 box(u,v,w,d,h,top=C.paper,side=C.woodEdge,z=0){
  const p=(a,b,c)=>this.p(a,b,c);
  if(this.objectTransform?.rotation){
   const faces=[[[u,v],[u+w,v]],[[u+w,v],[u+w,v+d]],[[u+w,v+d],[u,v+d]],[[u,v+d],[u,v]]].sort((a,b)=>a.reduce((n,q)=>n+p(...q,0)[1],0)-b.reduce((n,q)=>n+p(...q,0)[1],0));
   for(const [a,b]of faces)this.poly([p(...a,z),p(...b,z),p(...b,z+h),p(...a,z+h)],side);
  }else{this.poly([p(u,v+d,z),p(u+w,v+d,z),p(u+w,v+d,z+h),p(u,v+d,z+h)],side);this.poly([p(u+w,v,z),p(u+w,v+d,z),p(u+w,v+d,z+h),p(u+w,v,z+h)],side);}
  this.poly([p(u,v,z+h),p(u+w,v,z+h),p(u+w,v+d,z+h),p(u,v+d,z+h)],top);
 }
 plane(u1,v1,u2,v2,z1,z2,fill,stroke=C.edge){this.poly([this.p(u1,v1,z1),this.p(u2,v2,z1),this.p(u2,v2,z2),this.p(u1,v1,z2)],fill,stroke);}
 text(text,x,y,size=12,color=C.ink,font='monospace',align='left'){const c=this.ctx;c.fillStyle=color;c.font=`${size}px ${font}`;c.textAlign=align;c.fillText(text,x,y);}
 tagAt(id,u,v,z,w,h,label){const [x,y]=this.p(u,v,z);this.regions[id]={x,y,w,h,label};}
 wallText(text,u,v,z,side='right',size=12,color=C.ink){const [x,y]=this.p(u,v,z),c=this.ctx;c.save();c.translate(x,y);c.transform(1,side==='right'?.5:-.5,0,1,0,0);this.text(text,0,0,size,color);c.restore();}
 window(){
  this.plane(0,.65,0,3.6,68,151,'#aeb9b5');this.plane(0,.78,0,3.47,77,143,'#dce2dc');
  const c=this.ctx;c.save();const pts=[this.p(0,.78,77),this.p(0,3.47,77),this.p(0,3.47,143),this.p(0,.78,143)];c.beginPath();pts.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.clip();
  for(let i=0;i<9;i++){const v=.85+i*.32;const h=[26,47,36,53,30,42,62,39,26][i];this.plane(0,v,0,v+.24,77,77+h,i%2?'#c1cbc3':'#b5c1b7',null);if(i===4){this.line(this.p(0,v+.1,119),this.p(0,v+.1,135),'#b5c1b7',3)}}c.restore();
  this.line(this.p(0,2.1,75),this.p(0,2.1,145),'#8b9685',5);this.line(this.p(0,.7,73),this.p(0,3.6,73),C.paper,6);
  this.box(0, .57,.14,3.1,5,C.paper,'#b9c0b0',65);
 }
 updateDrawing(){
  const stamp=Number(this.state.boardAt)||0,age=(Date.now()-stamp)/1000;
  if(stamp!==this.lastDrawingStamp){const departure=this.currentWalkingPosition();this.lastDrawingStamp=stamp;this.drawingTrip=null;if(stamp&&age>=0&&age<45&&!this.state.calm&&!this.tour&&!this.away){this.drawingTrip=this.makeTour(departure,this.drawingStation(),{roundTrip:true,hold:8,fromResolver:()=>this.deskSeat(),toResolver:()=>this.drawingStation()});this.drawingTrip.legStart-=age;this.drawingTrip.start-=age;}}
  if(this.drawingTrip&&(this.tour||this.away||this.state.calm)){this.drawingTrip=null;return;}
  if(this.drawingTrip){this.advanceJourney(this.drawingTrip);if(this.drawingTrip.complete)this.drawingTrip=null;}
 }
 drawingActive(){return !!this.drawingTrip&&!this.tour&&!this.away&&!this.state.calm;}
 boardProgress(){if(!this.drawingActive())return 1;const t=this.drawingTrip;return t.phase==='home'?1:t.phase==='hold'?Math.max(0,Math.min(1,1-(t.holdRemaining-(performance.now()/1000-t.legStart))/8)):Math.max(0,1-t.holdRemaining/8);}

 boardBasis(){const b=this.layout.board,start=this.p(b.u,b.v,110),endWorld=P.rotateOffset(b,1,0),end=this.p(endWorld.u,endWorld.v,110);let dx=(end[0]-start[0])/54,dy=(end[1]-start[1])/54,x=start[0],y=start[1];if(dx<0){x+=dx*114;y+=dy*114;dx=-dx;dy=-dy;}return {x,y,dx,dy};}
 chalkInfo(){const r=this.layout.board.rotation||0;return {actor:r===1||r===2?P.chalkFront:P.chalk,atlas:r===1||r===2?this.chalkFrontAtlas:this.chalkAtlas,mirror:r===2||r===3};}
 drawingStation(){const basis=this.boardBasis(),{actor:a,mirror}=this.chalkInfo(),tip=a.chalkTips[0],sign=mirror?-1:1,base=this.p(this.layout.board.u,this.layout.board.v),du=this.p(this.layout.board.u+1,this.layout.board.v),dv=this.p(this.layout.board.u,this.layout.board.v+1),x=basis.x+basis.dx*76-sign*(tip[0]-a.feet[0])*a.scale-base[0],y=basis.y+basis.dy*76+((this.layout.board.rotation||0)===2?54:61)-(tip[1]-a.feet[1])*a.scale-base[1],ax=du[0]-base[0],ay=du[1]-base[1],bx=dv[0]-base[0],by=dv[1]-base[1],det=ax*by-ay*bx;return {u:this.layout.board.u+(x*by-y*bx)/det,v:this.layout.board.v+(ax*y-ay*x)/det};}
 boardChalkContact(index){const {actor:a,mirror}=this.chalkInfo(),tip=a.chalkTips[index],pose=this.drawingTrip?.phase==='hold'?this.drawingPose():this.drawingStation(),[fx,fy]=this.p(pose.u,pose.v),b=this.boardBasis(),x=fx+(mirror?-1:1)*(tip[0]-a.feet[0])*a.scale-b.x,y=fy+(tip[1]-a.feet[1])*a.scale-b.y;return {x:x/b.dx,y:y-x/b.dx*b.dy};}

 boardPixelArt(){
  const c=this.ctx,t=(this.state.publicBoardText||'').toLowerCase();c.fillStyle='#c1d1b3';
  const rect=(x,y,w,h)=>c.fillRect(58+x,((this.layout.board.rotation||0)===2?37:44)+y,w,h);
  if(/stair|step|ramp/.test(t)){rect(0,20,36,5);rect(12,12,24,8);rect(24,4,12,8);}
  else if(/camera/.test(t)){rect(0,6,36,23);c.fillStyle='#3e5042';rect(13,11,13,13);c.fillStyle='#e6ebd6';rect(17,15,5,5);rect(5,2,11,4);}
  else if(/mic|audio|headphone/.test(t)){rect(14,0,10,20);rect(9,13,4,10);rect(26,13,4,10);rect(9,22,21,4);rect(18,26,4,5);rect(10,31,20,3);}
  else if(/lamp|light/.test(t)){rect(9,1,21,5);rect(5,6,29,6);rect(1,12,37,4);rect(18,16,4,15);rect(9,31,22,3);}
  else if(/bag|backpack|tote/.test(t)){rect(4,9,31,25);rect(11,0,17,4);rect(8,4,4,6);rect(27,4,4,6);c.fillStyle='#3e5042';rect(11,18,17,10);}
  else if(/bowl|food|treat/.test(t)){rect(0,12,38,5);rect(4,17,30,10);rect(9,27,20,4);}
  else if(/rug|mat/.test(t)){rect(3,3,30,26);c.fillStyle='#3e5042';rect(7,7,22,18);c.fillStyle='#c1d1b3';rect(13,11,10,10);}
  else if(/stand|tablet|laptop|screen/.test(t)){rect(0,0,37,24);c.fillStyle='#3e5042';rect(4,4,29,16);c.fillStyle='#c1d1b3';rect(17,24,4,7);rect(8,31,23,3);}
  else if(/mug|cup|bottle/.test(t)){rect(4,1,24,29);rect(28,7,8,4);rect(32,11,4,12);rect(28,23,8,4);}
  else if(/bed|sofa/.test(t)){rect(0,10,38,20);rect(0,4,7,10);rect(31,4,7,10);rect(4,30,4,5);rect(30,30,4,5);}
  else {rect(2,3,33,29);c.fillStyle='#3e5042';rect(16,3,5,29);rect(2,12,33,3);}
 }
 drawingPose(){const t=this.drawingTrip;return t?{...t.pose,drawing:t.phase==='hold'&&!t.blocked}:{...this.drawingStation(),drawing:false,facing:1,distance:0};}
 drawingPip(){
  if(!this.drawingActive())return;const pose=this.drawingPose();this.corgi(pose.u,pose.v,pose.drawing?'draw':'walk',pose);

 }
 chalkboard(){
  const {u,v}=this.layout.board,c=this.ctx,basis=this.boardBasis();
  c.save();c.translate(basis.x,basis.y);c.transform(basis.dx,basis.dy,0,1,0,0);
  c.fillStyle='#a49170';c.fillRect(-5,-4,124,88);c.fillStyle='#3e5042';c.fillRect(0,0,114,77);
  this.text('LOOKING FOR',8,17,10,'#dce2cd');
  const words=(this.state.publicBoardText||'New directions soon').split(/\s+/);let line='',lines=[];
  for(const word of words){if((line+' '+word).trim().length>18&&line){lines.push(line);line=word;}else line=(line+' '+word).trim();}if(line)lines.push(line);
  c.save();c.beginPath();c.rect(0,21,114,32*Math.min(1,this.boardProgress()*2));c.clip();
  lines.slice(0,2).forEach((line,i)=>this.text(line.slice(0,20),8,32+i*12,9,'#f2eedb'));
  c.restore();c.save();if(this.drawingActive()){c.beginPath();if(this.boardProgress()<=0)c.rect(0,0,0,0);const ticks=Math.max(1,Math.min(P.chalk.sequence.length,Math.floor(this.boardProgress()*8*P.chalk.fps)+1)),radius=1+this.boardProgress()*30;for(const i of this.boardProgress()>0?P.chalk.sequence.slice(0,ticks):[]){const tip=this.boardChalkContact(i);c.moveTo(tip.x+radius,tip.y);c.arc(tip.x,tip.y,radius,0,Math.PI*2);}c.clip();}this.boardPixelArt();c.restore();
  c.fillStyle='#b1a183';c.fillRect(3,83,5,25);c.fillRect(105,83,5,25);c.fillRect(-3,106,20,4);c.fillRect(98,106,20,4);
  c.fillStyle='#737c6c';for(const a of [1,109]){c.beginPath();c.arc(a,113,4,0,Math.PI*2);c.fill();}c.restore();
  this.tagAt('board',u,v,70,140,145,'Public chalkboard · edit looking for');
 }
 celebrationActive(){return this.state.partyAt&&Date.now()-this.state.partyAt>=0&&Date.now()-this.state.partyAt<30000;}
 officeTicker(){
  const c=this.ctx,[x,y]=this.p(3.25,-.04,137);c.save();c.translate(x,y);c.transform(1,.5,0,1,0,0);
  c.fillStyle='#a99e80';c.fillRect(-4,-4,220,42);c.fillStyle='#e3dec8';c.fillRect(-1,-1,214,36);c.fillStyle='#303d32';c.fillRect(3,3,206,28);
  c.save();c.beginPath();c.rect(7,5,198,24);c.clip();c.font='600 12px monospace';c.textBaseline='middle';c.fillStyle='#d9df9e';
  const active=this.celebrationActive(),message=active?(this.state.partyPreview?'SASHA BOUGHT PIP A CAKE. THANK YOU!':'A VIEWER SENT CAKE. THANK YOU!'):'THE DAILY MEILI / OFFICE';
  const width=c.measureText(message).width,elapsed=Date.now()-this.state.partyAt;
  const offset=active&&!this.state.calm?198-(elapsed/38)%(width+230):0;c.fillText(message,7+offset,18);c.restore();c.restore();
 }
 partyCake(){
  if(!this.celebrationActive())return;
  this.box(6.1,3.3,1.15,.85,5,C.wood,C.woodEdge,44);
  for(const [u,v]of [[6.16,3.37],[7.08,3.37],[6.16,4.04],[7.08,4.04]])this.box(u,v,.08,.08,44,C.wood,C.woodEdge);
  this.box(6.32,3.48,.7,.5,3,'#faf5e2','#d8cfb5',49);
  this.box(6.36,3.51,.62,.44,14,'#f0e3cb','#bd9474',52);
  this.box(6.36,3.51,.62,.44,4,'#f8eed8','#e5d3b4',66);
  for(const u of [6.48,6.7,6.9]){const [x,y]=this.p(u,3.7,70);this.line([x,y],[x,y-11],'#b67c61',3);this.ctx.fillStyle='#dbb66a';this.ctx.fillRect(x-1,y-16,3,4);}
 }
 partyConfetti(){
  if(!this.celebrationActive()||this.state.calm)return;
  const c=this.ctx,elapsed=Date.now()-this.state.partyAt,colors=['#a7b991','#cfae73','#be866b','#e0c9a1'];
  for(let i=0;i<60;i++){const u=.4+(i*1.31)%7.1,v=.4+(i*.73)%5.2,z=195-((elapsed/24+i*31)%190);const [x,y]=this.p(u,v,z);c.fillStyle=colors[i%4];c.fillRect(x+Math.sin(elapsed/600+i)*5,y,3,5);}
 }
 board(){
  if(this.floor==='sourcing'){this.officeTicker();return;}

  if(this.floor==='writing'){this.writingShelves();return;}
  this.plane(3.2,0,7.15,0,57,151,'#b0a285');this.plane(3.33,-.01,7.02,-.01,64,144,'#465447');
  if(this.floor==='writing'){this.wallText('WRITING',3.58,-.01,121,'right',15,'#f3f1df');this.wallText('APPROVED FOLDERS',3.58,-.02,94,'right',9,'#c6d1bb');this.wallText(String(this.state.leadCount).padStart(2,'0'),3.58,-.02,72,'right',16,'#eee8d6');this.tagAt('brief',5.22,0,103,222,119,'Writing queue · approved folders');return;}
  const title=(this.state.brief||'').match(/pet stairs|pet bed|pet camera|dog food|treats|rug/i)?.[0].toUpperCase()||'CURRENT HUNT';this.wallText(title,3.58,-.01,121,'right',15,'#f3f1df');
  const baseU=3.6, v=-.02;
  const points=[[0,0],[.42,0],[.42,16],[.84,16],[.84,32],[1.26,32],[1.26,48]];
  for(let i=0;i<points.length-1;i++)this.line(this.p(baseU+points[i][0],v,74+points[i][1]),this.p(baseU+points[i+1][0],v,74+points[i+1][1]),'#ecebd7',3);
  this.wallText('3 TO START',3.58,-.03,59,'right',8,'#a9ba9e');
  for(let i=0;i<2;i++){this.plane(5.55+i*.65,-.03,6.02+i*.65,-.03,76,107,'#f9f2db',null);const [x,y]=this.p(5.78+i*.65,-.05,109);this.ctx.fillStyle=i?'#cbb77e':'#c86b46';this.ctx.fillRect(x-3,y-3,6,6);for(let j=0;j<3;j++)this.line(this.p(5.63+i*.65,-.06,98-j*6),this.p(5.92+i*.65,-.06,98-j*6),'#babda7',1.3)}
  this.tagAt('brief',5.22,0,103,222,119,'Chalkboard · check in with Pip');
 }
 room(){
  this.poly([[170,420],[611,644],[950,472],[517,243]],'#dfe1d4',null);
  this.box(0,0,8,6,14,C.floor,'#aab09f',-14);
  const c=this.ctx;c.save();for(let u=1;u<8;u++)this.line(this.p(u,0),this.p(u,6),'#e4e3d6',.8);for(let v=1;v<6;v++)this.line(this.p(0,v),this.p(8,v),'#e4e3d6',.8);c.restore();
  this.plane(0,0,0,6,0,173,this.floor==='writing'?'#c8a18a':C.wall);this.plane(0,0,8,0,0,173,this.floor==='writing'?'#dfb49b':C.wall2);
  // Sparse brick courses keep the architecture legible at a distance.
  for(let z=26;z<173;z+=29){this.line(this.p(0,0,z),this.p(0,6,z),this.floor==='writing'?'#e6c8b3':'#d1d4c7',1);this.line(this.p(0,0,z),this.p(8,0,z),this.floor==='writing'?'#efd1ba':'#dce0d2',1);for(let a=0;a<8;a+=1.6){const k=a+(z%2?.8:0);if(k<8)this.line(this.p(k,0,z),this.p(k,0,Math.min(z+27,173)),this.floor==='writing'?'#efd1ba':'#dce0d2',1);if(k<6)this.line(this.p(0,k,z),this.p(0,k,Math.min(z+27,173)),this.floor==='writing'?'#e6c8b3':'#d1d4c7',1)}}
  this.line(this.p(0,0,174),this.p(0,6,174),'#a4ad99',4);this.line(this.p(0,0,174),this.p(8,0,174),'#b3baa7',4);
  this.plane(0,.02,0,6,0,9,'#b8bfae',null);this.plane(0,0,8,0,0,9,'#b8bfae',null);
  this.window();this.board();this.elevator();
  // Wall clock: time on the actual Mac, not a fabricated work metric.
  const [cx,cy]=this.p(.04,4.65,129);c.fillStyle='#fbf8e9';c.strokeStyle='#909b85';c.lineWidth=3;c.beginPath();c.ellipse(cx,cy,22,26,-.07,0,Math.PI*2);c.fill();c.stroke();const date=new Date();const min=date.getMinutes()*Math.PI/30,hour=(date.getHours()%12+date.getMinutes()/60)*Math.PI/6;this.line([cx,cy],[cx+Math.sin(min)*13,cy-Math.cos(min)*17],C.edge,2);this.line([cx,cy],[cx+Math.sin(hour)*9,cy-Math.cos(hour)*11],C.ink,3);
  this.plane(7.5,0,7.94,0,30,62,'#f6f5eb');this.wallText(this.floor==='writing'?'02':'01',7.54,-.03,40,'right',12,'#7c8a70');
  // A narrow rug defines the workspace without becoming another room.
  this.poly([this.p(2.1,2.1),this.p(5.35,2.1),this.p(5.35,4.5),this.p(2.1,4.5)],this.floor==='writing'?'#c6a1a1':'#e1e4d4',this.floor==='writing'?'#a58283':'#c8cfb9',1);
  if(this.floor==='writing')for(let i=0;i<5;i++)this.line(this.p(2.2+i*.62,2.2),this.p(2.2+i*.62,4.4),'#ddc2b7',2);
 }
 writingShelves(){
  const colors=['#79866c','#cf9c83','#d9c9a7','#8d7c91','#b9bd9a','#a87961'];
  for(const z of [57,100,143]){
   this.plane(3.3,-.01,6.85,-.01,z,z+31,'#94765f','#82654f');
   for(let i=0;i<18;i++){const u=3.38+i*.19;this.plane(u,-.04,u+.14,-.04,z+3,z+18+(i%4)*3,colors[i%colors.length],null);this.line(this.p(u+.02,-.05,z+8),this.p(u+.12,-.05,z+8),'#e4d4bc',1);}
   this.box(3.25,0,3.7,.23,4,'#bf9a75','#80624e',z);
  }
 }
 leafyPlant(u,v,z=0,size=1){
  this.box(u-.21,v-.21,.42,.42,22*size,'#bc8d70','#967158',z);
  const [x,y]=this.p(u,v,z+22*size);this.line([x,y],[x,y-64*size],'#697b55',3);
  for(let i=0;i<7;i++){const side=i%2?1:-1,yy=y-(15+i*7)*size;this.line([x,yy],[x+side*22*size,yy-8*size],'#697b55',2);this.poly([[x+side*9*size,yy-2*size],[x+side*31*size,yy-6*size],[x+side*26*size,yy-20*size],[x+side*12*size,yy-14*size]],i%3?'#7e956b':'#a1b18a','#657b58',1);}
 }
 meiliDesk(){
  const {u,v}=this.layout.desk,[x,y]=this.p(u,v),frame=this.meiliFrames[this.state.calm?0:[0,1,0,2,0,3][Math.floor(this.time*2)%6]];
  if(frame.complete&&frame.naturalWidth){const c=this.ctx;c.save();c.imageSmoothingEnabled=false;c.drawImage(frame,x-125,y-181,242,242);c.restore();}
  this.tagAt('desk',u,v,75,220,215,'Meili’s desk · the writing room');
 }
 deskSeat(){return P.rotateOffset(this.layout.desk,P.desk.seat.forward,P.desk.seat.across);}
 desk(){
  if(this.floor==='writing'){this.meiliDesk();return;}
  const {u,v}=this.layout.desk,seated=this.floor==='sourcing'&&!this.tour&&!this.away&&!this.workerAtHome()&&!this.drawingActive(),back=(this.layout.desk.rotation||0)>=2;
  const chair=()=>{
  if(this.floor==='sourcing'){
   // Rounded upholstery and a swivel base distinguish the chair from the screens.
   const cushion=(points,fill)=>{
    const c=this.ctx,mix=(a,b,f)=>[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
    c.beginPath();points.forEach((point,i)=>{const before=mix(point,points[(i+points.length-1)%points.length],.22),after=mix(point,points[(i+1)%points.length],.22);if(i===0)c.moveTo(...before);else c.lineTo(...before);c.quadraticCurveTo(...point,...after);});c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle='#9b8b71';c.lineWidth=1.5;c.stroke();
   };
   const cu=u-1.17;
   this.line(this.p(cu,v,4),this.p(cu,v,29),'#6b756a',4);
   for(let i=0;i<5;i++){const angle=i*Math.PI*2/5;this.line(this.p(cu,v,5),this.p(cu+Math.cos(angle)*.47,v+Math.sin(angle)*.47,3),'#6b756a',2.5);}
   cushion([this.p(u-1.65,v-.53,32),this.p(u-.76,v-.53,32),this.p(u-.76,v+.53,32),this.p(u-1.65,v+.53,32)],'#d4c2a4');
   this.line(this.p(u-1.56,v,31),this.p(u-1.56,v,51),'#8e8b75',3);
   cushion([this.p(u-1.56,v-.47,40),this.p(u-1.56,v-.47,77),this.p(u-1.56,v+.47,77),this.p(u-1.56,v+.47,40)],'#d4c2a4');
   cushion([this.p(u-1.55,v-.36,46),this.p(u-1.55,v-.36,71),this.p(u-1.55,v+.36,71),this.p(u-1.55,v+.36,46)],'#e4d5bb');
   return;
  }
  // The whole workstation faces +u (SE): chair -> connected forelegs -> keyboard -> screen.
  for(const [a,b] of [[-1.55,-.45],[-.91,-.45],[-1.55,.45],[-.91,.45]])this.box(u+a,v+b,.10,.10,27,'#71806b','#667360');
  this.box(u-1.64,v-.58,.93,1.16,6,'#a8b79c','#7b8d70',27);
  this.box(u-1.64,v-.60,.12,1.20,49,'#adbaa3','#7d8d72',31);
  this.plane(u-1.50,v-.49,u-1.50,v+.49,39,74,'#a0b08f','#91a182');
  };
  const table=()=>{
  // Two side supports leave a real knee well directly in front of the chair.
  this.box(u-.67,v-1.28,1.49,.12,43,'#9aa48c','#87937c');
  this.box(u-.63,v+.88,1.43,.42,43,'#c6cab9','#a7b19b');
  for(const z of [6,20,33]){
   this.plane(u-.65,v+.91,u-.65,v+1.27,z,z+11,'#dce0cf','#94a187');
   this.line(this.p(u-.67,v+1.02,z+7),this.p(u-.67,v+1.17,z+7),'#75836a',2);
  }
  this.box(u+.77,v-1.30,.10,2.62,8,'#c2b18d','#a99c7f',35);
  this.box(u-.72,v-1.35,1.65,2.70,6,C.wood,C.woodEdge,43);
  this.poly([this.p(u-.61,v-.76,49.2),this.p(u+.28,v-.76,49.2),this.p(u+.28,v+.76,49.2),this.p(u-.61,v+.76,49.2)],'#a7b39a','#96a486',1);
  // Key rows run across the worker, perpendicular to the monitor's viewing direction.
  this.box(u-.46,v-.60,.46,1.18,2.5,'#f4f0df','#8f9982',50);
  for(let row=0;row<3;row++)for(let col=0;col<8;col++)this.box(u-.42+row*.11,v-.55+col*.137,.075,.10,.7,row===0&&col===0?'#d4a17b':'#fffbed','#c2c8b3',52.5);
  this.box(u-.075,v-.21,.055,.43,.7,'#fffbed','#c2c8b3',52.5);
  this.box(u-.22,v+.82,.24,.20,1,'#8d9c7e','#8d9c7e',49);
  this.box(u-.19,v+.85,.16,.13,3,'#eeeedd','#a1ad94',50);
  this.line(this.p(u-.15,v+.915,54),this.p(u-.08,v+.915,54),'#a3ab95',1);
  this.box(u+.29,v-1.14,.39,.35,3,'#fff9e7','#c0bda4',49);
  for(let i=0;i<3;i++)this.line(this.p(u+.35+i*.07,v-1.10,53),this.p(u+.35+i*.07,v-.86,53),'#b5b59d',1);
  };
  const monitor=()=>{
  // The display is in front of Pip, facing back along -u toward his chair.
  const mu=u+.65,mv=v-.10;
  const pip=this.actor==='pip'&&this.floor==='sourcing';
  this.box(mu-.12,mv-.16,.26,.30,1.5,pip?'#647169':'#7c8a70',pip?'#4c5952':'#66755e',49);
  this.line(this.p(mu,mv,51),this.p(mu,mv,70),pip?'#4c5952':'#69785f',3);
  this.plane(mu-.025,mv-.58,mu-.025,mv+.58,68,108,pip?'#aeb9ad':'#bec9ae','#4c5952');
  this.plane(mu,mv-.58,mu,mv+.58,68,108,pip?'#637168':'#8c9b7c','#4c5952');
  if(this.actor==='pip'&&this.floor==='sourcing'){
   // This is the back of Pip's main display; its screen faces his keyboard.
   for(let z=80;z<=86;z+=3)this.line(this.p(mu+.025,mv-.18,z),this.p(mu+.025,mv+.18,z),'#45554b',1);
  }else this.monitorScreen(mu+.02,mv);
  };
  const sideMonitor=()=>{
   if(this.actor!=='pip'||this.floor!=='sourcing')return;
   // Pip faces +u, so his left-hand monitor is on the -v edge of the desk.
   // Its perpendicular screen faces inward (+v), where visitors can see it.
   const mu=u+.04,mv=v-1.06;
   this.box(mu-.15,mv-.10,.30,.20,1.5,'#647169','#4c5952',49);
   this.line(this.p(mu,mv,51),this.p(mu,mv,70),'#4c5952',3);
   this.plane(mu-.57,mv-.025,mu+.57,mv-.025,64,108,'#637168','#4c5952');
   this.plane(mu-.57,mv,mu+.57,mv,64,108,'#526158','#3e4d44');
   this.monitorScreen(mu,mv+.02,'side');
  };
  if(back){monitor();sideMonitor();table();if(seated)this.deskCorgi('front');chair();}else{chair();if(seated)this.deskCorgi('rear');table();sideMonitor();if(seated)this.deskCorgi('front');monitor();}
  this.tagAt(this.actor==='owl'?'owl-desk':'desk',u+.1,v,77,163,140,this.floor==='writing'?'Writing desk · approved folders':(this.actor==='owl'?'Owl’s desk · ':'Pip’s desk · ')+this.monitorActivity().label+(this.monitorActivity().title&&this.monitorActivity().title!==this.monitorActivity().label?' · '+this.monitorActivity().title:''));
  if(seated){const s=P.world(this.layout.desk,P.desk.seat.forward,P.desk.seat.across);this.tagAt(this.actor==='owl'?'owl':'pip',s.u,s.v,103,88,120,this.actor==='owl'?'Owl · Yan’s agent at his keyboard':'Pip · at his keyboard');}
 }
 monitorActivity(){
  const preview=performance.now()<this.typingPreviewUntil,active=this.floor==='sourcing'&&(this.state.busy||preview);
  const mode=active?(this.state.work?.mode&&this.state.work.mode!=='idle'?this.state.work.mode:preview?'preview':'researching'):'idle';
  const label={idle:'Resting',researching:'Research',thinking:'Ideas',chat:'Chat',working:'Thinking',preview:'Preview',present:'At the desk',reviewing:'Reviewing leads'}[mode]||'Working';
  return {mode,label,title:active?String(this.state.work?.title||label).slice(0,80):'',scroll:active&&mode!=='present'&&!this.state.calm?Math.floor(this.time*5)%28:0};
 }
 monitorScreen(u,v,orientation='front'){
  const c=this.ctx,a=this.monitorActivity(),w=80,h=44;
  // A small visible work display, mapped onto the monitor plane. The rows are activity
  // glyphs, never fabricated browser results; only the local app supplies a task title.
  let left=orientation==='side'?this.p(u-.50,v,104):this.p(u,v-.50,104),right=orientation==='side'?this.p(u+.50,v,104):this.p(u,v+.50,104);if(left[0]>right[0])[left,right]=[right,left];
  c.save();c.transform((right[0]-left[0])/w,(right[1]-left[1])/w,0,36/h,left[0],left[1]);
  c.beginPath();c.rect(0,0,w,h);c.clip();c.fillStyle=a.mode==='idle'?'#dce3d4':'#e4ead7';c.fillRect(0,0,w,h);
  c.font='500 7px "IBM Plex Mono", monospace';c.textAlign='left';c.textBaseline='top';
  if(a.mode==='idle'){
   c.fillStyle='#78896d';c.fillRect(38,20,4,4);
  }else{
   c.fillStyle='#bdcbaa';c.fillRect(0,0,w,10);c.fillStyle='#3e5038';c.fillText(a.label.toUpperCase(),4,2);
   c.save();c.beginPath();c.rect(3,12,74,21);c.clip();
   for(let i=0;i<5;i++){
    const y=12+i*14-a.scroll;
    if(a.mode==='chat'){
     c.fillStyle=i%2?'#b3c59c':'#ced9bc';c.fillRect(i%2?18:4,y,i%2?52:58,10);c.fillStyle='#819774';c.fillRect(i%2?23:8,y+3,32+(i%2)*7,2);
    }else{
     c.fillStyle=i%2?'#b0c29b':'#c2cdae';c.fillRect(4,y,10,10);c.fillStyle='#849974';c.fillRect(19,y+1,43-i%3*6,2);c.fillStyle='#b4c2a3';c.fillRect(19,y+6,33+i%2*8,2);
    }
   }
   c.restore();c.fillStyle='#e4ead7';c.fillRect(0,34,w,10);c.fillStyle='#536849';
   let title=a.title;while(c.measureText(title).width>w-8&&title.length>2)title=title.slice(0,-2)+'…';c.fillText(title,4,36);
  }
  c.restore();
 }
 deskCorgi(layer='front'){
  const rotation=this.layout.desk.rotation||0,back=rotation>=2,mirror=rotation===1||rotation===3,reviewing=this.actor==='pip'&&this.state.work?.mode==='reviewing'&&this.reviewAtlas.complete&&this.reviewAtlas.naturalWidth,a=reviewing?(back?P.review.back:P.review.front):this.actor==='owl'?(back?P.owl.back:P.owl.desk):(back?P.deskBack:P.desk.actor),atlas=reviewing?(this.reviewCutout||this.reviewAtlas):this.actor==='owl'?this.owlDeskAtlas:(back?this.deskBackAtlas:this.deskAtlas);if(!reviewing&&(!atlas.complete||!atlas.naturalWidth))return;
  const contact=P.desk.contact,point=P.world(this.layout.desk,contact.forward,contact.across),[x,y]=this.p(point.u,point.v,contact.z),busy=this.state.work?.mode!=='present'&&(this.state.busy||performance.now()<this.typingPreviewUntil),src=reviewing||back||this.actor==='owl'?a.frames[busy&&!this.state.calm?a.sequence[Math.floor(Math.max(0,this.time)*a.fps)%a.sequence.length]:0]:P.deskFrame({...this.state,busy,time:this.time});
  const rx=this.canvas.width/this.width,ry=this.canvas.height/this.height,unitX=a.scale*this.scale*rx,unitY=a.scale*this.scale*ry,left=Math.round((this.ox+x*this.scale)*rx-(mirror?src[2]-a.contact[0]:a.contact[0])*unitX),top=Math.round((this.oy+y*this.scale)*ry-a.contact[1]*unitY),w=Math.round(src[2]*unitX),h=Math.round(src[3]*unitY),c=this.ctx;
  this.spriteHotspot(this.actor,left,top,w,Math.min(h,90*this.scale*ry));
  if(this.actor==='pip')this.pipMouth=[((left+w*(mirror?.28:.72))/rx-this.ox)/this.scale,((top+h*.28)/ry-this.oy)/this.scale];
  c.save();c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;
  if(layer==='front'&&a.visible){c.beginPath();a.visible.forEach(([px,py],i)=>{const dx=left+Math.round((mirror?src[2]-px:px)/src[2]*w),dy=top+Math.round(py/src[3]*h);i?c.lineTo(dx,dy):c.moveTo(dx,dy);});c.closePath();c.clip();}
  if(mirror){c.translate(left+w,top);c.scale(-1,1);c.drawImage(this.actor==='owl'?(this.owlDeskCutout||atlas):atlas,...src,0,0,w,h);}else c.drawImage(this.actor==='owl'?(this.owlDeskCutout||atlas):atlas,...src,left,top,w,h);c.restore();
  if(layer==='front'&&!this.state.busy&&this.hover===this.actor){const bx=x+(mirror?26:-26),by=y-a.contact[1]*a.scale-8;this.poly([[bx-20,by-18],[bx+20,by-18],[bx+20,by],[bx+4,by],[bx,by+5],[bx-4,by],[bx-20,by]],'#fffdf0','#bec5ac',1);this.text('hi!',bx,by-5,11,C.ink,'monospace','center');}
 }

 shelf(){const {u,v}=this.layout.shelf;
  this.box(u-.55,v-.2,1.35,.6,76,'#d7d6c3','#afb69d');
  if(![1,2].includes(this.layout.shelf.rotation||0))for(const z of [7,35,64]){this.plane(u-.5,v+.41,u+.75,v+.41,z,z+21,'#737d67');for(let i=0;i<6;i++){const start=u-.44+i*.18;const colors=['#e4dabc','#aebda2','#d9c4aa','#87997c','#e9e6d4','#b7987c'];this.plane(start,v+.425,start+.13,v+.425,z,z+15+(i%3)*2,colors[i],null)}}
  this.tagAt('shelf',u+.05,v,46,114,104,this.floor==='writing'?'Reference shelf · writing queue':'Reference shelf · the playbook');
 }
 tray(){const {u,v}=this.layout.tray;
  for(const [a,b] of [[-.5,-.3],[.5,-.3],[-.5,.45],[.5,.45]])this.box(u+a,v+b,.08,.08,38,'#8f9c7e','#8f9c7e');this.box(u-.62,v-.4,1.4,1,5,'#e0deca','#b1b9a2',38);
  this.box(u-.42,v-.25,.96,.55,8,'#76886a','#8d9d7e',43);
  const count=Math.min(3,this.state.leadCount);for(let i=0;i<count;i++){this.box(u-.36,v-.19,.8,.42,1.5,'#fff9e6','#d5ccb1',52+i*2);this.box(u-.25+i*.18,v-.19,.15,.08,2,i===0?'#c8794c':'#a4b093','#b4b996',54+i*2)}
  this.wallText(this.floor==='writing'?'INCOMING':'LEADS',u-.3,v+.61,27,'right',8,'#637355');this.tagAt('leads',u+.1,v,60,100,99,(this.floor==='writing'?'Writing tray · ':'Lead tray · ')+this.state.leadCount+' to browse');
 }
 bed(){const {u,v}=this.layout.bed;
  if(this.floor==='writing'){this.box(u-.5,v-.4,1.1,.85,25,'#a1889b','#796579');this.box(u-.6,v-.48,.2,1,55,'#ac90a3','#796579');this.box(u-.5,v-.5,1.1,.15,39,'#a1889b','#796579');this.box(u-.5,v+.4,1.1,.15,39,'#a1889b','#796579');this.box(u-.3,v-.1,.65,.55,4,'#d5bdad','#b49c91',25);this.box(u+.75,v-.15,.6,.5,28,'#b79673','#8d735b');this.box(u+.79,v-.1,.4,.32,3,'#eee2c4','#bca58a',28);return;}
  this.box(u-.6,v-.35,1.4,.9,10,'#bec7af','#9daa8c');this.poly([this.p(u-.46,v-.22,11),this.p(u+.61,v-.22,11),this.p(u+.61,v+.41,11),this.p(u-.46,v+.41,11)],'#e6e5d2','#a6b197');
  if(this.floor==='sourcing'&&this.workerAtHome()&&!this.drawingActive())this.corgi(u+.12,v+.03,this.state.visitorActor==='pip'?'alert':'rest');
  const [x,y]=this.p(u+1,v+.1);this.ctx.fillStyle='#aab79e';this.ctx.strokeStyle=C.edge;this.ctx.lineWidth=1.6;this.ctx.beginPath();this.ctx.ellipse(x,y-5,13,7,0,0,Math.PI*2);this.ctx.fill();this.ctx.stroke();this.ctx.fillStyle='#e5e9df';this.ctx.beginPath();this.ctx.ellipse(x,y-7,9,4,0,0,Math.PI*2);this.ctx.fill();this.tagAt('bed',u+.1,v,17,100,52,this.floor==='writing'?'Reading nook · writing queue':this.workerAtHome()?'Pip · resting in his bed · check in':'Pip’s bed');
 }
 plant(){
  if(this.floor==='writing'){this.leafyPlant(.65,.7,0,1);this.leafyPlant(7.35,.7,0,.8);return;}
  this.box(.45,.55,.65,.7,26,'#b4bea6','#8a9b7b');this.box(.48,.58,.59,.64,4,'#69765e','#809073',26);
  const p=(u,v,z)=>this.p(u,v,z);this.line(p(.77,.9,28),p(.77,.9,113),'#927b5f',8);
  this.line(p(.77,.9,74),p(.77,1.65,74),'#927b5f',6);
  for(const [u,v,z]of [[.5,.6,109],[.85,.6,128],[.65,.95,139],[1.05,.9,117]]){const [x,y]=p(u,v,z);this.poly([[x-23,y-5],[x-14,y-19],[x+8,y-23],[x+23,y-8],[x+18,y+11],[x-6,y+16],[x-22,y+7]],z>125?'#b6c49f':'#9eb38b','#849a74',1.4);}
  if(this.owlAtHome()){this.owlSprite(.77,1.5,this.state.visitorActor==='owl'?'alert':'rest',{},76);this.tagAt('owl',.77,1.5,132,67,82,'Owl · resting in his tree · Yan’s agent');}
  this.tagAt('owl-tree',.77,.9,85,95,160,'Owl’s tree home · check in with Owl');
 }

 chalkCorgi(u,v){
  const {actor:a,atlas,mirror}=this.chalkInfo();if(!atlas.complete||!atlas.naturalWidth)return;const c=this.ctx,seconds=(Date.now()-(this.state.boardAt||0))/1000,src=a.frames[this.state.calm?0:a.sequence[Math.floor(Math.max(0,seconds)*a.fps)%a.sequence.length]],[x,y]=this.p(u,v),rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;
  const left=Math.round((this.ox+(x-(mirror?src[2]-a.feet[0]:a.feet[0])*a.scale)*this.scale)*rx),top=Math.round((this.oy+(y-a.feet[1]*a.scale)*this.scale)*ry),w=Math.round(src[2]*a.scale*this.scale*rx),h=Math.round(src[3]*a.scale*this.scale*ry);
  c.save();c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;if(mirror){c.translate(left+w,top);c.scale(-1,1);c.drawImage(atlas,...src,0,0,w,h);}else c.drawImage(atlas,...src,left,top,w,h);c.restore();
 }

 corgi(u,v,mode,options={}){
  if(this.actor==='owl'){if(mode==='desk')this.deskCorgi();else this.owlSprite(u,v,mode==='rest'?'rest':'walk',options);return;}
  if(mode==='draw'){this.chalkCorgi(u,v);return;}
  if(mode==='desk'){this.deskCorgi();return;}
  if(!this.atlas.complete||!this.atlas.naturalWidth)return;
  const walking=mode==='walk',animated=walking&&this.walkAtlas.complete&&this.walkAtlas.naturalWidth;
  const walkFrame=Math.floor((options.distance||0)/6.5)%this.walkFrames.length;
  const [x,y]=this.p(u,v),frame=mode==='rest'?'rest':['draw','alert'].includes(mode)?'idle':walking?'walk':'type',src=animated?this.walkFrames[walkFrame]:this.frames[frame],atlas=animated?this.walkAtlas:this.atlas;
  const height=walking?76:mode==='alert'?68:mode==='draw'?76:57,width=height*src[2]/src[3];
  const bob=this.state.calm||mode==='alert'?0:walking?Math.sin((options.distance||0)/39*Math.PI*2)*.6:Math.sin(this.time*2)*.75;
  const z=['rest','alert'].includes(mode)?11:0,c=this.ctx;
  // Draw the sprite directly on whole display pixels. Turning moves its anchor without
  // repeatedly resampling the face. Walking and resting use complete sprites too.
  const rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;
  const left=Math.round((this.ox+(x-width/2)*this.scale)*rx),top=Math.round((this.oy+(y-height-z+bob)*this.scale)*ry);
  const outWidth=Math.max(1,Math.round(width*this.scale*rx)),outHeight=Math.max(1,Math.round(height*this.scale*ry));
  this.spriteHotspot('pip',left,top,outWidth,outHeight);
  this.pipMouth=[((left+outWidth*(walking&&options.facing<0?.28:.72))/rx-this.ox)/this.scale,((top+outHeight*(mode==='rest'?.58:.40))/ry-this.oy)/this.scale];
  c.save();c.setTransform(1,0,0,1,0,0);c.imageSmoothingEnabled=false;
  if(walking&&options.facing<0){c.translate(left+outWidth,top);c.scale(-1,1);c.drawImage(atlas,...src,0,0,outWidth,outHeight);}else c.drawImage(atlas,...src,left,top,outWidth,outHeight);
  c.restore();
 }
 elevator(){
  this.plane(.8,0,2.05,0,0,121,'#b1bba4');this.plane(.91,-.02,1.94,-.02,2,112,'#707c69');
  const open=!!this.tour?.transfer||this.away||!!this.owlRuntime.tour?.transfer||this.owlRuntime.away;
  for(let i=0;i<2;i++){const a=.94+i*.49,offset=open?(i? .33:-.33):0;this.plane(a+offset,-.04,a+.46+offset,-.04,3,109,'#c8d0bd','#94a286');}
  this.wallText(this.floor==='writing'?'02':'01',1.28,-.06,127,'right',10,'#708063');this.tagAt('elevator',1.43,0,66,78,124,this.floor==='writing'?'Elevator · writing queue':'Elevator · downstairs to writing');
 }
 previewTyping(){if(!this.state.calm&&!this.away&&!this.tour)this.typingPreviewUntil=performance.now()+8000;}
 navigationSignature(){return JSON.stringify([this.floor,this.layout,!!this.celebrationActive()]);}
 navigationObstacles(){
  const obstacles=[],add=(id,pose,rect,pad=.22)=>{const [x1,y1,x2,y2]=rect,points=[[x1,y1],[x2,y1],[x2,y2],[x1,y2]].map(([u,v])=>P.rotateOffset(pose,u,v));obstacles.push({id,minU:Math.min(...points.map(p=>p.u))-pad,maxU:Math.max(...points.map(p=>p.u))+pad,minV:Math.min(...points.map(p=>p.v))-pad,maxV:Math.max(...points.map(p=>p.v))+pad});};
  add('desk',this.layout.desk,[-.72,-1.35,.93,1.35]);add('chair',this.layout.desk,[-1.64,-.6,-.71,.6]);
  if(this.floor==='sourcing'&&this.layout.owlDesk){add('owlDesk',this.layout.owlDesk,[-.72,-1.35,.93,1.35]);add('owlChair',this.layout.owlDesk,[-1.64,-.6,-.71,.6]);}
  for(const key of ['shelf','tray','bed']){const f=this.footprint(key);obstacles.push({id:key,minU:f.minU-.22,maxU:f.maxU+.22,minV:f.minV-.22,maxV:f.maxV+.22});}
  if(this.floor==='sourcing'){add('board',this.layout.board,[0,-.04,2.25,.04],.1);add('board-wheel-a',this.layout.board,[-.06,-.14,.3,.2],.08);add('board-wheel-b',this.layout.board,[1.8,-.14,2.25,.2],.08);}
  add('plant',{u:0,v:0},[.45,.55,1.08,1.22]);
  if(this.floor==='sourcing'&&this.celebrationActive())add('cake',{u:0,v:0},[6.1,3.3,7.25,4.15]);
  return obstacles;
 }
 pointBlocked(p,obstacles=this.navigationObstacles()){return p.u<.16||p.u>7.84||p.v<.16||p.v>5.84||obstacles.some(o=>p.u>o.minU&&p.u<o.maxU&&p.v>o.minV&&p.v<o.maxV);}
 segmentClear(a,b,obstacles=this.navigationObstacles(),ignore=[]){
  if([a,b].some(p=>p.u<.16||p.u>7.84||p.v<.16||p.v>5.84))return false;
  for(const o of obstacles){if(ignore.includes(o.id))continue;let lo=0,hi=1;for(const [key,min,max]of [['u',o.minU,o.maxU],['v',o.minV,o.maxV]]){const d=b[key]-a[key];if(Math.abs(d)<1e-9){if(a[key]<=min||a[key]>=max){lo=2;break;}}else{const t1=(min-a[key])/d,t2=(max-a[key])/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}if(lo<hi&&hi>0&&lo<1)return false;}
  return true;
 }
 planWalk(from,to){
  const obstacles=this.navigationObstacles(),seat=this.deskSeat(),atSeat=p=>Math.hypot(p.u-seat.u,p.v-seat.v)<.04,allowed=(p)=>atSeat(p)?['chair']:[],startIgnore=allowed(from),endIgnore=allowed(to);
  if(this.pointBlocked(from,obstacles.filter(o=>!startIgnore.includes(o.id)))||this.pointBlocked(to,obstacles.filter(o=>!endIgnore.includes(o.id))))return null;
  const nodes=[{u:from.u,v:from.v},{u:to.u,v:to.v}];
  for(const o of obstacles)for(const [u,v]of [[o.minU-.025,o.minV-.025],[o.maxU+.025,o.minV-.025],[o.maxU+.025,o.maxV+.025],[o.minU-.025,o.maxV+.025]])if(!this.pointBlocked({u,v},obstacles))nodes.push({u,v});
  const distance=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();distance[0]=0;
  for(let count=0;count<nodes.length;count++){let i=-1;for(let j=0;j<nodes.length;j++)if(!visited.has(j)&&(i<0||distance[j]<distance[i]))i=j;if(i<0||!Number.isFinite(distance[i]))break;if(i===1)break;visited.add(i);
   for(let j=0;j<nodes.length;j++){if(visited.has(j)||i===j)continue;const ignore=[...(i===0||j===0?startIgnore:[]),...(i===1||j===1?endIgnore:[])];if(!this.segmentClear(nodes[i],nodes[j],obstacles,ignore))continue;const d=distance[i]+Math.hypot(nodes[j].u-nodes[i].u,nodes[j].v-nodes[i].v);if(d<distance[j]){distance[j]=d;previous[j]=i;}}
  }
  if(!Number.isFinite(distance[1]))return null;const path=[];for(let i=1;i>=0;i=previous[i]){path.unshift(nodes[i]);if(i===0)break;}return path;
 }
 trayStation(from){const tray=this.layout.tray,candidates=[[0,1.0],[0,-.85],[-.95,0],[1.1,0]].map(([u,v])=>P.rotateOffset(tray,u,v));let best=null,bestLength=Infinity;for(const point of candidates){const route=this.planWalk(from,point);if(!route)continue;const length=route.slice(1).reduce((n,p,i)=>n+Math.hypot(p.u-route[i].u,p.v-route[i].v),0);if(length<bestLength){best=point;bestLength=length;}}return best||candidates[0];}
 assignRoute(t,from,to,now){
  t.signature=this.navigationSignature();t.points=this.planWalk(from,to);t.pose={...from,facing:t.pose?.facing||1,distance:t.distanceBase||0};t.blocked=!t.points;t.legStart=now;
  if(t.blocked){t.points=[from];t.lengths=[];t.length=0;t.legDuration=Infinity;return;}
  t.lengths=t.points.slice(1).map((p,i)=>{const a=this.p(t.points[i].u,t.points[i].v),b=this.p(p.u,p.v);return Math.hypot(b[0]-a[0],b[1]-a[1]);});t.length=t.lengths.reduce((a,b)=>a+b,0);t.legDuration=Math.max(.05,t.length/62);
 }
 makeTour(from,to,{roundTrip=false,transfer=false,done,hold=0,fromResolver,toResolver,thought=''}={}){
  const now=performance.now()/1000,t={start:now,roundTrip,transfer,from,to,fromResolver:fromResolver||(()=>from),toResolver:toResolver||(()=>to),phase:'out',holdRemaining:hold,distanceBase:0,done,thought:typeof thought==='string'?thought.slice(0,100):'',complete:false};this.assignRoute(t,from,to,now);t.duration=t.legDuration*(roundTrip?2:1)+hold;return t;
 }
 currentWalkingPosition(){return this.tour?.pose||this.drawingTrip?.pose||this.deskSeat();}
 deliver(){
  if(this.away||this.tour?.transfer||this.state.calm)return;const from=this.currentWalkingPosition();this.drawingTrip=null;this.tour=this.makeTour(from,this.trayStation(from),{roundTrip:true,fromResolver:()=>this.deskSeat(),toResolver:p=>this.trayStation(p)});
 }
 walkToLift(done,thought=''){const from=this.currentWalkingPosition();this.drawingTrip=null;this.away=true;this.tour=this.makeTour(from,{u:1.43,v:.38},{transfer:true,done,thought});}
 receiveFolder(done,thought=''){const from={u:1.43,v:.38};this.tour=this.makeTour(from,this.trayStation(from),{roundTrip:true,transfer:true,toResolver:p=>this.trayStation(p),done,thought});}
 returnFromLift(done){this.tour=this.makeTour({u:1.43,v:.38},this.deskSeat(),{transfer:true,toResolver:()=>this.deskSeat(),done:()=>{this.away=false;done?.();}});}
 cancelTransfer(){if(this.tour?.transfer)this.tour=null;this.away=false;this.render();}
 sampleLeg(t,fraction){
  let remaining=Math.max(0,Math.min(1,fraction))*t.length,segment=0;while(segment<t.lengths.length-1&&remaining>t.lengths[segment])remaining-=t.lengths[segment++];
  const a=t.points[segment],b=t.points[segment+1]||a,f=t.lengths[segment]?remaining/t.lengths[segment]:0,pa=this.p(a.u,a.v),pb=this.p(b.u,b.v);
  return {u:a.u+(b.u-a.u)*f,v:a.v+(b.v-a.v)*f,facing:pb[0]<pa[0]?-1:1,distance:t.distanceBase+Math.max(0,Math.min(1,fraction))*t.length};
 }
 advanceJourney(t){
  if(t.complete)return null;const now=performance.now()/1000;if(this.state.calm){t.complete=true;if(!t.callbackFired){t.callbackFired=true;t.done?.();}return null;}
  if(t.signature!==this.navigationSignature()){
   if(t.phase==='hold'){const target=t.toResolver(t.pose);t.holdRemaining=Math.max(0,t.holdRemaining-(now-t.legStart));if(Math.hypot(target.u-t.pose.u,target.v-t.pose.v)>.04){t.phase='out';this.assignRoute(t,t.pose,target,now);}else{t.signature=this.navigationSignature();t.legStart=now;}}
   else {t.distanceBase=t.pose.distance||t.distanceBase;this.assignRoute(t,t.pose,t.phase==='home'?t.fromResolver(t.pose):t.toResolver(t.pose),now);}
  }
  if(t.blocked)return t.pose;
  for(let transitions=0;transitions<4;transitions++){
   if(t.phase==='hold'){if(now-t.legStart<t.holdRemaining)return t.pose;t.legStart+=t.holdRemaining;t.holdRemaining=0;if(t.roundTrip){t.phase='home';const start=t.legStart;this.assignRoute(t,t.pose,t.fromResolver(t.pose),start);if(t.blocked)return t.pose;continue;}t.complete=true;break;}
   const fraction=(now-t.legStart)/t.legDuration;t.pose=this.sampleLeg(t,fraction);if(fraction<1&&!this.state.calm)return t.pose;
   const end=t.legStart+t.legDuration;t.distanceBase=t.pose.distance;
   if(t.phase==='out'&&t.holdRemaining>0&&!this.state.calm){t.phase='hold';t.legStart=end;continue;}
   if(t.phase==='out'&&t.roundTrip&&!this.state.calm){t.phase='home';this.assignRoute(t,t.pose,t.fromResolver(t.pose),end);if(t.blocked)return t.pose;continue;}
   t.complete=true;break;
  }
  if(t.complete&&!t.callbackFired){t.callbackFired=true;t.done?.();}return t.complete?null:t.pose;
 }
 advanceTour(){const t=this.tour;if(!t)return null;const pose=this.advanceJourney(t);if(t.complete&&this.tour===t)this.tour=null;return pose;}

 thoughtBubble(pose,text){
  if(!pose||!text||!this.thoughtAtlas.complete||!this.thoughtAtlas.naturalWidth)return;
  const c=this.ctx,[px,py]=this.p(pose.u,pose.v,82),ax=this.ox+px*this.scale,ay=this.oy+py*this.scale;
  const w=Math.min(210,Math.max(165,this.width*.30)),h=w*2/3,mirror=ax>this.width*.65;
  const x=Math.round(Math.max(5,Math.min(this.width-w-5,ax-w*(mirror?.84:.16)))),y=Math.round(Math.max(4,ay-h+8));
  c.save();c.setTransform(this.canvas.width/this.width,0,0,this.canvas.height/this.height,0,0);c.imageSmoothingEnabled=false;
  if(mirror){c.save();c.translate(x+w,y);c.scale(-1,1);c.drawImage(this.thoughtCutout||this.thoughtAtlas,0,0,w,h);c.restore();}else c.drawImage(this.thoughtCutout||this.thoughtAtlas,x,y,w,h);
  c.font='500 12px "IBM Plex Mono", monospace';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#343b32';
  const lines=[],words=text.split(/\s+/);let line='';
  for(const word of words){const next=line?line+' '+word:word;if(c.measureText(next).width>w*.77&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  if(lines.length>3){lines.splice(3);lines[2]+='…';}
  for(let i=0;i<lines.length;i++){let value=lines[i];while(c.measureText(value).width>w*.77&&value.length>2)value=value.slice(0,-2)+'…';c.fillText(value,x+w*.5,y+h*.405+(i-(lines.length-1)/2)*16);}
  c.restore();this.thoughtBounds={x,y,w,h,text};
 }
 render(){if(this.actor==='owl'||!this.width||!this.height)return;this.turn=this.state.workOpen&&!this.state.calm&&!this.arrange?Math.sin(this.time/46*Math.PI*2)*.07:0;const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.canvas.width,this.canvas.height);const rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;c.setTransform(rx*this.scale,0,0,ry*this.scale,rx*this.ox,ry*this.oy);this.regions={};this.thoughtBounds=null;const walker=this.advanceTour(),owlWalker=this.floor==='sourcing'||this.owlRuntime.tour?this.forWorker('owl',()=>this.advanceTour()):null;this.updateDrawing();this.room();this.plant();
  const props=[['desk',this.layout.desk],...(this.floor==='sourcing'?[['owlDesk',this.layout.owlDesk]]:[]),['shelf',this.layout.shelf],['tray',this.layout.tray],['bed',this.layout.bed],...(this.floor==='sourcing'?[['chalkboard',this.layout.board],...(this.celebrationActive()?[['partyCake',{u:6.1,v:3.3}]]:[])]:[]),...(walker?[['walker',walker]]:[]),...(owlWalker?[['owlWalker',owlWalker]]:[]),...(this.floor==='sourcing'&&this.drawingActive()?[['drawingPip',this.drawingPose()]]:[])].sort((a,b)=>a[1].u+a[1].v-b[1].u-b[1].v);
  for(const [name,pose] of props){if(name==='owlWalker'){this.forWorker('owl',()=>this.owlSprite(pose.u,pose.v,'walk',pose));}else if(name==='walker'){const [x,y]=this.p(pose.u,pose.v);c.fillStyle='#53624722';c.beginPath();c.ellipse(x-6,y-1,31,7,0,0,Math.PI*2);c.fill();this.corgi(pose.u,pose.v,'walk',pose);}else {this.objectTransform=['desk','owlDesk','shelf','tray','bed'].includes(name)?{...pose,rotation:pose.rotation||0}:null;this[name]();this.objectTransform=null;}}
  if(walker&&this.tour?.thought&&this.tour.phase!=='home')this.thoughtBubble(walker,this.tour.thought);
  if(owlWalker&&this.owlRuntime.tour?.thought&&this.owlRuntime.tour.phase!=='home')this.thoughtBubble(owlWalker,this.owlRuntime.tour.thought);
  if(this.floor==='sourcing'){this.partyConfetti();}
  if(!this.arrange&&(this.tour?.blocked||this.drawingTrip?.blocked||this.owlRuntime.tour?.blocked))this.text(this.owlRuntime.tour?.blocked?'OWL NEEDS A CLEAR PATH':'PIP NEEDS A CLEAR PATH',540,650,10,'#9a7656','monospace','center');
  if(this.arrange){for(const key of ['desk',...(this.floor==='sourcing'?['owlDesk']:[]),'shelf','tray','bed','board']){this.poly(this.furnitureHull(key),null,this.blocked&&this.selectedFurniture===key?'#be7758':this.selectedFurniture===key?'#6d805d':'#abb79b',this.selectedFurniture===key?2:1);}this.text(this.blocked?'SPACE OCCUPIED · TRY A CLEAR SPOT':'DRAG TO MOVE · SELECT + R TO ROTATE · ESC TO FINISH',540,650,10,this.blocked?'#a46448':'#8d987d','monospace','center');}

  for(const [id,key]of Object.entries({desk:'desk','owl-desk':'owlDesk',shelf:'shelf',leads:'tray',bed:'bed',board:'board'})){const r=this.regions[id];if(!r)continue;const h=this.furnitureHull(key),xs=h.map(p=>p[0]),ys=h.map(p=>p[1]);r.x=(Math.min(...xs)+Math.max(...xs))/2;r.y=Math.max(...ys);r.w=Math.max(...xs)-Math.min(...xs);r.h=Math.max(...ys)-Math.min(...ys);r.hull=h;}
  this.updateHotspots();
 }
 updateHotspots(){for(const [id,r]of Object.entries(this.regions)){let b=this.buttons[id];if(!b){b=document.createElement('button');b.className='hotspot';b.dataset.object=id;b.setAttribute('aria-label',r.label);b.addEventListener('click',()=>{if(!this.arrange)this.onSelect(id)});b.addEventListener('mouseenter',()=>this.showHint(id));b.addEventListener('mouseleave',()=>this.showHint(null));b.addEventListener('focus',()=>this.showHint(id));b.addEventListener('blur',()=>this.showHint(null));this.hotspots.appendChild(b);this.buttons[id]=b;}b.style.left=`${this.ox+r.x*this.scale}px`;b.style.top=`${this.oy+r.y*this.scale}px`;b.style.width=`${r.w*this.scale}px`;b.style.height=`${r.h*this.scale}px`;b.style.pointerEvents=this.arrange?'none':'auto';b.style.clipPath=r.hull?'polygon('+r.hull.map(([x,y])=>`${(x-r.x+r.w/2)/r.w*100}% ${(y-r.y+r.h)/r.h*100}%`).join(',')+')':'';b.setAttribute('aria-label',r.label);b.hidden=false;}for(const [id,b]of Object.entries(this.buttons))if(!this.regions[id])b.hidden=true;}
 showHint(id){this.hover=id;const el=document.getElementById(this.hintId),r=this.regions[id];if(!r||this.arrange){el.classList.remove('visible');return}el.textContent=r.label;el.style.left=`${this.ox+r.x*this.scale}px`;el.style.top=`${this.oy+(r.y-r.h/2-7)*this.scale}px`;el.classList.add('visible')}
 point(e){const r=this.canvas.getBoundingClientRect();return {x:(e.clientX-r.left-this.ox)/this.scale,y:(e.clientY-r.top-this.oy)/this.scale};}
 footprint(key,pose=this.layout[key]){
  const specs={desk:[-1.64,-1.35,.93,1.35,110],owlDesk:[-1.64,-1.35,.93,1.35,110],shelf:[-.55,-.2,.8,.43,76],tray:[-.62,-.4,.78,.61,61],bed:[-.6,-.35,1.25,.55,17],board:[0,-.12,2.25,.25,114]},[x1,y1,x2,y2,h]=specs[key],r=(pose.rotation||0)*Math.PI/2;
  const corners=[[x1,y1],[x2,y1],[x2,y2],[x1,y2]].map(([x,y])=>({u:pose.u+x*Math.cos(r)-y*Math.sin(r),v:pose.v+x*Math.sin(r)+y*Math.cos(r)}));
  return {corners,h,minU:Math.min(...corners.map(p=>p.u)),maxU:Math.max(...corners.map(p=>p.u)),minV:Math.min(...corners.map(p=>p.v)),maxV:Math.max(...corners.map(p=>p.v))};
 }
 furnitureHull(key){
  const f=this.footprint(key),points=f.corners.flatMap(p=>[this.p(p.u,p.v),this.p(p.u,p.v,f.h)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],hi=[];for(const p of points){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}for(const p of [...points].reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}return lo.slice(0,-1).concat(hi.slice(0,-1));
 }
 pointInHull(p,h){let inside=false;for(let i=0,j=h.length-1;i<h.length;j=i++){const a=h[i],b=h[j];if((a[1]>p.y)!==(b[1]>p.y)&&p.x<(b[0]-a[0])*(p.y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
 pickFurniture(p){return ['desk',...(this.floor==='sourcing'?['owlDesk']:[]),'shelf','tray','bed','board'].sort((a,b)=>(this.layout[b].u+this.layout[b].v)-(this.layout[a].u+this.layout[a].v)).find(key=>this.pointInHull(p,this.furnitureHull(key)));}
 availableOwlDesk(){
  const original=this.layout.owlDesk,options=[{u:6.5,v:4,rotation:1},{u:2,v:3,rotation:1}];let fallback=null;
  for(let r=0;r<4;r++)for(let v=1.5;v<=4.5;v+=.25)for(let u=1.5;u<=6.5;u+=.25)options.push({u,v,rotation:r});
  try{for(const pose of options){if(!this.validPlacement('owlDesk',pose))continue;fallback ||= pose;this.layout.owlDesk=pose;
   const reachable=actor=>this.forWorker(actor,()=>{const seat=this.deskSeat();return !!this.planWalk(seat,this.trayStation(seat))&&!!this.planWalk(seat,{u:1.43,v:.38});});
   if(reachable('pip')&&reachable('owl'))return pose;
  }return fallback;}finally{this.layout.owlDesk=original;}
 }
 validPlacement(key,pose){
  const f=this.footprint(key,pose),walker=this.tour?.pose||this.drawingTrip?.pose;if(walker&&walker.u>f.minU-.16&&walker.u<f.maxU+.16&&walker.v>f.minV-.16&&walker.v<f.maxV+.16)return false;if(f.minU<.05||f.maxU>7.95||f.minV<.05||f.maxV>5.95)return false;
  if(key==='board'){const previous=this.layout.board;this.layout.board=pose;let station;try{station=this.drawingStation();}finally{this.layout.board=previous;}if(station.u<.2||station.u>7.8||station.v<.2||station.v>5.8)return false;const occupied=['desk','owlDesk','shelf','tray','bed'].some(other=>{const o=this.footprint(other);return station.u>o.minU-.18&&station.u<o.maxU+.18&&station.v>o.minV-.18&&station.v<o.maxV+.18;});if(occupied)return false;}
  const overlaps=(a,b)=>a.minU<b.maxU-.06&&a.maxU>b.minU+.06&&a.minV<b.maxV-.06&&a.maxV>b.minV+.06;
  if(overlaps(f,{minU:.65,maxU:2.1,minV:0,maxV:.85})||overlaps(f,{minU:.45,maxU:1.05,minV:.55,maxV:1.2}))return false;
  return !['desk',...(this.floor==='sourcing'?['owlDesk']:[]),'shelf','tray','bed','board'].some(other=>other!==key&&overlaps(f,this.footprint(other)));
 }
 rotateSelected(direction=1){const key=this.selectedFurniture;if(!this.arrange||!['desk','owlDesk','board','shelf','tray','bed'].includes(key))return false;const pose={...this.layout[key],rotation:((this.layout[key].rotation||0)+(direction<0?3:1))%4};this.blocked=!this.validPlacement(key,pose);if(!this.blocked){this.layout[key]=pose;this.onLayout(this.layout);}this.render();return !this.blocked;}
 pointerDown(e){if(!this.arrange)return;const p=this.point(e),key=this.pickFurniture(p);this.selectedFurniture=key||null;this.blocked=false;if(key){this.drag={key,point:p,start:{...this.layout[key]}};this.canvas.setPointerCapture?.(e.pointerId);}this.render();}
 pointerMove(e){if(!this.drag)return;const p=this.point(e),dx=(p.x-this.drag.point.x)/54,dy=(p.y-this.drag.point.y)/27,round=n=>Math.round(n*4)/4,key=this.drag.key,candidate={...this.drag.start,u:round(this.drag.start.u+(dx+dy)/2),v:round(this.drag.start.v+(dy-dx)/2)};this.blocked=!this.validPlacement(key,candidate);if(!this.blocked)this.layout[key]=candidate;this.render();}
 pointerUp(e){if(this.drag){const changed=JSON.stringify(this.drag.start)!==JSON.stringify(this.layout[this.drag.key]);this.drag=null;this.blocked=false;if(changed)this.onLayout(this.layout);this.canvas.releasePointerCapture?.(e.pointerId);this.render();}}

}
window.OfficeScene=OfficeScene;
})();
