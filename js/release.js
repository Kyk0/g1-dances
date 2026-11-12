const $=id=>document.getElementById(id);
const make=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else n.setAttribute(k,v);}for(const c of children)if(c)n.append(c);return n;};
const search=$('card-search'),genre=$('card-genre'),routine=$('card-routine'),dialog=$('motion-dialog');
const sonic=$('sonic-video'),reference=$('reference-video'),compareSonic=$('compare-sonic'),compareReference=$('compare-reference');
const modeButtons=[...document.querySelectorAll('[data-mode]')],videos=[sonic,reference,compareSonic,compareReference];
const videoState=new WeakMap(),previewState=new WeakMap(),activePreviews=new Set();
let manifestSummary=null;let clips=[],featured=[],filtered=[],selected=null,mode='reference',galleryMode='reference',serial=0,selectionToken=0;
const SHOW_ALL=false;
let HOME_LIMIT=1000;   // show a fixed number first; the rest only on 'Show more' (no endless loading)
const spotIds=new Set();
const comparePlayback={generation:0,selection:0,sonicToken:0,referenceToken:0,desiredPlaying:false,blockers:new Set(),internalPauses:new WeakSet()};
const natural=(c,kind)=>kind==='sonic'?[c.video,c.preview_video,`web/sonic/${c.id}.mp4`]:[c.reference_video,`references/${c.id}.mp4`,c.reference_preview,`web/reference/${c.id}.mp4`];
const poster=(c,kind)=>kind==='reference'?(c.reference_thumbnail||c.reference_poster||c.thumbnail||c.poster):(c.thumbnail||c.poster);
const GENRE_COLORS={gPO:'#ff6b9a',gLO:'#ffb347',gHO:'#5fd4a8',gKR:'#ff6a4d',gLH:'#7aa8ff',gWA:'#c792ff',gJS:'#ffd166',gJB:'#7fe0ff',gMH:'#9be564',gBR:'#ff9f6e'};
const gcolor=g=>GENRE_COLORS[g]||'#ff7a59';
function unique(values){return [...new Set(values.filter(Boolean))];}
function candidates(c,kind){return unique(natural(c,kind));}
function isActive(video){return dialog.open&&(mode==='sonic'?video===sonic:mode==='reference'?video===reference:video===compareSonic||video===compareReference);}
function pauseCoordinated(video){if(video.paused)return;comparePlayback.internalPauses.add(video);video.pause();}
function pauseAll(){for(const v of videos)pauseCoordinated(v);}
function pauseComparePair(){pauseCoordinated(compareSonic);pauseCoordinated(compareReference);}
function clearComparePlayback(){comparePlayback.generation++;comparePlayback.selection=selectionToken;comparePlayback.desiredPlaying=false;comparePlayback.blockers.clear();}
function assignNext(video,state){
 if(state.index>=state.sources.length){if(isActive(video))$('video-error').hidden=false;return;}
 const path=state.sources[state.index++];state.expected=new URL(path,document.baseURI).href;video.poster=state.poster||'';
 if(state.time>0){const token=state.token;video.addEventListener('loadedmetadata',()=>{const current=videoState.get(video);if(current===state&&current.token===token&&current.selection===selectionToken&&selected?.id===state.clipId){try{video.currentTime=Math.min(state.time,Math.max(0,video.duration-.05));}catch{}}},{once:true});}
 video.src=path;video.load();
}
function loadVideo(video,c,kind,time=0){
 const paths=candidates(c,kind),key=`${c.id}:${kind}:${paths.join('|')}`;let state=videoState.get(video);
 if(state?.key===key){state.time=time;state.selection=selectionToken;if(video.readyState>0&&Number.isFinite(video.duration)){try{video.currentTime=Math.min(time,Math.max(0,video.duration-.05));}catch{}}return state;}
 pauseCoordinated(video);video.removeAttribute('src');video.load();state={key,clipId:c.id,selection:selectionToken,sources:paths,index:0,token:++serial,time,poster:poster(c,kind),expected:''};videoState.set(video,state);assignNext(video,state);return state;
}
function compareIsCurrent(generation){return dialog.open&&mode==='compare'&&Boolean(selected)&&generation===comparePlayback.generation&&comparePlayback.selection===selectionToken;}
function compareMediaIsCurrent(video,kind,generation=comparePlayback.generation){
 if(!compareIsCurrent(generation))return false;const state=videoState.get(video),expectedToken=video===compareSonic?comparePlayback.sonicToken:comparePlayback.referenceToken;
 return Boolean(state&&state.token===expectedToken&&state.selection===selectionToken&&state.key.startsWith(`${selected.id}:${kind}:`));
}
function syncReference(){if(mode!=='compare'||!selected)return;const t=compareSonic.currentTime;if(Number.isFinite(t)&&Math.abs(compareReference.currentTime-t)>.07){try{compareReference.currentTime=Math.min(t,Number.isFinite(compareReference.duration)?compareReference.duration:t);}catch{}}}
function updateCompareBufferBlockers(){
 for(const[video,key]of[[compareSonic,'sonic-buffer'],[compareReference,'reference-buffer']]){if(video.readyState<3)comparePlayback.blockers.add(key);else comparePlayback.blockers.delete(key);}
 if(compareSonic.seeking)comparePlayback.blockers.add('seeking');
}
function resumeComparePair(generation=comparePlayback.generation){
 if(!compareMediaIsCurrent(compareSonic,'sonic',generation)||!compareMediaIsCurrent(compareReference,'reference',generation)||!comparePlayback.desiredPlaying)return;
 updateCompareBufferBlockers();if(comparePlayback.blockers.size){pauseComparePair();return;}
 syncReference();compareReference.playbackRate=compareSonic.playbackRate;
 if(compareReference.paused)compareReference.play().catch(()=>{if(compareMediaIsCurrent(compareReference,'reference',generation)){comparePlayback.blockers.add('reference-buffer');pauseComparePair();$('video-error').hidden=false;}});
 if(compareSonic.paused)compareSonic.play().catch(()=>{if(compareMediaIsCurrent(compareSonic,'sonic',generation)){comparePlayback.desiredPlaying=false;pauseCoordinated(compareReference);$('video-error').hidden=false;}});
}
function startCompareSession(autoplay){
 comparePlayback.generation++;comparePlayback.selection=selectionToken;comparePlayback.sonicToken=videoState.get(compareSonic)?.token||0;comparePlayback.referenceToken=videoState.get(compareReference)?.token||0;comparePlayback.desiredPlaying=autoplay;comparePlayback.blockers.clear();compareReference.playbackRate=compareSonic.playbackRate||1;
 if(autoplay)resumeComparePair(comparePlayback.generation);
}
function compareWaiting(video,key,kind){const generation=comparePlayback.generation;if(!compareMediaIsCurrent(video,kind,generation))return;comparePlayback.blockers.add(key);pauseComparePair();}
function compareReady(video,key,kind){const generation=comparePlayback.generation;if(!compareMediaIsCurrent(video,kind,generation))return;if(video.readyState>=3)comparePlayback.blockers.delete(key);resumeComparePair(generation);}
function compareSeekStart(){const generation=comparePlayback.generation;if(!compareMediaIsCurrent(compareSonic,'sonic',generation))return;comparePlayback.blockers.add('seeking');pauseComparePair();}
function compareSeekEnd(){const generation=comparePlayback.generation;if(!compareMediaIsCurrent(compareSonic,'sonic',generation))return;comparePlayback.blockers.delete('seeking');syncReference();resumeComparePair(generation);}
function currentTime(){if(mode==='compare')return compareSonic.currentTime||0;if(mode==='reference')return reference.currentTime||0;return sonic.currentTime||0;}
function isPlaying(){return mode==='compare'?!compareSonic.paused:mode==='reference'?!reference.paused:!sonic.paused;}
function setModeButtons(){for(const b of modeButtons)b.setAttribute('aria-pressed',String(b.dataset.mode===mode));}
function setHash(){const u=new URL(location.href);if(selected)u.hash=new URLSearchParams({clip:selected.id,mode}).toString();else u.hash='';history.replaceState(null,'',u);}
function setFilterUrl(){const u=new URL(location.href);for(const k of['q','style','routine','page'])u.searchParams.delete(k);if(search.value.trim())u.searchParams.set('q',search.value.trim());if(genre.value)u.searchParams.set('style',genre.value);if(routine.value)u.searchParams.set('routine',routine.value);history.replaceState(null,'',u);}
function showMode(time=0,play=false){
 for(const v of videos){if(!isActive(v)){pauseCoordinated(v);videoState.delete(v);v.removeAttribute('src');v.load();}}
 if(selected){const hasS=!!selected.video;for(const b of modeButtons)if(b.dataset.mode!=='reference')b.hidden=!hasS;if(!hasS)mode='reference';}setModeButtons();$('sonic-view').hidden=mode!=='sonic';$('reference-view').hidden=mode!=='reference';$('compare-view').hidden=mode!=='compare';$('video-error').hidden=true;if(!selected||!dialog.open)return;
 if(mode==='sonic'){loadVideo(sonic,selected,'sonic',time);if(play)sonic.play().catch(()=>{});}
 else if(mode==='reference'){loadVideo(reference,selected,'reference',time);if(play)reference.play().catch(()=>{});}
 else{loadVideo(compareSonic,selected,'sonic',time);loadVideo(compareReference,selected,'reference',time);startCompareSession(play);}
 updateHDLink();
}
function updateHDLink(){$('hd-link').hidden=true;return;const link=$('hd-link'),kind=mode==='reference'?'reference':'sonic',path=mode==='reference'?selected?.reference_video:selected?.video;link.hidden=!selected||selected.has_hd===false||!path;if(!link.hidden){link.href=path;link.textContent=mode==='reference'?'Open full reference ↗':'Open full resolution ↗';}}
function updateDialogDetails(c){
 const number=featured.indexOf(c)+1;$('dialog-title').textContent=`${c.genre_name} #${String(number).padStart(3,'0')}`;$('dialog-meta').textContent=`${c.seconds.toFixed(1)} seconds · ${c.situation}`;
 $('detail-style').textContent=c.genre_name;$('detail-length').textContent=`${c.seconds.toFixed(1)} sec`;$('detail-routine').textContent=c.situation;
 
 $('source-info').textContent=`Clip ID: ${c.id} · Source: ${c.source_filename||c.source_file||c.seq||c.id} · SONIC local tracking error: ${c.zs_mpjpe_l} mm.`;updateHDLink();updateNavButtons();
}
function openClip(c,autoplay=true){
 if(!c)return;for(const v of document.querySelectorAll('#spot-tiles video'))v.pause();pauseCards();$('hero-video')?.pause();stopPreviews();selectionToken++;clearComparePlayback();pauseAll();selected=c;updateDialogDetails(c);if(!dialog.open)dialog.showModal();showMode(0,autoplay);setHash();
}
function closePlayer(){
 selectionToken++;clearComparePlayback();pauseAll();stopPreviews();for(const v of videos){videoState.delete(v);v.removeAttribute('src');v.load();}selected=null;setHash();
}
function switchMode(next){
 if(!['sonic','reference','compare'].includes(next)||next===mode)return;const time=currentTime(),playing=isPlaying();clearComparePlayback();pauseAll();mode=next;showMode(time,playing);setHash();
}
function match(c,q){return !q||[c.id,c.genre_name,c.genre,c.dancer,c.music,c.situation].join(' ').toLowerCase().includes(q);}
function stopPreviews(){for(const v of activePreviews){v.pause();v.removeAttribute('src');v.load();v.closest('.card-open')?.classList.remove('previewing');previewState.delete(v);}activePreviews.clear();}
function previewSources(c){return galleryMode==='reference'||!c.preview_video?unique([c.reference_preview,`web/reference/${c.id}.mp4`]):unique([c.preview_video,`web/sonic/${c.id}.mp4`]);}
function cardNumber(c){return String(featured.indexOf(c)+1).padStart(3,'0');}
function renderCards(reset=false){
 const q=search.value.trim().toLowerCase();filtered=featured.filter(c=>(genre.value||!spotIds.has(c.id))&&(!genre.value||c.genre===genre.value)&&(!routine.value||c.situation===routine.value)&&match(c,q));
 stopPreviews();const box=$('motion-cards');for(const v of box.querySelectorAll('video'))releaseCard(v);cardObserver?.disconnect();onScreen.clear();box.replaceChildren();box.setAttribute('aria-busy','false');
 $('gallery-status').textContent=filtered.length?'':'No motions found';
 if(!filtered.length)box.append(make('p',{class:'empty',text:'No dances found. Try another style.'}));
 let lastGenre=null;
 for(const c of filtered.slice(0,SHOW_ALL?filtered.length:HOME_LIMIT)){
  const image=make('img',{src:poster(c,galleryMode)||'',alt:'',loading:'lazy',decoding:'async',width:'960',height:'540'});image.addEventListener('error',()=>{if(c.poster&&image.src!==new URL(c.poster,document.baseURI).href)image.src=c.poster;},{once:true});const preview=make('video',{preload:'auto',muted:'',loop:'',autoplay:'',playsinline:'','aria-hidden':'true'});preview.muted=true;
  const open=make('button',{type:'button',class:'card-open','aria-label':`Open ${c.genre_name} dance number ${cardNumber(c)}`,title:'Open dance'},image,preview,make('span',{class:'card-play','aria-hidden':'true',text:'▶'}));open.addEventListener('click',()=>{mode=galleryMode;openClip(c,true);});preview.dataset.src=previewSources(c)[0]||'';
  const title=make('div',{class:'card-title'},make('span',{class:'card-num',text:String(filtered.indexOf(c)+1).padStart(2,'0')}),make('span',{class:'card-style',text:c.genre_name}));
  const info=make('div',{class:'card-info'},title);const card=make('article',{class:'motion-card',style:`--g:${gcolor(c.genre)}`},open,info);box.append(card);
 }
 $('see-all').hidden=filtered.length<=HOME_LIMIT;$('see-all').textContent=`Show ${filtered.length-HOME_LIMIT} more`;
 autoplayCards();
}
function updateNavButtons(){const i=filtered.findIndex(c=>c.id===selected?.id);$('previous-clip').disabled=!selected||i<=0;$('next-clip').disabled=!selected||i<0||i>=filtered.length-1;}
function moveSelection(step){const i=filtered.findIndex(c=>c.id===selected?.id),n=i+step;if(n<0||n>=filtered.length)return;openClip(filtered[n],true);}
async function copyText(text,button,label){try{await navigator.clipboard.writeText(text);button.textContent='Copied';}catch{button.textContent='Copy unavailable';}setTimeout(()=>button.textContent=label,1600);}
function handleRoute(){const params=new URLSearchParams(location.hash.slice(1)),id=params.get('clip'),clip=clips.find(c=>c.id===id),requestedMode=params.get('mode'),nextMode=['sonic','reference','compare'].includes(requestedMode)?requestedMode:mode;if(clip){if(selected?.id!==clip.id){mode=nextMode;openClip(clip,false);}else if(!dialog.open){mode=nextMode;dialog.showModal();showMode(0,false);}else if(nextMode!==mode)switchMode(nextMode);else setModeButtons();}else if(dialog.open)dialog.close();}

