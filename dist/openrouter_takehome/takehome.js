(function(){
'use strict';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const API_BASE=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?'/openrouter_takehome/api':'https://studio-api.thedailymeili.com/openrouter_takehome/api';
const DEFAULT_PRESETS=[
 {id:'skateboard',name:'The pennyboard',productImage:'assets/references/pennyboard.png',meiliImage:'assets/references/meili-dress.jpg',prompt:'A short vertical video of Meili, the corgi in the reference photo, standing with all four paws on this pennyboard. She coasts a short distance along a quiet, flat path. Low camera, gentle daylight, natural believable motion. Preserve her facial markings, dress, the board design, and four short corgi legs. One continuous shot, no text.'},
 {id:'stairs',name:'Pet stairs',productImage:'assets/references/pet-stairs.png',meiliImage:'assets/references/meili-sailor.jpg',prompt:'A short vertical video of Meili, the corgi in the reference photo, taking one careful step onto these pet stairs beside a couch. Cozy living room, soft natural daylight, camera at dog height. Preserve Meili’s face and sailor outfit and the exact stairs design. One clear action, four dog paws, no text.'},
 {id:'bed',name:'The Nomohaus bed',productImage:'assets/references/nomohaus-bed.png',meiliImage:'assets/references/meili-sleeping.jpg',productUrl:'https://www.nomohaus.com/products/the-leo-bed',prompt:'A short vertical video of Meili, the corgi in the reference photo, settling into this Nomohaus dog bed. She rests her chin, gives a slow blink, and relaxes. Quiet warm home, soft daylight, locked camera at dog height. Preserve her facial markings and the exact bed shape and fabric. One gentle action, no text.'}
];
let presets=DEFAULT_PRESETS.map(p=>({...p})),config=null,configError='',activePresetId=null,notesPresetId=null,drawerTrigger=null,selectedMode='draft',modeExplicitlySelected=false,calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
const comparisons=new Map(),comparisonHistory=new Map(),historySelections=new Map(),pending=new Set(),pendingModes=new Map(),expanding=new Set(),pendingRequestIds=new Map(),secondRequestIds=new Map(),draftPrompts=new Map(),importedReferences=new Map(),submissionErrors=new Map();
const modelSelections=new Map(),secondModelSelections=new Map(),noteDrafts=new Map();
const pendingRequestSignatures=new Map(),secondRequestModels=new Map();
let renderingDrawer=false;
let passcode='';try{passcode=sessionStorage.getItem('meili-demo-passcode')||'';}catch{}
const terminalStatuses=new Set(['completed','complete','succeeded','success','ready','failed','error','rejected','expired','cancelled','canceled','partial','partially_completed','partial_failure']);
const normalizeStatus=s=>String(s||'pending').toLowerCase();
const isTerminal=comparison=>!!comparison&&(comparison.terminal===true||terminalStatuses.has(normalizeStatus(comparison.status))||comparison.active===false&&comparison.jobs?.length>0&&comparison.jobs.every(job=>terminalStatuses.has(normalizeStatus(job.status))));
const isJobReady=job=>['completed','complete','succeeded','success','ready'].includes(normalizeStatus(job.status))&&!!safeVideoURL(job.videoUrl);
const presetById=id=>presets.find(p=>p.id===id);
const money=value=>Number.isFinite(Number(value))&&value!==null&&value!==''?'$'+Number(value).toFixed(Number(value)<.01?4:2):'Unavailable';
const estimatePrice=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<.2?'$'+Number(value).toFixed(3):money(value);
function safeMediaURL(value){try{const u=new URL(value,document.baseURI);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function safeVideoURL(value){if(!value)return '';try{const u=new URL(value,API_BASE.startsWith('http')?API_BASE+'/':location.origin+API_BASE+'/');return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),4800);}
async function api(path,{method='GET',body,signal,keepalive=false}={}){
 const headers={Accept:'application/json'};if(passcode)headers['X-Demo-Passcode']=passcode;if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(API_BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal,keepalive,cache:'no-store'});
 let data;try{data=await response.json();}catch{throw new Error('The studio returned an unexpected response.');}
 if(!response.ok){const error=new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||'The studio could not complete that request.');error.status=response.status;error.comparisonId=data.comparisonId||data.error?.comparisonId;error.generationBlocked=data.generationBlocked||data.error?.generationBlocked;error.preflight=data.preflight===true||error.generationBlocked?.preflight===true;error.balance=data.balance??null;error.current=data.current;error.quoteChanged=data.quoteChanged===true;throw error;}return data;
}
function sampleState(extra={}){return {calm,busy:true,owlBusy:true,mode:'researching',leadCount:3,publicBoardText:'Pet stairs',boardAt:0,work:{mode:'researching',title:'Sample pet briefs'},owlWork:{mode:'researching',title:'Sample brand research'},...extra};}
const sourcingScene=new OfficeScene($('sourcingCanvas'),$('sourcingHotspots'),id=>{if(id==='owl'||id==='owlDesk')talk('owl');else if(['pip','desk','board','tray','monitor'].includes(id))talk('pip');else if(id==='elevator')$('writing').scrollIntoView({behavior:calm?'instant':'smooth'});},()=>{},{floor:'sourcing',hintId:'sourcingHint'});
const writingScene=new WritingRoomScene($('writingCanvas'),$('writingHotspots'),id=>{if(id==='elevator')$('mail').scrollIntoView({behavior:calm?'instant':'smooth'});else talk('meili');},()=>{},{floor:'writing',hintId:'writingHint'});
const mailScene=new MailRoomScene($('mailCanvas'),$('mailHotspots'),id=>{if(id==='elevator')$('production').scrollIntoView({behavior:calm?'instant':'smooth'});else talk('post');},()=>{},{floor:'mail',hintId:'mailHint'});
const labScene=new TakehomeLabScene($('productionCanvas'),$('productionHotspots'),id=>{
 if(id.startsWith('generate-'))startComparison(id.slice(9));
 else if(id.startsWith('notes-'))openNotes(id.slice(6));
 else if(id.startsWith('reference-product-'))openNotes(id.slice(18));
 else if(id.startsWith('reference-meili-'))openNotes(id.slice(16));
 else if(id==='screen'){const id=activePresetId||presets.find(p=>comparisons.has(p.id))?.id||presets[0]?.id;if(id)openDrawer(id);}
 else if(id==='elevator')$('mail').scrollIntoView({behavior:calm?'instant':'smooth'});
 else if(id==='post-corgi')talk(labCueReady?'create':'lab');
});
sourcingScene.setState(sampleState());writingScene.setState(sampleState({owlBusy:false,leadCount:3}));mailScene.setState(sampleState({busy:false,owlBusy:false,pendingCount:3}));labScene.setState(sampleState({busy:false,owlBusy:false}));labScene.setPresets(presets);
const clamp=n=>Math.max(0,Math.min(1,n));
function roomProgress(element,start=.8,end=.2){const r=element.getBoundingClientRect();return clamp((innerHeight*start-r.top)/(r.height+innerHeight*(start-end)));}
let mailProgress=0,deliveryProgress=0,labCueReady=false;
// The writing room is deliberately stationary. Only the courier travels.
const idleMail={snapshot:()=>({phase:'idle',ids:[],deposited:0,elapsed:0})};
const scrollDelivery={snapshot(){
 if(calm)return deliveryProgress>=.78?{phase:'drop',f:1,ids:['sample-project']}:{phase:'idle'};
 if(deliveryProgress<=0)return {phase:'idle'};
 if(deliveryProgress<.38)return {phase:'mail',f:deliveryProgress/.38,ids:['sample-project']};
 if(deliveryProgress<.78)return {phase:'elevator',f:(deliveryProgress-.38)/.4,ids:['sample-project']};
 return {phase:'drop',f:1,ids:['sample-project']};
}};
writingScene.transit=idleMail;mailScene.transit=idleMail;mailScene.productionDelivery=scrollDelivery;labScene.productionDelivery=scrollDelivery;
const postImage=new Image();postImage.onload=drawElevator;postImage.src='assets/post-corgi-v1.png';
function drawElevator(){const c=$('elevatorCorgi').getContext('2d');c.clearRect(0,0,120,96);if(postImage.complete&&postImage.naturalWidth){c.imageSmoothingEnabled=false;c.drawImage(postImage,623,92,325,447,34,5,52,72);}}
const BUBBLES={
 owl:{element:'sourcingBubble',scene:sourcingScene,region:'owl',name:'OWL · SOURCING',text:'Hi OpenRouter! I find brands that fit Meili and research potential partnerships.'},
 pip:{element:'sourcingBubble',scene:sourcingScene,region:'pip',name:'PIP · QUALIFYING',text:'I turn that research into qualified briefs. For this demo: pet stairs, a pennyboard, and a dog bed.'},
 meili:{element:'writingBubble',scene:writingScene,region:'meili',name:'MEILI · WRITING',text:'Michelle built this agentic workforce for Meili’s brand and UGC projects. I draft the pitches here at my desk.'},
 post:{element:'mailBubble',scene:mailScene,region:'post-corgi',name:'POST-CORGI · DELIVERY',text:'I deliver mail, and bring qualified pitches down to the production lab.'},
 lab:{element:'mailBubble',scene:labScene,region:'post-corgi',name:'POST-CORGI · PRODUCTION LAB',text:'Here’s where we use OpenRouter to determine which model to generate the best video with our target product, references, and prompt.'},
 create:{element:'mailBubble',scene:labScene,region:'post-corgi',name:'POST-CORGI · YOUR TURN',text:'Pick the skateboard, stairs, or bed brief, then choose a cheap draft or a two-model comparison. Press its red button and decide which take to keep.',action:'Choose a brief ↓'}
};
const visibleBubbles=new Map(),dismissedBubbles=new Set();
let scoutStep=null,manualScout=null;
function talk(name,automatic=false){
 const b=BUBBLES[name];if(!b)return;
 const el=$(b.element);
 if(automatic&&dismissedBubbles.has(name)){el.hidden=true;visibleBubbles.delete(b.element);return;}
 if(!automatic){dismissedBubbles.delete(name);if(name==='owl'||name==='pip')manualScout=name;}
 if(visibleBubbles.get(b.element)!==name||el.hidden){
  el.innerHTML=`<button class="bubble-close" aria-label="Close ${esc(name)}’s introduction">×</button><span class="bubble-name">${b.name}</span><p>${b.text}</p>${b.action?`<button class="bubble-action">${b.action}</button>`:''}`;
  el.hidden=false;el.querySelector('button').onclick=()=>{el.hidden=true;dismissedBubbles.add(name);visibleBubbles.delete(b.element);};visibleBubbles.set(b.element,name);
  el.querySelector('.bubble-action')?.addEventListener('click',()=>$('briefList').scrollIntoView({behavior:calm?'instant':'smooth',block:'start'}));
 }
 document.querySelectorAll('#sourcing [data-talk]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.talk===visibleBubbles.get('sourcingBubble'))));
 positionBubbles();
}
document.querySelectorAll('[data-talk]').forEach(button=>button.addEventListener('click',()=>talk(button.dataset.talk==='post'&&deliveryProgress>=.78?(labCueReady?'create':'lab'):button.dataset.talk)));
function placeBubble(el,parent,x,y){
 if(el.parentElement!==parent)parent.appendChild(el);
 const width=el.offsetWidth,half=width/2,center=Math.max(half+10,Math.min(parent.clientWidth-half-10,x));
 const top=Math.max(el.offsetHeight+12,y-18);
 el.style.left=center+'px';el.style.top=top+'px';el.style.setProperty('--tail-x',Math.max(18,Math.min(width-26,x-center+half))+'px');
}
function positionBubbles(){
 for(const [element,name]of visibleBubbles){
  const b=BUBBLES[name],el=$(element);
  if(!calm&&element==='mailBubble'&&deliveryProgress>=.38&&deliveryProgress<.78){
   const parent=$('elevatorConnector'),car=$('elevatorCar'),p=parent.getBoundingClientRect(),r=car.getBoundingClientRect();
   placeBubble(el,parent,r.left-p.left+r.width/2,r.top-p.top+6);continue;
  }
  const scene=b.scene,region=scene.regions[b.region]||scene.regions[name==='owl'?'owlDesk':'desk'];if(!region)continue;
  const x=scene.ox+region.x*scene.scale,y=scene.oy+(region.y-region.h*.55)*scene.scale;
  placeBubble(el,scene.canvas.parentElement,x,y);
 }
}
function updateScroll(){
 const sourcing=$('sourcing').getBoundingClientRect(),writing=$('writing').getBoundingClientRect(),mail=$('mail').getBoundingClientRect(),production=$('production').getBoundingClientRect(),mailWrap=$('mailWrap').getBoundingClientRect(),labWrap=$('productionWrap').getBoundingClientRect();
 // Tie the two introductions to scroll distance, never a timer.
 const nextStep=sourcing.top< -170?'pip':'owl';if(nextStep!==scoutStep){scoutStep=nextStep;manualScout=null;}
 if(sourcing.top<innerHeight*.85&&sourcing.bottom>100)talk(manualScout||scoutStep,true);
 if(writing.top<innerHeight*.8&&writing.bottom>100)talk('meili',true);
 const start=mailWrap.top+mailWrap.height*.42,end=labWrap.top+labWrap.height*.25;
 deliveryProgress=clamp((innerHeight*.55-start)/Math.max(1,end-start));
 const elevator=clamp((deliveryProgress-.38)/.4),maxY=$('elevatorConnector').clientHeight-$('elevatorCar').clientHeight-$('elevatorCar').offsetTop-22;
 $('elevatorCar').style.transform=`translateY(${Math.max(0,maxY)*elevator}px)`;$('elevatorNumber').textContent=elevator>.5?'04 ↓':'03 ↓';
 $('elevatorCorgi').style.visibility=deliveryProgress>=.38&&deliveryProgress<.78?'visible':'hidden';
 mailScene.render();labScene.render();
 const cueEdge=document.querySelector('.site-header').getBoundingClientRect().bottom;
 if(labWrap.top<=cueEdge+20)labCueReady=true;
 else if(labWrap.top>cueEdge+140)labCueReady=false;
 if(mail.top<innerHeight*.85&&production.bottom>100)talk(deliveryProgress>=.78?(labCueReady?'create':'lab'):'post',true);
 const rooms=[['sourcing',sourcing],['writing',writing],['mail',mail],['production',production]],current=rooms.filter(([,r])=>r.top<innerHeight*.45).at(-1)?.[0]||'sourcing';
 document.querySelectorAll('.room-nav a').forEach(a=>a.setAttribute('aria-current',String(a.getAttribute('href')==='#'+current)));
 positionBubbles();
}
let scrollFrame=0;
function queueScroll(){if(!scrollFrame)scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;updateScroll();});}
addEventListener('scroll',queueScroll,{passive:true});addEventListener('resize',queueScroll);
document.fonts.ready.then(queueScroll);
new ResizeObserver(queueScroll).observe($('sourcingWrap'));
function setCalm(value){calm=value;document.body.classList.toggle('calm-mode',calm);$('calmButton').setAttribute('aria-pressed',String(calm));$('calmButton').textContent=calm?'◌ Calm mode on':'◌ Calm mode';for(const scene of [sourcingScene,writingScene,mailScene,labScene])scene.setState({calm});updateScroll();}
$('calmButton').onclick=()=>setCalm(!calm);setCalm(calm);

