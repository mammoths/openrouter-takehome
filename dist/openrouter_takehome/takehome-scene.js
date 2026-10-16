(function(){
'use strict';
// The sample studio shares the public office projection and sprites. No native
// bridge, live agent state, or mail operations are included in this page.
class TakehomeLabScene extends OfficeScene {
 constructor(canvas,hotspots,onSelect){
  super(canvas,hotspots,onSelect,()=>{},{floor:'production',hintId:'productionHint'});
  this.presets=[];this.references=new Map();this.jobStates={};
  this.frameSprite=new Image();this.frameSprite.onload=()=>this.render();this.frameSprite.src='assets/picture-frame.png';
  this.postAtlas=new Image();this.postAtlas.onload=()=>{try{this.postAtlasCutout=this.pixelCutout(this.postAtlas);}catch{/* Retain the supplied alpha when pixel reads are unavailable. */}this.render();};this.postAtlas.src='assets/post-corgi-v1.png';
 }
 setPresets(presets){
  this.presets=presets;
  for(const preset of presets)for(const url of [preset.productImage,preset.meiliImage]){
   if(!url||this.references.has(url))continue;
   const image=new Image();this.references.set(url,image);image.onload=()=>this.render();image.onerror=()=>this.render();image.src=url;
  }
  this.render();
 }
 photo(u,v,imageURL,label,kind){
  const c=this.ctx,[x,y]=this.p(u,v,54),image=this.references?.get(imageURL);
  c.save();c.translate(x,y);c.transform(1,.5,0,1,0,0);
  const framed=this.frameSprite?.complete&&this.frameSprite.naturalWidth;
  const opening=framed?{x:-18,y:-57,w:32,h:42}:{x:-26,y:-63,w:49,h:52};
  if(!framed){c.fillStyle='#aa9e81';c.fillRect(-28,-65,59,70);c.fillStyle='#fffdf3';c.fillRect(-31,-68,59,70);c.strokeStyle='#babfa7';c.lineWidth=1;c.strokeRect(-31,-68,59,70);}
  c.fillStyle='#fffdf4';c.fillRect(opening.x,opening.y,opening.w,opening.h);
  if(image?.complete&&image.naturalWidth){
   const scale=Math.min(opening.w/image.naturalWidth,opening.h/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
   c.imageSmoothingEnabled=true;c.drawImage(image,opening.x+(opening.w-w)/2,opening.y+(opening.h-h)/2,w,h);c.imageSmoothingEnabled=false;
  }else{
   c.fillStyle='#a9b696';c.fillRect(-17,-41,29,15);c.fillStyle='#c6d0b6';c.fillRect(-9,-49,21,8);
  }
  if(framed)c.drawImage(this.frameSprite,248,196,840,875,-32,-73,68,71);
  this.text(label.slice(0,14),-2,8,5.8,'#8c997c','monospace','center');c.restore();
  this.tagAt('reference-'+kind,u,v,89,66,88,label+' · reference image');
 }
 notes(u,v,id){
  const c=this.ctx,[x,y]=this.p(u,v,51);c.save();c.translate(x,y);c.transform(1,.5,-.7,.35,0,0);
  c.fillStyle='#c4cbb5';c.fillRect(-16,-17,37,42);c.fillStyle='#fffbed';c.fillRect(-19,-20,37,42);c.strokeStyle='#b2bda0';c.lineWidth=1;c.strokeRect(-19,-20,37,42);
  for(let i=0;i<5;i++){c.fillStyle=i===0?'#a5ad93':'#c3cbb5';c.fillRect(-12,-12+i*6,i===4?15:23,1.5);}c.fillStyle='#c18562';c.fillRect(7,-23,7,7);c.restore();
  this.tagAt('notes-'+id,u,v,57,63,61,'Read and edit the '+(this.presets.find(p=>p.id===id)?.name||'project')+' prompt');
 }
 redButton(u,v,id){
  const status=this.jobStates?.[id],running=['starting','queued','running','pending','processing','generating','submitting'].includes(status),c=this.ctx,[x,y]=this.p(u,v,58);
  this.box(u-.25,v-.2,.55,.43,6,'#c6ceba','#97a58a',45);
  c.fillStyle=running?'#b99568':'#a04637';c.beginPath();c.ellipse(x,y+4,14,7,0,0,Math.PI*2);c.fill();
  c.fillStyle=running?'#d2b486':'#cf6e52';c.beginPath();c.ellipse(x,y-1,14,7,0,0,Math.PI*2);c.fill();c.strokeStyle=running?'#a58a61':'#a14c39';c.lineWidth=1.2;c.stroke();
  c.fillStyle=running?'#f0e0bd':'#e79b78';c.beginPath();c.ellipse(x-3,y-3,6,2,0,0,Math.PI*2);c.fill();
  if(running&&!this.state.calm){c.fillStyle='#d6c28d';for(let i=0;i<3;i++){const alpha=(Math.floor(this.time*3)+i)%3===0?1:.3;c.globalAlpha=alpha;c.fillRect(x-6+i*5,y-17,3,3);}c.globalAlpha=1;}
  this.tagAt('generate-'+id,u,v,66,69,65,running?'Generation in progress · view '+id:(this.generationMode==='draft'?'Generate one cheap draft · ':'Generate two videos · ')+(this.presets.find(p=>p.id===id)?.name||id));
 }
 table(v,preset,index){
  const status=this.jobStates?.[preset.id],u=1.8,w=5.65,d=.72;
  for(const [a,b]of [[u+.12,v+.08],[u+w-.19,v+.08],[u+.12,v+d-.14],[u+w-.19,v+d-.14]])this.box(a,b,.09,.09,42,'#a3b196','#849777');
  this.box(u,v,w,d,6,'#e3e8d8','#a9b79a',42);this.line(this.p(u,v+d,43),this.p(u+w,v+d,43),'#92a380',1.4);
  this.photo(2.55,v+.24,preset.productImage,['PENNYBOARD','PET STAIRS','NOMOHAUS BED'][index]||preset.name,'product-'+preset.id);
  this.photo(4.05,v+.24,preset.meiliImage,'MEILI','meili-'+preset.id);
  this.notes(5.6,v+.27,preset.id);this.redButton(6.82,v+.3,preset.id);
  const [x,y]=this.p(2.1,v+.76,29);this.ctx.save();this.ctx.translate(x,y);this.ctx.transform(1,.5,0,1,0,0);this.text('0'+(index+1)+' / '+preset.name.toUpperCase(),0,0,7.5,'#859777');this.ctx.restore();
  if(status==='completed'||status==='succeeded'||status==='ready'){const [x,y]=this.p(7.1,v+.4,68);this.ctx.fillStyle='#7f9a67';this.ctx.fillRect(x,y,4,4);}
 }
 screen(){
  const active=Object.values(this.jobStates||{}).some(s=>['starting','queued','running','pending','processing','generating','submitting'].includes(s));
  this.plane(2.6,-.04,7.6,-.04,65,160,'#74876b','#5e7357');this.plane(2.73,-.08,7.46,-.08,74,151,'#344c3b','#b4c49d');
  this.wallText(active?'GENERATING…':'OPENROUTER / STUDIO',3.05,-.1,124,'right',12,active?'#e1d39f':'#d0ddbf');
  this.wallText(active?'VIDEO GENERATION IN PROGRESS':this.generationMode==='draft'?'CHEAP DRAFT / MINI 480p':'VIDEO COMPARISON',3.05,-.1,103,'right',7.5,'#91ac82');
  if(active){const c=this.ctx;for(let i=0;i<3;i++){const [x,y]=this.p(4.4+i*.25,-.12,88);c.fillStyle=this.state.calm||Math.floor(this.time*2)%3===i?'#b4c794':'#67815d';c.fillRect(x,y,5,5);}}
  this.tagAt('screen',5,0,120,280,110,'Open the video comparison desk');
 }
 postalCorgi(){
  const delivery=this.productionDelivery?.snapshot(performance.now())||{phase:'idle'};
  if(!['labs','drop','labs-return'].includes(delivery.phase)||!this.postAtlas?.complete||!this.postAtlas.naturalWidth)return;
  // Keep the seated courier and his speech anchor still after arriving.
  const u=1.15,v=5.5,[x,y]=this.p(u,v),src=[623,92,325,447],height=86,width=height*src[2]/src[3];
  const c=this.ctx;c.save();c.imageSmoothingEnabled=false;c.drawImage(this.postAtlasCutout||this.postAtlas,...src,x-width/2,y-height,width,height);c.restore();this.tagAt('post-corgi',u,v,45,80,100,'Post-corgi · production guide');
 }
 render(){
  if(!this.width||!this.height)return;
  const c=this.ctx;this.turn=0;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,this.canvas.width,this.canvas.height);
  const rx=this.canvas.width/this.width,ry=this.canvas.height/this.height;c.setTransform(rx*this.scale,0,0,ry*this.scale,rx*this.ox,ry*this.oy);this.regions={};
  this.poly([[170,420],[611,644],[950,472],[517,243]],'#dfe3d3',null);this.box(0,0,8,6,14,'#eef0e3','#a6b397',-14);
  for(let u=1;u<8;u++)this.line(this.p(u,0),this.p(u,6),'#dce3ce',.8);for(let v=1;v<6;v++)this.line(this.p(0,v),this.p(8,v),'#dce3ce',.8);
  this.plane(0,0,0,6,0,180,'#b9c8ae','#8b9e7c');this.plane(0,0,8,0,0,180,'#d0dac2','#96a888');
  for(let z=30;z<180;z+=30){this.line(this.p(0,0,z),this.p(0,6,z),'#d0dbc1',1);this.line(this.p(0,0,z),this.p(8,0,z),'#e1e7d5',1);}
  this.line(this.p(0,0,181),this.p(8,0,181),'#96a984',3);this.line(this.p(0,0,181),this.p(0,6,181),'#8fa17e',3);
  this.elevator();this.screen();
  for(const [i,preset]of (this.presets||[]).entries())this.table(1.55+i*1.48,preset,i);
  this.postalCorgi();this.wallText('04',7.7,-.01,25,'right',10,'#7e916b');this.updateHotspots();
 }
}
window.TakehomeLabScene=TakehomeLabScene;
})();