for(const b of modeButtons)b.addEventListener('click',()=>switchMode(b.dataset.mode));
compareSonic.addEventListener('timeupdate',syncReference);
compareSonic.addEventListener('play',()=>{const g=comparePlayback.generation;if(!compareMediaIsCurrent(compareSonic,'sonic',g))return;comparePlayback.desiredPlaying=true;resumeComparePair(g);});
compareSonic.addEventListener('pause',()=>{if(comparePlayback.internalPauses.has(compareSonic)){comparePlayback.internalPauses.delete(compareSonic);return;}const g=comparePlayback.generation;if(!compareMediaIsCurrent(compareSonic,'sonic',g))return;comparePlayback.desiredPlaying=false;pauseCoordinated(compareReference);});
compareSonic.addEventListener('waiting',()=>{if(compareMediaIsCurrent(compareSonic,'sonic')){comparePlayback.blockers.add('sonic-buffer');pauseComparePair();}});
compareReference.addEventListener('waiting',()=>{if(compareMediaIsCurrent(compareReference,'reference')){comparePlayback.blockers.add('reference-buffer');pauseComparePair();}});
for(const[v,key,kind]of[[compareSonic,'sonic-buffer','sonic'],[compareReference,'reference-buffer','reference']]){for(const event of['canplay','playing'])v.addEventListener(event,()=>{const g=comparePlayback.generation;if(!compareMediaIsCurrent(v,kind,g))return;if(v.readyState>=3)comparePlayback.blockers.delete(key);resumeComparePair(g);});}
compareSonic.addEventListener('seeking',()=>{if(compareMediaIsCurrent(compareSonic,'sonic')){comparePlayback.blockers.add('seeking');pauseComparePair();}});
compareSonic.addEventListener('seeked',()=>{if(compareMediaIsCurrent(compareSonic,'sonic')){comparePlayback.blockers.delete('seeking');syncReference();resumeComparePair();}});
compareSonic.addEventListener('ratechange',()=>{if(compareMediaIsCurrent(compareSonic,'sonic'))compareReference.playbackRate=compareSonic.playbackRate;});
compareSonic.addEventListener('ended',()=>{if(!compareMediaIsCurrent(compareSonic,'sonic'))return;comparePlayback.desiredPlaying=false;comparePlayback.blockers.clear();syncReference();pauseCoordinated(compareReference);});
for(const v of videos)v.addEventListener('error',()=>{const state=videoState.get(v);if(!state||!selected||!dialog.open||!isActive(v)||state.selection!==selectionToken)return;const active=v.currentSrc;if(active&&state.expected&&active!==state.expected)return;if(state.index<state.sources.length){assignNext(v,state);return;}$('video-error').hidden=false;});
$('close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',closePlayer);dialog.addEventListener('close',()=>setTimeout(playVisible,50));
$('previous-clip').addEventListener('click',()=>moveSelection(-1));$('next-clip').addEventListener('click',()=>moveSelection(1));
$('copy-link').addEventListener('click',()=>{if(selected)copyText(location.href,$('copy-link'),'↗');});
$('copy-citation').addEventListener('click',async()=>{try{const r=await fetch('docs/CITATION.bib');if(!r.ok)throw Error('citation unavailable');copyText((await r.text()).split('\n\n')[0],$('copy-citation'),'Copy required citation');}catch{$('copy-citation').textContent='Download citations instead';}});
for(const control of[search,genre,routine])control.addEventListener('input',()=>{renderCards(true);setFilterUrl();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){comparePlayback.desiredPlaying=false;pauseAll();stopPreviews();pauseCards();}else playVisible();});
window.addEventListener('hashchange',handleRoute);window.addEventListener('popstate',handleRoute);
// Every visible card plays automatically; offscreen media stays unloaded.
const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||navigator.connection?.saveData;
const onScreen=new Set();let cardObserver=null;
function playVisible(){
 if(calm()||dialog.open||document.hidden)return;
 const vids=[...document.querySelectorAll('#motion-cards .card-open video')].filter(v=>onScreen.has(v));
 vids.forEach(v=>{if(!v.getAttribute('src')&&v.dataset.src)v.src=v.dataset.src;v.play().then(()=>{if(v.isConnected&&onScreen.has(v)&&!dialog.open&&!v.paused)v.closest('.card-open')?.classList.add('previewing');}).catch(()=>{});});
}
function releaseCard(v){v.pause();v.closest('.card-open')?.classList.remove('previewing');if(v.getAttribute('src')){v.removeAttribute('src');v.load();}}
function autoplayCards(){
 if(!('IntersectionObserver'in window))return;
 if(!cardObserver)cardObserver=new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting)onScreen.add(e.target);else{onScreen.delete(e.target);e.target.pause();}}playVisible();},{threshold:0,rootMargin:'400px 0px'});
 for(const v of document.querySelectorAll('#motion-cards .card-open video')){if(!v.dataset.observed){v.dataset.observed='1';cardObserver.observe(v);}}
}
function pauseCards(){for(const v of document.querySelectorAll('#motion-cards .card-open video,#hero-strip video'))v.pause();}