function promptFor(preset){return draftPrompts.get(preset.id)||preset.prompt||'';}
function comparisonMode(comparison){return comparison?.mode==='draft'?'draft':'compare';}
function comparisonTimestamp(comparison){return Number(comparison?.createdAt)||Date.parse(comparison?.createdAt)||0;}
function storeComparison(presetId,comparison){if(!comparison?.id)return;comparisonHistory.set(comparison.id,comparison);const previous=comparisons.get(presetId);if(!previous||previous.id===comparison.id||comparisonTimestamp(comparison)>=comparisonTimestamp(previous))comparisons.set(presetId,comparison);}
function historyFor(presetId){return [...comparisonHistory.values()].filter(comparison=>comparison.presetId===presetId).sort((a,b)=>comparisonTimestamp(b)-comparisonTimestamp(a));}
function latestAnyComparison(presetId){return historyFor(presetId)[0]||null;}
function runningComparison(presetId){return historyFor(presetId).find(comparison=>!isTerminal(comparison))||null;}
function comparisonFor(presetId,mode=selectedMode){
 if(pending.has(presetId)&&!expanding.has(presetId))return null;
 const history=historyFor(presetId),selected=historySelections.get(presetId+':'+mode),matching=history.filter(comparison=>comparisonMode(comparison)===mode);
 return matching.find(comparison=>comparison.id===selected)||history.find(comparison=>!isTerminal(comparison))||matching.find(comparison=>(comparison.jobs||[]).some(isJobReady))||matching[0]||null;
}
function historyMarkup(presetId,current){
 const history=historyFor(presetId);if(!history.length)return '';
 const options=history.map(comparison=>{
  const stamp=comparisonTimestamp(comparison),date=stamp?new Date(stamp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Saved attempt',ready=(comparison.jobs||[]).filter(isJobReady).length;
  const label=(comparisonMode(comparison)==='draft'?'Draft':'Comparison')+' · '+date+' · '+(!isTerminal(comparison)?'in progress':ready?ready+' ready':'no video')+(comparison.selectedJobId?' · picked':'');
  return `<option value="${esc(comparison.id)}" ${current?.id===comparison.id?'selected':''}>${esc(label)}</option>`;
 }).join('');
 return `<div class="saved-takes"><label for="savedTakeSelect">Saved takes <span>${history.length} ${history.length===1?'attempt':'attempts'}</span></label><select id="savedTakeSelect" ${pending.has(presetId)?'disabled':''}>${current?'':'<option value="" selected>Choose a saved take…</option>'}${options}</select><p>Open an earlier take without generating again.</p></div>`;
}
function generationModeFor(comparison){return comparison&&!modeExplicitlySelected?comparisonMode(comparison):selectedMode;}
function modelOptions(mode){return config?.modelOptions?.[mode]||(mode==='draft'?(config?.draftModel?[config.draftModel]:[]):mode==='second'?(config?.secondModel?[config.secondModel]:[]):config?.models||[]);}
function modeModels(mode){
 const options=modelOptions(mode),count=mode==='draft'?1:2,defaults=mode==='draft'?[config?.draftModel?.id]:(config?.models||[]).map(model=>model.id),ids=modelSelections.get(mode)||defaults;
 const selected=[...new Set(ids)].map(id=>options.find(model=>model.id===id)).filter(Boolean);
 for(const model of options)if(selected.length<count&&!selected.some(choice=>choice.id===model.id))selected.push(model);
 const result=selected.slice(0,count);modelSelections.set(mode,result.map(model=>model.id));return result;
}
function modeEstimate(mode){const models=modeModels(mode);return models.length&&models.every(model=>model.estimatedCost!==undefined&&model.estimatedCost!==null&&Number.isFinite(Number(model.estimatedCost)))?models.reduce((sum,model)=>sum+Number(model.estimatedCost),0):null;}
function quoteCeiling(estimate){return estimate===null?null:Number(Number(estimate).toFixed(6));}
function modeAction(mode){return mode==='draft'?'Review draft':'Review two videos';}
function modeSpecs(mode){return mode==='draft'?'ONE CLIP / 480p':'TWO MODELS / 720p';}
function jobSpecs(job,model={}){return [job.resolution||model.resolution,job.duration||model.duration?(job.duration||model.duration)+' sec':'',job.aspectRatio||model.aspectRatio].filter(Boolean).join(' · ');}
function modelChoiceLabel(model){return (model.name||model.id).replace(/^[^:]+:\s*/,'')+' · '+estimatePrice(model.estimatedCost);}
function modelChooserMarkup(mode,location,disabled=false){
 const selected=modeModels(mode),options=modelOptions(mode),estimate=modeEstimate(mode),count=mode==='draft'?1:2;
 return `<div class="model-chooser" data-model-chooser="${location}"><div class="model-chooser-top"><span>${location==='drawer'?'Next attempt':'Choose your '+(mode==='draft'?'model':'models')}</span><strong>Est. ${estimate===null?'unavailable':estimatePrice(estimate)}</strong></div><div class="model-choice-fields">${Array.from({length:count},(_,slot)=>`<label for="${location}Model${slot}">${count===1?'Draft model':'Model '+(slot+1)}<select id="${location}Model${slot}" data-model-mode="${mode}" data-model-slot="${slot}" ${disabled||!options.length?'disabled':''}>${options.length?options.map(model=>`<option value="${esc(model.id)}" ${selected[slot]?.id===model.id?'selected':''} ${selected.some((choice,index)=>index!==slot&&choice.id===model.id)?'disabled':''}>${esc(modelChoiceLabel(model))}</option>`).join(''):'<option>Models loading…</option>'}</select></label>`).join('')}</div><p>${esc(selected[0]?jobSpecs({},selected[0]):mode==='draft'?'480p · one clip':'720p · two clips')} · Cost is an estimate; final usage is reported after generation.</p></div>`;
}
function bindModelChoosers(root){root.querySelectorAll('[data-model-mode]').forEach(select=>select.onchange=()=>{
 const mode=select.dataset.modelMode,slot=Number(select.dataset.modelSlot),ids=modeModels(mode).map(model=>model.id);ids[slot]=select.value;
 if(new Set(ids).size!==ids.length)return;modelSelections.set(mode,ids);submissionErrors.clear();refreshUI();$(select.id)?.focus();
});}
function secondModelFor(comparison){const options=modelOptions('second').filter(model=>model.id!==comparison?.jobs?.[0]?.model),id=secondModelSelections.get(comparison?.id)||config?.secondModel?.id;return options.find(model=>model.id===id)||options[0]||null;}
function updateModePicker(){
 $('draftMode').setAttribute('aria-pressed',String(selectedMode==='draft'));$('compareMode').setAttribute('aria-pressed',String(selectedMode==='compare'));
 $('draftMode').disabled=config?.draftEnabled===false||pending.size>0;$('compareMode').disabled=!!config&&config.generationEnabled===false||pending.size>0;
 const draftEstimate=modeEstimate('draft'),compareEstimate=modeEstimate('compare');
 $('draftModeDetail').textContent='480p · one clip'+(draftEstimate!==null?' · est. '+estimatePrice(draftEstimate):'');
 $('compareModeDetail').textContent='Two models · 720p'+(compareEstimate!==null?' · est. '+money(compareEstimate):'');
 $('generationModeNote').textContent=selectedMode==='draft'?'Start with one lower-resolution draft. Try a second model only if you want another take.':'Generate two 720p takes together and choose your favorite.';
 $('studioActionHint').textContent=selectedMode==='draft'?'Choose a brief to review your draft and cost.':'Choose a brief to review both models and cost.';
 $('referenceNote').textContent=selectedMode==='draft'?'Your first take, then your call.':'Compare both results and choose the stronger take.';
 $('generateFromNotes').innerHTML=esc(modeAction(selectedMode))+' <span aria-hidden="true">↗</span>';
 $('studioModelChooser').innerHTML=modelChooserMarkup(selectedMode,'studio',pending.size>0);bindModelChoosers($('studioModelChooser'));
}
$('draftMode').onclick=()=>{selectedMode='draft';modeExplicitlySelected=true;submissionErrors.clear();refreshUI();};$('compareMode').onclick=()=>{selectedMode='compare';modeExplicitlySelected=true;submissionErrors.clear();refreshUI();};
function balanceMarkup(){const allowance=config?.demoBudget;if(allowance&&Number.isFinite(Number(allowance.remaining))&&allowance.remaining!==null)return `<div class="balance-chip"><small>LOCAL DEMO LIMIT LEFT (EST.)</small><strong>${money(allowance.remaining)}</strong></div>`;return `<div class="balance-chip"><small>LOCAL DEMO LIMIT (EST.)</small><strong>${!config||config.needsUnlock?'Log in to view':'Unavailable'}</strong></div>`;}
function demoBudgetMarkup(){
 const budget=config?.demoBudget,balance=config?.balance,purchased=balance?.kind==='purchased_credits'&&balance.remaining!==null&&Number.isFinite(Number(balance.remaining));
 const accountLine=purchased?`<span class="account-credit">Reported purchased-credit remainder: <b>${money(balance.remaining)}</b></span><small>Coupon credit is not verified by this check.</small>`:'';
 if(!budget)return accountLine?`<p class="demo-budget">${accountLine}</p>`:'';
 return `<p class="demo-budget"><strong>Local demo spending cap (estimated)</strong><span>Cap ${money(budget.cap)} · reserved ${money(budget.reserved)} · available ${money(budget.remaining)}</span><small>This app limit is separate from OpenRouter account credits.</small>${accountLine}</p>`;
}
function jobFailure(job){
 const status=normalizeStatus(job.status),message=String(job.errorMessage||job.error||'').slice(0,600),httpStatus=Number(job.errorStatus)||Number(message.match(/HTTP\s*(\d{3})/i)?.[1])||null;
 const rejected=job.rejected===true||job.submissionStatus==='rejected'||status==='rejected'||!job.jobId&&/^Submission rejected\b/i.test(message);
 const unknown=job.submissionStatus==='unknown'||status==='unknown';
 const failed=rejected||['failed','error','expired','cancelled','canceled'].includes(status);
 return {rejected,unknown,failed,httpStatus,message,payment:rejected&&(httpStatus===402||/payment required|insufficient (?:credit|fund|balance)/i.test(message))};
}
function paymentBlocked(){return config?.generationBlocked?.reason==='payment';}
function needsPaymentAcknowledgement(){return paymentBlocked()&&config.generationBlocked.requiresPaymentAcknowledgement!==false;}
async function refreshBalance(){
 const results=await Promise.allSettled([api('/balance'),api('/config')]);
 if(config){config.balance=results[0].status==='fulfilled'?(results[0].value.balance??null):null;if(results[1].status==='fulfilled'){config.demoBudget=results[1].value.demoBudget;config.needsUnlock=results[1].value.needsUnlock;config.generationBlocked=results[1].value.generationBlocked||null;}}
 refreshUI();if($('ownerBudget'))$('ownerBudget').innerHTML=demoBudgetMarkup();
}
function canGenerate(mode=selectedMode){return !!config?.configured&&(mode==='draft'?config.draftEnabled===true:config.generationEnabled!==false)&&!config.needsUnlock;}
function generationReason(){if(configError)return 'The studio is temporarily unavailable.';if(!config||config.needsUnlock)return 'Log in to use Michelle’s OpenRouter account.';if(!config.configured)return 'Add your OpenRouter key to connect the studio.';if(config.generationBlocked?.reason==='payment')return config.generationBlocked.preflight?'Studio validation stopped the request before video submission. '+(config.generationBlocked.message||'Review the studio limit before trying again.'):'A previous OpenRouter submission was rejected for funding or key limits. Check the current key before a new paid attempt.';if(config.generationEnabled===false)return config.disabledReason||'Live generation is currently paused.';return '';}
function refreshUI(){
 syncLoginUI();
 updateModePicker();
 if($('ownerBudget'))$('ownerBudget').innerHTML=demoBudgetMarkup();
 const notice=$('studioNotice');notice.classList.toggle('warning',!canGenerate()||paymentBlocked());
 notice.innerHTML=canGenerate()&&!paymentBlocked()?'Studio ready · using Michelle’s OpenRouter account. Choose a brief and press its red button.':esc(generationReason()||'Connecting to the studio…')+(configError?' <button id="retryConnection">Reconnect</button>':paymentBlocked()?` <a href="https://openrouter.ai/activity" target="_blank" rel="noopener noreferrer">View activity ↗</a>`:` <button id="openSettingsInline">${config&&!config.needsUnlock?'Connect studio':'Log in'}</button>`);
 $('retryConnection')?.addEventListener('click',()=>refreshConfig().catch(error=>toast(error.message)));$('openSettingsInline')?.addEventListener('click',openSettings);
 if(config?.demoBudget&&config.demoBudget.remaining!==null&&Number.isFinite(Number(config.demoBudget.remaining)))$('balanceFootnote').textContent='Local demo limit left (estimated): '+money(config.demoBudget.remaining)+' · separate from OpenRouter credits';else $('balanceFootnote').textContent='Log in to use Michelle’s OpenRouter account.';
 labScene.generationMode=selectedMode;labScene.jobStates={};
 $('briefList').innerHTML=presets.map((preset,index)=>{
  const comparison=comparisonFor(preset.id),busy=pending.has(preset.id)||!!runningComparison(preset.id),status=busy?'running':comparison?.status||'idle';labScene.jobStates[preset.id]=status;
  const mode=comparison?comparisonMode(comparison):pendingModes.get(preset.id)||selectedMode,estimate=modeEstimate(selectedMode),oneDraft=mode==='draft'&&(comparison?.jobs?.length||1)===1;
  const stateLabel=busy?normalizeStatus(comparison?.status)==='unknown'?'No usable video · submission uncertain.':oneDraft&&!expanding.has(preset.id)?'Generating one cheap draft…':'Generating videos…':comparison?isTerminal(comparison)?(comparison.jobs||[]).some(isJobReady)?oneDraft?'Your draft is ready.':'Comparison ready to review.':comparison.jobs?.length&&comparison.jobs.every(job=>jobFailure(job).rejected)?'Rejected before generation · no video.':'No usable video · review the error.':'Generation in progress.':estimate!==null?(selectedMode==='draft'?'480p draft · est. ':'Two models · est. ')+estimatePrice(estimate):selectedMode==='draft'?'One 480p draft':'Two models · one shared brief';
  return `<article class="brief-card"><div class="brief-card-top"><img src="${esc(safeMediaURL(preset.productImage))}" alt="${esc(preset.name)} reference"><div><span>SAMPLE BRIEF 0${index+1}</span><h3>${esc(preset.name)}</h3></div></div><p>${esc(stateLabel)}</p><div class="brief-card-actions"><button class="notes-link" data-notes="${esc(preset.id)}">Read the notes ↗</button><button class="red-action" data-generate="${esc(preset.id)}" ${busy?'disabled':''}>${busy?'Generating…':comparison?oneDraft?'View draft':'View comparison':modeAction(selectedMode)} <span aria-hidden="true">↗</span></button></div></article>`;
 }).join('');
 $('briefList').querySelectorAll('[data-notes]').forEach(b=>b.onclick=()=>openNotes(b.dataset.notes));$('briefList').querySelectorAll('[data-generate]').forEach(b=>b.onclick=()=>startComparison(b.dataset.generate));labScene.render();if(!$('studioDrawer').hidden)renderDrawer();
}
async function refreshConfig(){
 try{const data=await api('/config');config=data;configError='';if(config.draftEnabled===false&&selectedMode==='draft')selectedMode='compare';
  if(Array.isArray(data.presets)&&data.presets.length){presets=DEFAULT_PRESETS.map(fallback=>({...fallback,...data.presets.find(p=>p.id===fallback.id)}));for(const extra of data.presets)if(!presets.some(p=>p.id===extra.id))presets.push(extra);presets=presets.slice(0,3);labScene.setPresets(presets);}
  for(const comparison of data.comparisons||[])if(comparison.presetId)storeComparison(comparison.presetId,comparison);
  refreshUI();schedulePolling();return data;
 }catch(error){configError=error.message;refreshUI();throw error;}
}
function openNotes(id){const preset=presetById(id);if(!preset)return;notesPresetId=id;$('notesTitle').textContent=preset.name;$('promptInput').value=promptFor(preset);$('promptInput').disabled=!!comparisonFor(id)&&!isTerminal(comparisonFor(id));$('notesReferences').innerHTML=`<div class="notes-reference"><img src="${esc(safeMediaURL(preset.productImage))}" alt="${esc(preset.name)} reference"><small>PRODUCT REFERENCE</small></div><div class="notes-reference"><img src="${esc(safeMediaURL(preset.meiliImage))}" alt="Meili reference"><small>MEILI REFERENCE</small></div>`;$('notesStatus').textContent='';$('generateFromNotes').disabled=pending.has(id)||!!comparisonFor(id)&&!isTerminal(comparisonFor(id));if($('productUrlInput'))$('productUrlInput').value=preset.productUrl||'';renderImportedReferences();$('notesDialog').showModal();}
$('savePrompt').onclick=()=>{if(!notesPresetId)return;const text=$('promptInput').value.trim();if(!text){$('notesStatus').textContent='Enter a prompt for this shot.';return;}draftPrompts.set(notesPresetId,text);$('notesDialog').close();toast('Prompt notes saved for this session.');};
$('generateFromNotes').onclick=()=>{if(!notesPresetId)return;const id=notesPresetId,text=$('promptInput').value.trim();if(!text){$('notesStatus').textContent='Enter a prompt for this shot.';return;}draftPrompts.set(id,text);$('notesDialog').close();startComparison(id);};
function openDrawer(id){const preset=presetById(id);if(!preset)return;activePresetId=id;drawerTrigger=document.activeElement;$('studioDrawer').hidden=false;$('drawerScrim').hidden=false;document.body.style.overflow='hidden';renderDrawer();refreshVisibleNotes();$('closeDrawer').focus();}
function closeDrawer(){flushNotes();$('drawerContent').querySelectorAll('video').forEach(video=>video.pause());$('studioDrawer').hidden=true;$('drawerScrim').hidden=true;document.body.style.overflow='';drawerTrigger?.focus?.();}
$('closeDrawer').onclick=closeDrawer;$('drawerScrim').onclick=closeDrawer;
addEventListener('keydown',event=>{
 if($('studioDrawer').hidden)return;if(event.key==='Escape'){event.preventDefault();closeDrawer();return;}if(event.key!=='Tab')return;
 const list=[...$('studioDrawer').querySelectorAll('button:not([disabled]),a[href],video[controls],input,textarea,select:not([disabled])')].filter(el=>!el.hidden&&!el.closest('[hidden]')),first=list[0],last=list.at(-1);
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});
function statusText(comparison){
 if(expanding.has(activePresetId))return 'Submitting your optional second take. Your first draft stays here.';
 if(pending.has(activePresetId)&&!comparison)return (pendingModes.get(activePresetId)||selectedMode)==='draft'?'Submitting one 480p draft…':'Sending the same brief to two video models…';
 if(submissionErrors.has(activePresetId))return submissionErrors.get(activePresetId);
 if(!comparison)return submissionErrors.get(activePresetId)||(selectedMode==='draft'?'Start with one 480p draft from your chosen model. A second model is optional.':'Ready when you are. Two models will receive this brief.');
 if(normalizeStatus(comparison.status)==='unknown')return 'Submission uncertain. A video job or charge may exist. Check OpenRouter activity; retries are held.';
 const jobs=comparison.jobs||[],ready=jobs.filter(isJobReady).length,rejected=jobs.filter(job=>jobFailure(job).rejected).length,payment=jobs.some(job=>jobFailure(job).payment);
 if(isTerminal(comparison)){
  if(comparisonMode(comparison)==='draft'&&jobs.length===1&&ready===1)return 'Your 480p draft is ready. Keep this take, or explicitly try a second model.';
  if(ready===2)return 'Both videos are ready. Watch them, then choose your favorite.';
  if(ready===1)return rejected?'One video is ready. The other submission was rejected before a video job was created.':'One video is ready. The other video job did not finish successfully.';
  if(jobs.length&&rejected===jobs.length)return payment?'OpenRouter rejected these submissions before creating video jobs: HTTP 402, payment required. Check account credit and the saved key’s spending limit.':'OpenRouter rejected these submissions before creating video jobs. Review each reason below.';
  return comparison.error||'These attempts produced no videos. Review the job errors below before submitting another paid pair.';
 }
 if(comparisonMode(comparison)==='draft'&&jobs.length===1)return 'Your selected model is making the first draft. No second model has been submitted.';
 return ready===1?'One video is ready. The other model is still working…':'Two models are working on your shot. This can take a few minutes.';
}
function updatePlaybackStatus(video,state,message=''){
 video.dataset.playbackState=state;video.dataset.playbackMessage=message;
 const card=video.closest('.model-card'),feedback=card?.querySelector('.video-feedback'),badge=card?.querySelector('.model-badge');
 if(!feedback)return;
 feedback.hidden=state==='ready';feedback.classList.toggle('buffering',state==='buffering');feedback.classList.toggle('failed',state==='error');
 feedback.querySelector('p').textContent=message||'Loading saved video…';feedback.querySelector('button').hidden=!['error','slow'].includes(state);
 if(badge)badge.textContent=state==='error'?'PLAYBACK ISSUE':state==='loading'||state==='slow'?'LOADING':badge.dataset.readyLabel;
}
function watchPlayback(video){
 const retry=video.closest('.model-card').querySelector('[data-retry-playback]');
 retry.onclick=()=>{updatePlaybackStatus(video,'loading');video.load();};
 if(video.dataset.playbackBound){updatePlaybackStatus(video,video.dataset.playbackState||'loading',video.dataset.playbackMessage);return;}
 video.dataset.playbackBound='true';
 const clear=()=>clearTimeout(video.playbackTimer),loading=()=>{clear();updatePlaybackStatus(video,'loading');video.playbackTimer=setTimeout(()=>{if(video.isConnected&&video.readyState<1&&!video.error)updatePlaybackStatus(video,'slow','This saved video is taking longer to load. Retry playback or open the video below.');},12000);};
 const ready=()=>{clear();updatePlaybackStatus(video,'ready');};
 video.addEventListener('loadstart',loading);
 for(const event of ['loadedmetadata','loadeddata','canplay','playing'])video.addEventListener(event,ready);
 video.addEventListener('waiting',()=>{if(video.readyState>=1)updatePlaybackStatus(video,'buffering','Buffering…');});
 video.addEventListener('pause',()=>{if(!video.error&&video.readyState>=1)ready();});
 video.addEventListener('error',()=>{clear();const code=video.error?.code;updatePlaybackStatus(video,'error',code===3?'This browser could not decode the saved video. Try opening it below.':code===4?'The saved video could not be opened in this browser. Retry playback or open it below.':'The saved video could not load. Retry playback or open it below.');});
 if(video.error)video.dispatchEvent(new Event('error'));else if(video.readyState>=1)ready();else loading();
}
function noteDraft(jobId){
 if(!noteDrafts.has(jobId))noteDrafts.set(jobId,{jobId,text:'',baseText:'',revision:0,updatedAt:null,loaded:false,dirty:false,error:'',conflict:null,loadPromise:null,savePromise:null,timer:null,flush:false,keepalive:false});
 return noteDrafts.get(jobId);
}
function noteMarkup(job){
 if(!config||config.needsUnlock)return '<div class="take-note-login"><button type="button" data-note-login>Log in to view or add notes</button></div>';
 const state=noteDraft(job.id),inputId='note-'+job.id;
 return `<div class="take-note-editor" data-note-job="${esc(job.id)}"><label for="${esc(inputId)}">Notes <span data-note-count>${state.text.length}/2000</span></label><textarea id="${esc(inputId)}" data-note-input maxlength="2000" rows="3" placeholder="What works? What would you change?">${esc(state.text)}</textarea><div class="take-note-status"><span data-note-status role="status"></span><button type="button" data-note-retry hidden>Retry save</button></div><div class="take-note-conflict" hidden><p>A newer note was saved elsewhere. Your text is still here.</p><details><summary>View saved note</summary><pre data-note-current></pre></details><div><button type="button" data-note-use-saved>Use saved note</button><button type="button" data-note-use-mine>Save my version</button></div></div></div>`;
}
function noteEditors(jobId){return [...document.querySelectorAll('.take-note-editor')].filter(editor=>editor.dataset.noteJob===jobId);}
function syncNoteView(state){
 for(const editor of noteEditors(state.jobId)){
  const input=editor.querySelector('[data-note-input]');if(input.value!==state.text)input.value=state.text;
  editor.querySelector('[data-note-count]').textContent=state.text.length+'/2000';
  const status=state.conflict?'Choose which version to keep.':state.savePromise?'Saving…':state.error?state.error:state.loadPromise&&!state.loaded?'Loading saved notes…':state.dirty?'Unsaved changes':state.loaded?state.updatedAt?'Saved':'Autosaves':'Notes ready to load';
  editor.querySelector('[data-note-status]').textContent=status;
  editor.querySelector('[data-note-retry]').hidden=!state.error||!!state.conflict||!!state.savePromise;
  editor.querySelector('[data-note-retry]').textContent=config?.needsUnlock?'Log in':state.dirty?'Retry save':'Retry loading';
  editor.querySelector('.take-note-conflict').hidden=!state.conflict;
  editor.querySelector('[data-note-current]').textContent=state.conflict?.note||'(Empty note)';
 }
}
function acceptSavedNote(state,saved){state.text=String(saved.note||'');state.baseText=state.text;state.revision=Number(saved.revision)||0;state.updatedAt=saved.updatedAt;state.loaded=true;state.dirty=false;state.conflict=null;state.error='';}
async function loadNote(jobId){
 const state=noteDraft(jobId);if(!config||config.needsUnlock||state.savePromise)return;
 if(state.loadPromise)return state.loadPromise;
 state.error='';
 state.loadPromise=(async()=>{try{
  const saved=await api('/videos/'+encodeURIComponent(jobId)+'/notes');
  if(!state.dirty||saved.note===state.text)acceptSavedNote(state,saved);
  else if(Number(saved.revision)!==state.revision)state.conflict=saved;
  else{state.baseText=String(saved.note||'');state.dirty=state.text!==state.baseText;state.updatedAt=saved.updatedAt;state.loaded=true;}
 }catch(error){const locked=error.status===401||error.status===403;if(locked&&config){config.needsUnlock=true;syncLoginUI();}state.error=locked?'Log in again to save notes. Your text is kept here.':'Could not load notes. Your text is kept here.';}
 finally{state.loadPromise=null;syncNoteView(state);}})();
 syncNoteView(state);return state.loadPromise;
}
function queueNoteSave(state){clearTimeout(state.timer);if(!state.conflict&&state.dirty)state.timer=setTimeout(()=>{state.timer=null;saveNote(state.jobId);},700);}
async function saveNote(jobId){
 const state=noteDraft(jobId);clearTimeout(state.timer);state.timer=null;
 if(state.savePromise)return state.savePromise;
 if(!state.dirty||state.conflict||!config||config.needsUnlock)return;
 if(state.loadPromise)await state.loadPromise;
 if(!state.loaded){await loadNote(jobId);if(!state.loaded)return;}
 if(!state.dirty||state.conflict||state.savePromise)return;
 const text=state.text,revision=state.revision;state.error='';
 state.savePromise=(async()=>{try{
  const saved=await api('/videos/'+encodeURIComponent(jobId)+'/notes',{method:'POST',body:{note:text,revision},keepalive:state.keepalive});
  state.baseText=String(saved.note??text);state.revision=Number(saved.revision);state.updatedAt=saved.updatedAt;state.loaded=true;state.dirty=state.text!==state.baseText;state.conflict=null;
 }catch(error){
  if(error.status===409&&error.current){if(error.current.note===state.text)acceptSavedNote(state,error.current);else state.conflict=error.current;}
  else{const locked=error.status===401||error.status===403;if(locked&&config){config.needsUnlock=true;syncLoginUI();}state.error=locked?'Log in again to save. Your text is kept here.':'Could not save. Your text is kept here.';}
 }finally{
  state.savePromise=null;syncNoteView(state);
  if(state.dirty&&!state.conflict&&!state.error){if(state.flush)saveNote(jobId);else queueNoteSave(state);}else state.flush=false;
 }})();
 syncNoteView(state);return state.savePromise;
}
function flushNotes(keepalive=false){for(const state of noteDrafts.values())if(state.dirty||state.savePromise){state.flush=true;state.keepalive=keepalive;void saveNote(state.jobId);}}
addEventListener('pagehide',()=>flushNotes(true));
addEventListener('beforeunload',event=>{if([...noteDrafts.values()].some(state=>state.dirty||state.savePromise)){flushNotes(true);event.preventDefault();event.returnValue='';}});
function refreshVisibleNotes(){if(config&&!config.needsUnlock)for(const editor of document.querySelectorAll('.take-note-editor'))void loadNote(editor.dataset.noteJob);}
function bindNoteEditor(editor){
 const state=noteDraft(editor.dataset.noteJob);syncNoteView(state);
 if(editor.dataset.bound)return;editor.dataset.bound='true';
 const input=editor.querySelector('[data-note-input]');
 input.addEventListener('input',()=>{state.text=input.value;state.dirty=state.text!==state.baseText;state.error='';syncNoteView(state);queueNoteSave(state);});
 input.addEventListener('focus',()=>{if(!renderingDrawer)void loadNote(state.jobId);});
 input.addEventListener('blur',()=>{if(!renderingDrawer)void saveNote(state.jobId);});
 editor.querySelector('[data-note-retry]').onclick=()=>config?.needsUnlock?openSettings():state.dirty?saveNote(state.jobId):loadNote(state.jobId);
 editor.querySelector('[data-note-use-saved]').onclick=()=>{if(!state.conflict)return;clearTimeout(state.timer);acceptSavedNote(state,state.conflict);syncNoteView(state);};
 editor.querySelector('[data-note-use-mine]').onclick=()=>{if(!state.conflict)return;state.baseText=String(state.conflict.note||'');state.revision=Number(state.conflict.revision);state.updatedAt=state.conflict.updatedAt;state.loaded=true;state.conflict=null;state.dirty=state.text!==state.baseText;state.error='';syncNoteView(state);void saveNote(state.jobId);};
 if(!state.loaded&&!state.loadPromise)void loadNote(state.jobId);
}
function renderModel(job,index,comparison){
 const knownModels=[...modelOptions('draft'),...modelOptions('compare'),...modelOptions('second')],model=knownModels.find(m=>m.id===job.model&&(!job.resolution||m.resolution===job.resolution))||knownModels.find(m=>m.id===job.model)||(config?.models||[])[index]||{},ready=isJobReady(job),failure=jobFailure(job),selected=comparison?.selectedJobId===job.id,cost=job.cost??job.actualCost,estimate=job.estimatedCost??model.estimatedCost,reportedCost=!failure.rejected&&cost!==undefined&&cost!==null;
 const heading=failure.rejected?(failure.payment?'Payment required. No video job created.':'Submission rejected. No video job created.'):failure.unknown?'Submission uncertain.':failure.failed?'The video job did not finish.':comparison||pending.has(activePresetId)?'A little movie is on its way.':'Your video will appear here.';
 const reason=[failure.httpStatus?'HTTP '+failure.httpStatus:'',failure.message||(!comparison?'No generation started yet.':failure.unknown?'Check OpenRouter activity before another attempt.':failure.failed?'Review OpenRouter activity for this video job.':'You can keep exploring while it works.')].filter(Boolean).join(' · ');
 const player=ready?`<video controls playsinline preload="metadata" src="${esc(safeVideoURL(job.videoUrl))}" aria-label="${esc(job.name||model.name||'Model '+(index+1))} generated video"></video><div class="video-feedback" role="status"><p>Loading saved video…</p><button class="secondary-button" type="button" data-retry-playback hidden>Retry playback</button></div>`:`<div class="video-placeholder">${failure.failed||failure.unknown?'<span aria-hidden="true">!</span>':'<div class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></div>'}<p>${esc(heading)}</p><small>${esc(reason)}</small>${failure.payment?'<a class="error-help-link" href="https://openrouter.ai/settings/credits" target="_blank" rel="noopener noreferrer">Check OpenRouter credits ↗</a>':''}</div>`;
 const billingNote=failure.rejected?'Pre-run estimate only. No video job was created; verify any charge in OpenRouter activity.':reportedCost?'Cost reported by OpenRouter.':failure.unknown?'Actual charge unconfirmed. This estimate is not a billing record.':failure.failed?'Actual charge not reported. Check OpenRouter activity.':'Estimate only. OpenRouter reports the final cost when available.';
 const reservationNote=Number(job.releasedEstimate)>0?' Local reservation released: '+money(job.releasedEstimate)+'.':'';
 return `<article class="model-card${selected?' selected':''}"><header><div><h4>${esc(job.name||model.name||'Model '+(index+1))}</h4><small>${esc(job.model||model.id||'Waiting for model configuration')}</small><p class="model-spec">${comparison?'Requested: ':'Settings: '}${esc(jobSpecs(job,model))}</p></div><span class="model-badge" data-ready-label="${selected?'PICKED':'READY'}">${selected?'PICKED':ready?'READY':failure.rejected?'REJECTED':failure.unknown?'UNCERTAIN':failure.failed?'FAILED':comparison||pending.has(activePresetId)?'WORKING':'PREVIEW'}</span></header><div class="video-stage">${player}</div><footer><div class="model-cost"><span>${reportedCost?'OPENROUTER REPORTED COST':'PRE-RUN ESTIMATE'}</span><strong>${reportedCost?money(cost):estimatePrice(estimate)}</strong></div><p class="billing-note">${esc(billingNote+reservationNote)}</p><button class="pick-button" data-select="${esc(job.id||'')}" ${!ready||selected?'disabled':''}>${selected?'✓ Your selected shot':'Keep this take'}</button>${ready?`<a class="video-download" href="${esc(safeVideoURL(job.videoUrl))}" target="_blank" rel="noopener noreferrer">Open video ↗</a>${noteMarkup(job)}`:''}</footer></article>`;
}
function renderSecondModel(comparison,busy){
 const model=secondModelFor(comparison)||{},options=modelOptions('second').filter(choice=>choice.id!==comparison?.jobs?.[0]?.model),canRequest=!!model.id&&!!comparison?.canRequestSecondModel&&isTerminal(comparison)&&!busy&&!expanding.has(activePresetId),submitting=expanding.has(activePresetId),requiresAck=needsPaymentAcknowledgement(),estimate=model.estimatedCost;
 return `<article class="model-card second-model-card"><header><div><h4>${esc(model.name||'Second model')}</h4><small>${esc(model.id||'Optional alternate take')}</small><p class="model-spec">Optional: ${esc(jobSpecs({},model))}</p></div><span class="model-badge">OPTIONAL</span></header><div class="video-stage"><div class="video-placeholder"><span aria-hidden="true">＋</span><p>${submitting?'Submitting your second take…':'Want another take?'}</p><small>${submitting?'One additional request. Your first draft is preserved.':canRequest?'Try a different model at 720p after reviewing the 480p draft.':!model.id?'The alternate model is currently unavailable.':comparison&&isTerminal(comparison)?'This saved draft cannot request another model.':'Available after the first draft finishes. Nothing runs automatically.'}</small></div></div><footer><label class="second-model-choice" for="secondModelChoice">Alternate model<select id="secondModelChoice" ${!canRequest?'disabled':''}>${options.map(choice=>`<option value="${esc(choice.id)}" ${choice.id===model.id?'selected':''}>${esc(modelChoiceLabel(choice))}</option>`).join('')}</select></label><div class="model-cost"><span>SECOND CLIP ESTIMATE</span><strong>${estimatePrice(estimate)}</strong></div><p class="draft-action-note" id="secondModelNote">${canRequest?'This submits one additional video and may incur a new charge.':'No second video has been requested.'}</p><button class="red-action" id="trySecondModel" ${!canRequest||requiresAck?'disabled':''}>${submitting?'Submitting…':'Review second take'+(estimate!==undefined?' · est. '+estimatePrice(estimate):'')} ↗</button></footer></article>`;
}
function renderDrawer(){
 const preset=presetById(activePresetId);if(!preset)return;
 const comparison=comparisonFor(activePresetId),busy=pending.has(activePresetId)||!!runningComparison(activePresetId),mode=comparison?comparisonMode(comparison):pendingModes.get(activePresetId)||selectedMode,newMode=generationModeFor(comparison),previous=latestAnyComparison(activePresetId);
 const previewModels=modeModels(mode),jobs=comparison?.jobs?.length?comparison.jobs:(previewModels.length?previewModels:mode==='draft'?[{}]:[{},{}]).slice(0,mode==='draft'?1:2).map(model=>({id:'',model:model.id,name:model.name,status:busy?'queued':'idle',estimatedCost:model.estimatedCost,resolution:model.resolution,duration:model.duration,aspectRatio:model.aspectRatio}));
 const oneDraft=mode==='draft'&&jobs.length===1;
 $('drawerTitle').textContent=oneDraft?'Your first draft.':'Video comparison';
 const existingVideos=new Map([...$('drawerContent').querySelectorAll('video')].map(video=>[video.src,{video,playing:!video.paused}]));
 const existingNotes=new Map([...$('drawerContent').querySelectorAll('.take-note-editor')].map(editor=>[editor.dataset.noteJob,editor]));
 const focused=document.activeElement,focusedNote=focused?.matches('[data-note-input]')?{jobId:focused.closest('.take-note-editor').dataset.noteJob,start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection}:null;
 const blocked=paymentBlocked(),needsAcknowledgement=needsPaymentAcknowledgement(),uncertain=normalizeStatus(comparison?.status)==='unknown'||jobs.some(job=>jobFailure(job).unknown),endedWithoutVideo=!!comparison&&isTerminal(comparison)&&!jobs.some(isJobReady),showActivity=endedWithoutVideo||uncertain||blocked;
 const actionNote=uncertain?'Check OpenRouter activity first. A job or charge may exist, so this submission cannot be retried here.':blocked?'Resolve the account credit or key spending limit before another attempt. Nothing is retried automatically.':busy?'An attempt for this brief is running. You can review saved takes while it finishes.':comparison||previous?(newMode==='draft'?'A new draft submits one 480p video with your selected model. Earlier attempts stay in Saved takes.':'A new comparison submits two 720p videos and may incur new charges.'):'Review your prompt and references before starting.';
 const acknowledgement=needsAcknowledgement&&!busy?'<label class="payment-acknowledgement"><input type="checkbox" id="paymentAcknowledgement"> I checked OpenRouter credit and the saved key’s spending limit.</label>':'';
 const nextEstimate=modeEstimate(newMode),estimateSuffix=nextEstimate===null?'':' · est. '+estimatePrice(nextEstimate),newAction=(newMode==='draft'?'Review new draft':'Review new comparison')+estimateSuffix;
 const actionButton=busy?`<button class="secondary-button" disabled>${uncertain?'Retry held':'Generation in progress'}</button>`:comparison?`<button class="secondary-button" id="regenerateComparison" ${needsAcknowledgement?'disabled':''}>${esc(newAction)} ↗</button>`:submissionErrors.has(activePresetId)&&!blocked?'<button class="secondary-button" id="checkSubmission">Check studio status</button>':`<button class="red-action" id="beginComparison" ${needsAcknowledgement?'disabled':''}>${esc(modeAction(newMode)+estimateSuffix)} ↗</button>`;
 const statusMessage=submissionErrors.has(activePresetId)?statusText(comparison):blocked&&!comparison?generationReason()+' No video request has been submitted for this brief.':statusText(comparison);
 const contextLabel=mode==='draft'?(oneDraft?'CHEAP DRAFT / ONE 480p CLIP':'DRAFT 480p + ALTERNATE 720p'):'COMPARE / TWO 720p CLIPS';
 renderingDrawer=true;
 $('drawerContent').innerHTML=`<div class="comparison-context"><div><h3>${esc(preset.name)}</h3><p>${contextLabel}</p></div>${balanceMarkup()}</div>${historyMarkup(activePresetId,comparison)}${demoBudgetMarkup()}<div class="comparison-status${endedWithoutVideo||uncertain||blocked?' failed':''}" role="status">${esc(statusMessage)}${showActivity?'<a class="error-help-link" href="https://openrouter.ai/activity" target="_blank" rel="noopener noreferrer">View OpenRouter activity ↗</a>':''}</div><div class="model-grid">${jobs.slice(0,2).map((job,index)=>renderModel(job,index,comparison)).join('')}${oneDraft?renderSecondModel(comparison,busy):''}</div>${jobs.some(isJobReady)?'<p class="notes-privacy">Notes are shared with logged-in demo users.</p>':''}${mode==='draft'&&!oneDraft?'<p class="draft-only-label">The first take is a 480p draft; the alternate is 720p. Compare the creative result with those settings in mind.</p>':''}${!busy?modelChooserMarkup(newMode,'drawer'):''}${acknowledgement}<div class="comparison-actions"><p>${esc(actionNote)}</p>${actionButton}</div><details class="drawer-prompt"><summary>View the prompt &amp; references</summary><p>${esc(comparison?.prompt||promptFor(preset))}</p><p>Product reference + Meili reference${(importedReferences.get(preset.id)||[]).length?' + selected product photos':''}.</p></details>`;
 $('savedTakeSelect')?.addEventListener('change',event=>{
  const chosen=comparisonHistory.get(event.target.value);if(!chosen||chosen.presetId!==activePresetId)return;
  flushNotes();selectedMode=comparisonMode(chosen);modeExplicitlySelected=true;historySelections.set(activePresetId+':'+selectedMode,chosen.id);submissionErrors.delete(activePresetId);refreshUI();refreshVisibleNotes();$('savedTakeSelect')?.focus();
 });
 $('drawerContent').querySelectorAll('[data-select]').forEach(button=>button.onclick=()=>selectJob(button.dataset.select));
 $('beginComparison')?.addEventListener('click',()=>confirmRegeneration(activePresetId));
 bindModelChoosers($('drawerContent'));
 $('secondModelChoice')?.addEventListener('change',event=>{secondModelSelections.set(comparison.id,event.target.value);renderDrawer();$('secondModelChoice')?.focus();});
 $('drawerContent').querySelectorAll('[data-note-login]').forEach(button=>button.onclick=openSettings);
 $('regenerateComparison')?.addEventListener('click',()=>confirmRegeneration(activePresetId));
 $('trySecondModel')?.addEventListener('click',()=>confirmSecondModel(activePresetId));
 $('checkSubmission')?.addEventListener('click',async()=>{try{await refreshConfig();toast('Studio status refreshed.');}catch(error){toast(error.message);}});
 $('paymentAcknowledgement')?.addEventListener('change',event=>{const button=$('regenerateComparison')||$('beginComparison');if(button){button.disabled=!event.target.checked;button.dataset.confirm='';button.textContent=comparison?newAction+' ↗':modeAction(mode)+' ↗';}const second=$('trySecondModel');if(second){second.disabled=!event.target.checked||!comparison?.canRequestSecondModel||busy;second.dataset.confirm='';second.textContent='Try second model ↗';}});
 for(const video of $('drawerContent').querySelectorAll('video')){const old=existingVideos.get(video.src);if(old){video.replaceWith(old.video);existingVideos.delete(video.src);if(old.playing)old.video.play().catch(()=>{});}watchPlayback(old?.video||video);}
 for(const {video}of existingVideos.values()){video.pause();clearTimeout(video.playbackTimer);}
 for(const editor of $('drawerContent').querySelectorAll('.take-note-editor')){const old=existingNotes.get(editor.dataset.noteJob);if(old)editor.replaceWith(old);bindNoteEditor(old||editor);}
 if(focusedNote){const editor=noteEditors(focusedNote.jobId)[0],input=editor?.querySelector('[data-note-input]');if(input){input.focus({preventScroll:true});input.setSelectionRange(focusedNote.start,focusedNote.end,focusedNote.direction);}}
 renderingDrawer=false;
}
async function startComparison(id,regenerate=false,paymentAcknowledged=false,mode=selectedMode,reviewed=false){
 const preset=presetById(id);if(!preset)return;const current=comparisonFor(id),previous=latestAnyComparison(id);
 if(pending.has(id)||runningComparison(id)){openDrawer(id);return;}
 if(current&&!regenerate||previous&&!regenerate){openDrawer(id);return;}
 if(!reviewed){openDrawer(id);return;}
 if(!canGenerate(mode)){toast(generationReason()||'This generation mode is currently unavailable.');openSettings();return;}
 if(needsPaymentAcknowledgement()&&!paymentAcknowledged){openDrawer(id);return;}
 const modelIds=modeModels(mode).map(model=>model.id),maxEstimatedCost=quoteCeiling(modeEstimate(mode));
 if(modelIds.length!==(mode==='draft'?1:2)||maxEstimatedCost===null){toast('Choose available models with a current estimate first.');return;}
 const signature=JSON.stringify({mode,modelIds,prompt:promptFor(preset),referenceUrls:importedReferences.get(id)||[]});
 const requestId=!pendingRequestIds.has(id)||pendingRequestSignatures.get(id)!==signature?(crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)):pendingRequestIds.get(id);pendingRequestSignatures.set(id,signature);
 historySelections.delete(id+':'+mode);pendingRequestIds.set(id,requestId);pendingModes.set(id,mode);pending.add(id);submissionErrors.delete(id);openDrawer(id);refreshUI();
 try{
  const result=await api('/generate',{method:'POST',body:{presetId:id,mode,modelIds,maxEstimatedCost,prompt:promptFor(preset),requestId,regenerate,paymentAcknowledged,referenceUrls:importedReferences.get(id)||[]}}),comparison=result.comparison||result;
  if(!comparison.id)throw new Error('The studio did not return an attempt ID. Check status before trying again.');
  storeComparison(id,comparison);historySelections.set(id+':'+comparisonMode(comparison),comparison.id);pendingRequestIds.delete(id);pending.delete(id);pendingModes.delete(id);if(comparison.balance)config.balance=comparison.balance;refreshUI();schedulePolling();refreshBalance();
 }catch(error){
  pending.delete(id);pendingModes.delete(id);if(error.generationBlocked&&config)config.generationBlocked=error.generationBlocked;if(error.balance&&config)config.balance=error.balance;
  if(error.quoteChanged){await refreshConfig().catch(()=>{});toast('The estimate changed. Review the updated cost and confirm again.');return;}
  if(error.status===409&&error.comparisonId){try{const result=await api('/comparisons/'+encodeURIComponent(error.comparisonId)),existing=result.comparison||result;if(existing.id){storeComparison(id,existing);pendingRequestIds.delete(id);submissionErrors.delete(id);refreshUI();schedulePolling();toast('The existing attempt is saved. No new generations were submitted.');return;}}catch(restoreError){submissionErrors.set(id,restoreError.message);}}
  const message=error.preflight?'Studio validation stopped this request before video submission. '+error.message:error.message;submissionErrors.set(id,message);toast(message);refreshUI();
 }
}
function confirmRegeneration(id){
 const comparison=comparisonFor(id);if(pending.has(id)||runningComparison(id))return;
 const button=$('regenerateComparison')||$('beginComparison');if(!button)return;
 const paymentAcknowledged=needsPaymentAcknowledgement();if(paymentAcknowledged&&!$('paymentAcknowledgement')?.checked){toast('Check funding and the saved key’s limit before submitting another attempt.');return;}
 const mode=generationModeFor(comparison),regenerate=!!latestAnyComparison(id),estimate=modeEstimate(mode),models=modeModels(mode),count=mode==='draft'?'one 480p clip':'two 720p clips',quote=JSON.stringify({mode,modelIds:models.map(model=>model.id),maxEstimatedCost:quoteCeiling(estimate)});
 if(estimate===null||models.length!==(mode==='draft'?1:2)){toast('Choose available models with a current estimate first.');return;}
 if(button.dataset.confirm==='yes'&&button.dataset.quote===quote){startComparison(id,regenerate,paymentAcknowledged,mode,true);return;}
 button.dataset.quote=quote;
 button.dataset.confirm='yes';button.textContent=(mode==='draft'?'Confirm one paid draft':'Confirm two paid videos')+(estimate!==null?' · est. '+estimatePrice(estimate):'');
 const note=button.parentElement.querySelector('p');if(note)note.textContent='This submits '+count+' using '+models.map(model=>model.name||model.id).join(' + ')+'. Press again to confirm the estimated cost.';
}
function confirmSecondModel(id){
 const comparison=comparisonFor(id);if(!comparison||!comparison.canRequestSecondModel||!isTerminal(comparison)||pending.has(id)||expanding.has(id)||runningComparison(id))return;
 const button=$('trySecondModel');if(!button)return;
 const paymentAcknowledged=needsPaymentAcknowledgement();if(paymentAcknowledged&&!$('paymentAcknowledgement')?.checked){toast('Check funding and the saved key’s limit before another paid take.');return;}
 const model=secondModelFor(comparison);if(!model||model.estimatedCost===undefined){toast('Choose an alternate model with a current estimate.');return;}
 const quote=JSON.stringify({modelId:model.id,maxEstimatedCost:quoteCeiling(model.estimatedCost)});
 if(button.dataset.confirm==='yes'&&button.dataset.quote===quote){requestSecondModel(id,paymentAcknowledged);return;}
 button.dataset.confirm='yes';button.dataset.quote=quote;button.textContent='Confirm second take · est. '+estimatePrice(model.estimatedCost);
 $('secondModelNote').textContent='One additional '+(model.name||model.id)+' video at '+model.resolution+'. The 480p draft stays saved. Press again to submit.';
}
async function requestSecondModel(id,paymentAcknowledged=false){
 const comparison=comparisonFor(id);if(!comparison||!comparison.canRequestSecondModel||!isTerminal(comparison)||pending.has(id)||expanding.has(id)||runningComparison(id))return;
 const model=secondModelFor(comparison);if(!config?.configured||config.needsUnlock||!model){toast('The second model is currently unavailable.');return;}
 const key=comparison.id,requestId=secondRequestModels.get(key)===model.id&&secondRequestIds.get(key)||crypto.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);secondRequestIds.set(key,requestId);secondRequestModels.set(key,model.id);
 expanding.add(id);pending.add(id);submissionErrors.delete(id);refreshUI();
 try{
  const result=await api('/comparisons/'+encodeURIComponent(comparison.id)+'/second-model',{method:'POST',body:{requestId,modelId:model.id,maxEstimatedCost:quoteCeiling(model.estimatedCost),confirmed:true,paymentAcknowledged}}),updated=result.comparison||result;
  if(!updated.id)throw new Error('The second-take status is unavailable. Check the saved attempt before trying again.');
  storeComparison(id,updated);secondRequestIds.delete(key);expanding.delete(id);pending.delete(id);refreshUI();schedulePolling();refreshBalance();
 }catch(error){
  if(error.generationBlocked&&config)config.generationBlocked=error.generationBlocked;if(error.balance&&config)config.balance=error.balance;
  if(error.quoteChanged){expanding.delete(id);pending.delete(id);await refreshConfig().catch(()=>{});toast('The alternate model estimate changed. Review and confirm again.');return;}
  try{const result=await api('/comparisons/'+encodeURIComponent(comparison.id)),updated=result.comparison||result;if(updated.id)storeComparison(id,updated);}catch{}
  expanding.delete(id);pending.delete(id);const message=error.preflight?'Studio validation stopped the second take before video submission. '+error.message:error.message;submissionErrors.set(id,message);toast(message);refreshUI();schedulePolling();
 }
}
async function selectJob(jobId){const comparison=comparisonFor(activePresetId);if(!comparison||!jobId)return;try{const result=await api('/comparisons/'+encodeURIComponent(comparison.id)+'/select',{method:'POST',body:{jobId}}),updated=result.comparison||result;storeComparison(activePresetId,{...comparison,...updated,selectedJobId:updated.selectedJobId||jobId});refreshUI();toast('Your favorite is saved. A little taste makes all the difference.');}catch(error){toast(error.message);}}
let pollTimer=null,polling=false;
function schedulePolling(){clearTimeout(pollTimer);if([...comparisonHistory.values()].some(c=>!isTerminal(c)))pollTimer=setTimeout(pollComparisons,5000);}
async function pollComparisons(){if(polling){schedulePolling();return;}polling=true;const running=[...comparisonHistory.values()].filter(c=>!isTerminal(c)).map(c=>[c.presetId,c]);
 let becameTerminal=false;await Promise.allSettled(running.map(async([id,comparison])=>{try{const result=await api('/comparisons/'+encodeURIComponent(comparison.id)),updated=result.comparison||result;if(updated.id){const previous=JSON.stringify(comparisonFor(id));storeComparison(id,updated);if(updated.balance)config.balance=updated.balance;if(previous!==JSON.stringify(updated))refreshUI();if(isTerminal(updated)){becameTerminal=true;toast((presetById(id)?.name||'Your comparison')+((updated.jobs||[]).some(isJobReady)?' is ready to review.':(updated.jobs||[]).some(job=>jobFailure(job).rejected)?' was rejected before generation.':' ended without a usable video.'));}}}catch(error){if(error.status===401||error.status===403){config.needsUnlock=true;refreshUI();}}}));polling=false;schedulePolling();if(becameTerminal)refreshBalance();
}
function syncLoginUI(){
 const locked=!config||config.needsUnlock;
 $('ownerButton').innerHTML=(locked?'Log in':'Demo settings')+' <span aria-hidden="true">↗</span>';
 $('ownerButton').setAttribute('aria-label',locked?'Log in to demo':'Demo settings');
 $('settingsTitle').textContent=locked?'Welcome to the studio.':'The studio is yours.';
 $('loginIntro').textContent=locked?'Enter the demo password to generate with Michelle’s OpenRouter account. You don’t need your own account or API key.':config.configured?'You’re using Michelle’s saved OpenRouter key. Choose a sample brief and a generation mode.':'Connect OpenRouter once. Everyone with the demo password can then use these credits.';
 $('unlockForm').hidden=!locked;
 $('apiKeyPanel').hidden=locked;
 if(!locked&&!config.configured){$('apiKeyPanel').open=true;$('apiKeyPanel').querySelector('summary').textContent='Connect OpenRouter';}
 else $('apiKeyPanel').querySelector('summary').textContent='Change API key';
}
function openSettings(){syncLoginUI();$('settingsStatus').textContent=!config||config.needsUnlock?'':config.configured?'OpenRouter is connected. No additional account is needed.':'Add your OpenRouter key below.';if(!$('ownerBudget')){const budget=document.createElement('div');budget.id='ownerBudget';$('settingsStatus').before(budget);}$('ownerBudget').innerHTML=demoBudgetMarkup();if(!$('settingsDialog').open)$('settingsDialog').showModal();}
$('ownerButton').onclick=openSettings;
$('unlockForm').onsubmit=async event=>{event.preventDefault();const value=$('passcodeInput').value.trim();if(!value){$('settingsStatus').textContent='Enter the demo password.';return;}const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;passcode=value;$('passcodeInput').value='';$('settingsStatus').textContent='Opening the studio…';try{const data=await refreshConfig();if(data.needsUnlock){passcode='';try{sessionStorage.removeItem('meili-demo-passcode');}catch{}$('settingsStatus').textContent='That password didn’t match. Try again.';}else{try{sessionStorage.setItem('meili-demo-passcode',passcode);}catch{}if(data.configured){$('apiKeyPanel').open=false;$('settingsDialog').close();toast('You’re in. Choose a brief to generate with Michelle’s OpenRouter account.');}else $('settingsStatus').textContent='You’re in. Connect OpenRouter once below.';}}catch(error){$('settingsStatus').textContent=error.message;}finally{button.disabled=false;}};
$('apiKeyForm').onsubmit=async event=>{event.preventDefault();const apiKey=$('apiKeyInput').value.trim();$('apiKeyInput').value='';if(!apiKey){$('settingsStatus').textContent='Enter an OpenRouter API key.';return;}const button=event.currentTarget.querySelector('button');button.disabled=true;$('settingsStatus').textContent='Verifying the OpenRouter key…';try{await api('/settings',{method:'POST',body:{apiKey}});submissionErrors.clear();await refreshConfig();$('apiKeyPanel').open=false;$('settingsDialog').close();toast('OpenRouter is connected. Your demo is ready to share.');}catch(error){$('settingsStatus').textContent=error.message;}finally{button.disabled=false;}};
$('settingsDialog').addEventListener('close',()=>{$('apiKeyInput').value='';$('passcodeInput').value='';});

// Optional product-page references live in the notes dialog; the main workflow
// remains a single button per brief. Imported photos require explicit selection.
const importBlock=document.createElement('details');importBlock.className='reference-import';importBlock.innerHTML='<summary>Add photos from a product page</summary><label for="productUrlInput">Product URL</label><div class="reference-import-controls"><input id="productUrlInput" type="url" placeholder="https://brand.com/products/…"><button class="secondary-button" id="findReferences" type="button">Find photos</button></div><p class="notes-help" id="referenceImportStatus" role="status"></p><div class="imported-references" id="importedReferences"></div>';$('notesReferences').after(importBlock);
let foundReferences=[];
function renderImportedReferences(){if(!$('importedReferences'))return;const selected=importedReferences.get(notesPresetId)||[];const urls=[...new Set([...selected,...foundReferences])];$('importedReferences').innerHTML=urls.map(url=>`<button type="button" class="imported-reference${selected.includes(url)?' selected':''}" data-reference="${esc(url)}" aria-pressed="${selected.includes(url)}"><img src="${esc(safeMediaURL(url))}" alt="Imported product reference"><span>${selected.includes(url)?'✓ Selected':'Use photo'}</span></button>`).join('');$('importedReferences').querySelectorAll('[data-reference]').forEach(button=>button.onclick=()=>{const url=button.dataset.reference,current=importedReferences.get(notesPresetId)||[];if(current.includes(url))importedReferences.set(notesPresetId,current.filter(x=>x!==url));else if(current.length<2)importedReferences.set(notesPresetId,[...current,url]);else{toast('Choose up to two additional product photos.');return;}renderImportedReferences();});}
$('findReferences').onclick=async()=>{const url=$('productUrlInput').value.trim();if(!url){$('referenceImportStatus').textContent='Add a product page URL first.';return;}if(!safeMediaURL(url)||!/^https?:\/\//i.test(url)){$('referenceImportStatus').textContent='Use a full http or https product URL.';return;}const button=$('findReferences');button.disabled=true;$('referenceImportStatus').textContent='Looking for product photos…';foundReferences=[];try{const result=await api('/references',{method:'POST',body:{url}});foundReferences=(result.images||[]).map(image=>typeof image==='string'?image:image.url).filter(safeMediaURL);$('referenceImportStatus').textContent=foundReferences.length?'Choose up to two photos. '+(result.title||''):'No product photos were found on that page.';renderImportedReferences();}catch(error){$('referenceImportStatus').textContent=error.message;}finally{button.disabled=false;}};
$('notesDialog').addEventListener('close',()=>{foundReferences=[];$('referenceImportStatus').textContent='';});
refreshUI();refreshConfig().catch(()=>{});updateScroll();drawElevator();
window.meiliTakehomeSnapshot=()=>({apiBase:API_BASE,configured:!!config?.configured,needsUnlock:!!config?.needsUnlock,presets:presets.map(p=>p.id),selectedMode,comparisons:[...comparisonHistory.values()].map(c=>({id:c.id,presetId:c.presetId,mode:comparisonMode(c),status:c.status,jobs:c.jobs?.length||0,selectedJobId:c.selectedJobId})),pending:[...pending],scroll:{mailProgress,deliveryProgress},calm});
})();