{const hf=document.querySelector('meta[name="hf-dataset"]')?.content?.trim();if(hf&&/^https:\/\/huggingface\.co\//.test(hf))for(const a of document.querySelectorAll('.hf-link')){a.href=hf;a.hidden=false;a.rel='noopener';}}
$('see-all')?.addEventListener('click',e=>{e.preventDefault();HOME_LIMIT=1000;renderCards();});
function renderSpotlight(){
 const box=$('spot-tiles');if(!box)return;box.replaceChildren();spotIds.clear();
 const picks=['gHO','gBR','gWA'].map(g=>featured.find(c=>c.genre===g)).filter(Boolean);
 if(!picks.length){$('spotlight').hidden=true;return;}
 const io='IntersectionObserver'in window?new IntersectionObserver(es=>{for(const e of es){const v=e.target;if(e.isIntersecting&&!dialog.open&&!calm()){if(!v.getAttribute('src'))v.src=v.dataset.src;v.play().then(()=>v.closest('.spot-tile')?.classList.add('playing')).catch(()=>{});}else v.pause();}},{threshold:.3}):null;
 for(const c of picks){
  spotIds.add(c.id);
  const img=make('img',{src:poster(c,'reference')||'',alt:'',loading:'lazy',decoding:'async'});
  const v=make('video',{muted:'',loop:'',playsinline:'',preload:'none','aria-hidden':'true'});v.muted=true;v.dataset.src=unique([c.reference_preview,`web/reference/${c.id}.mp4`])[0]||'';
  const t=make('button',{type:'button',class:'spot-tile',style:`--g:${gcolor(c.genre)}`,'aria-label':`Play ${c.genre_name}`},img,v,make('span',{class:'spot-name',text:c.genre_name}));
  t.addEventListener('click',()=>{mode='reference';openClip(c,true);});box.append(t);io?.observe(v);
 }
 dialog.addEventListener('close',()=>{for(const v of box.querySelectorAll('video'))if(v.getAttribute('src')){const r=v.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight&&!calm())v.play().catch(()=>{});}});
}
function renderChips(){
 const box=$('style-chips');if(!box)return;box.replaceChildren();
 const counts=new Map();for(const c of clips)counts.set(c.genre,(counts.get(c.genre)||0)+1);
 const opts=[['','All',clips.length],...[...new Map(clips.map(c=>[c.genre,c.genre_name]))].sort((a,b)=>counts.get(b[0])-counts.get(a[0])).map(([g,n])=>[g,n,counts.get(g)])];
 for(const[g,name,n]of opts){
  const b=make('button',{type:'button',class:'chip','data-g':g,'aria-pressed':String(genre.value===g),style:`--g:${g?gcolor(g):'#eef1f6'}`},g?make('i',{class:'gdot','aria-hidden':'true'}):null,document.createTextNode(name));
  b.addEventListener('click',()=>{genre.value=g;genre.dispatchEvent(new Event('input'));});box.append(b);
 }
}
function syncChips(){for(const b of document.querySelectorAll('#style-chips .chip'))b.setAttribute('aria-pressed',String((b.dataset.g||'')===genre.value));}
function renderHero(){
 const box=$('hero-strip');if(!box)return;box.replaceChildren();
 const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches||navigator.connection?.saveData;
 const picks=featured.slice(0,5),tiles=[];
 for(const c of picks){
  const img=make('img',{src:poster(c,'sonic')||'',alt:'',loading:'eager'});
  const v=make('video',{muted:'',loop:'',playsinline:'',preload:'none','aria-hidden':'true'});v.muted=true;
  const t=make('button',{type:'button',class:'hero-tile',style:`--g:${gcolor(c.genre)}`,'aria-label':`Open ${c.genre_name} dance`},img,v,make('span',{class:'hero-label'},make('i',{class:'gdot','aria-hidden':'true'}),document.createTextNode(c.genre_name)));
  t.addEventListener('click',()=>openClip(c,true));box.append(t);
  if(!reduce){v.addEventListener('playing',()=>t.classList.add('playing'));tiles.push([v,c]);}
 }
 if(!tiles.length||!('IntersectionObserver'in window))return;
 const io=new IntersectionObserver(es=>{for(const e of es){const v=e.target.querySelector('video'),c=picks[[...box.children].indexOf(e.target)];if(e.isIntersecting&&!dialog.open){if(!v.src)v.src=previewSources(c)[0];v.play().catch(()=>{});}else v.pause();}},{threshold:.25});
 for(const t of box.children)io.observe(t);
 dialog.addEventListener('close',()=>{for(const t of box.children){const r=t.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight)t.querySelector('video')?.play().catch(()=>{});}});
 for(const t of box.children)t.addEventListener('click',()=>{for(const x of box.children)x.querySelector('video')?.pause();});
}
try{
 if(SHOW_ALL){document.body.classList.add('all-motions');$('hero-video')?.pause();$('library-back').hidden=false;}
 const response=await fetch('data/manifest.json');if(!response.ok)throw Error('manifest unavailable');const manifestJson=await response.json();clips=manifestJson.clips;manifestSummary=manifestJson.summary||null;
 // Lead with Waack, House and Break, then alternate styles and choreography variants.
 const styleOrder=['gHO','gBR','gWA','gKR','gPO','gLO','gLH','gMH','gJS','gJB'];
 const ranked=[...clips].sort((a,b)=>(Number(!!b.quality_ok)-Number(!!a.quality_ok))||((a.zs_mpjpe_l??Infinity)-(b.zs_mpjpe_l??Infinity)));
 const groups=new Map();
 for(const g of [...new Set([...styleOrder,...ranked.map(c=>c.genre)])]){
  const variants=new Map();
  for(const c of ranked.filter(c=>c.genre===g)){const key=c.id.replace(/_d\d+/, '_d').replace(/_m[^_]+/, '_m');if(!variants.has(key))variants.set(key,[]);variants.get(key).push(c);}
  const diverse=[];for(let i=0;diverse.length<ranked.filter(c=>c.genre===g).length;i++)for(const v of variants.values())if(v[i])diverse.push(v[i]);
  if(diverse.length)groups.set(g,diverse);
 }
 { // mixed order: fixed pseudo-random shuffle, never the same style twice in a row
  let s=20261111;const rnd=()=>((s=(s*1103515245+12345)%2147483648)/2147483648);const pool=[...groups.values()].flat();
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  while(pool.length){const last=featured[featured.length-1]?.genre;let k=pool.findIndex(c=>c.genre!==last);if(k<0)k=0;featured.push(pool.splice(k,1)[0]);}
 }
 for(const[id,name]of [...new Map(clips.map(c=>[c.genre,c.genre_name]))].sort((a,b)=>a[1].localeCompare(b[1])))genre.append(make('option',{value:id,text:name}));
 const query=new URLSearchParams(location.search);if(query.has('pick')){const u=new URL(location.href);u.searchParams.delete('pick');history.replaceState(null,'',u);}search.value=query.get('q')||'';genre.value=query.get('style')||'';routine.value=query.get('routine')||'';renderCards();if($('dance-count')&&manifestSummary?.source_sonic_pass_clips)$('dance-count').textContent=String(manifestSummary.source_sonic_pass_clips);{const hv=$('hero-video');if(hv&&!SHOW_ALL&&matchMedia('(max-width:640px)').matches&&!/hero_mobile/.test(hv.currentSrc)){hv.poster='media/hero_mobile_poster.jpg';hv.src='media/hero_mobile.mp4';hv.load();if(!calm())hv.play().catch(()=>{});}if(hv&&(calm()||SHOW_ALL))hv.pause();if(hv&&!SHOW_ALL){new IntersectionObserver(es=>{for(const e of es){if(e.isIntersecting&&!calm()&&!dialog.open)hv.play().catch(()=>{});else hv.pause();}}).observe(hv);dialog.addEventListener('close',()=>{if(!calm())hv.play().catch(()=>{});});}}genre.addEventListener('input',syncChips);
 const hash=new URLSearchParams(location.hash.slice(1)),initial=clips.find(c=>c.id===hash.get('clip'));if(initial){if(['sonic','reference','compare'].includes(hash.get('mode')))mode=hash.get('mode');openClip(initial,false);}
}catch(error){console.error(error);$('gallery-status').textContent='The dance library could not load. Refresh or download the dataset.';$('motion-cards').replaceChildren(make('p',{class:'error-state',text:'The catalog is unavailable.'}));}

for(const b of document.querySelectorAll('[data-gallery-mode]'))b.addEventListener('click',()=>{if(galleryMode===b.dataset.galleryMode)return;galleryMode=b.dataset.galleryMode;for(const button of document.querySelectorAll('[data-gallery-mode]'))button.setAttribute('aria-pressed',String(button===b));renderCards();});
