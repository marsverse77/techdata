(function deskApp(){
'use strict';
const $=id=>document.getElementById(id);
const app=$('app'), modal=$('modal');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={scan:'M8 3H4v4m12-4h4v4M4 17v4h4m12-4v4h-4M3 12h18',users:'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 7m0 4a4 4 0 0 1 3 4v2',check:'m5 12 4 4 10-10',clock:'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',plus:'M12 5v14M5 12h14',up:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',down:'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',camera:'M3 7h4l2-3h6l2 3h4v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',close:'m6 6 12 12M18 6 6 18',logout:'M10 4H4v16h6m-1-8h12m-5-5 5 5-5 5',pass:'M3 5h18v14H3zM7 9h4m-4 4h5m3-4h3v4h-3z',print:'M7 8V3h10v5M7 17H3V9h18v8h-4m-10-3h10v7H7z',link:'M10 14l4-4M8 16l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 6a3 3 0 0 0 4 0l4-4a3 3 0 0 0-4-4l-2 2',activity:'M2 12h5l3-7 4 14 3-7h5',lock:'M5 10h14v11H5zm3 0V7a4 4 0 0 1 8 0v3'};
const icon=(id)=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[id]}"/></svg>`;
const btn=(action,label,ic,cls='')=>`<button type="button" class="btn ${cls}" data-action="${action}">${ic?icon(ic):''}${label}</button>`;
const headers=['Full Name','Email','Country of origin','Company','Title'];
const keys=['name','email','country','company','title'];
let roster=[],tab='desk',page=0,query='',filter='',result=null,authenticated=false,serial=0,clock=null,stream=null,frame=0,cameraVersion=0,scanBusy=false,refreshGen=0;
const perPage=30;
const events=['Inspire','RLS'];
let currentEvent='Inspire';
function eventRoster(event=currentEvent){return roster.filter(g=>g.events?.[event]).map(g=>({...g,...g.events[event]}));}
function showSummary(){
 const bar=$('event-bar');if(!bar)return;
 bar.innerHTML=events.map(e=>{
  const list=eventRoster(e),count=list.filter(g=>g.present_at).length;
  return '<button type="button" data-event="'+e+'" aria-pressed="'+(e===currentEvent)+'"><strong>'+e+' Attendance</strong><span>'+count+' / '+list.length+' present</span></button>';
 }).join('');
}
const formatTime=timestamp=>new Date(timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const formatDate=timestamp=>new Date(timestamp).toLocaleString();
async function api(action,input){
 const opts={cache:'no-store',credentials:'same-origin'};
 if(input!==undefined)Object.assign(opts,{method:'POST',headers:{'Content-Type':'application/json','X-TechData-Request':'desk'},body:JSON.stringify(input)});
 let resp;
 try{resp=await fetch(`api.php?action=${action}`,opts)}catch(e){throw new Error('Connection lost. Reconnect and try again.');}
 let data;
 try{data=await resp.json()}catch(e){throw new Error('The server did not return a registration response. Please retry.');}
 if(!resp.ok){if(resp.status===401&&authenticated){authenticated=false;roster=[];if(modal.open)modal.close();authView(true);}throw new Error(data.error||'Request failed.');}
 return data;
}
function message(txt){$('notice').textContent=txt;clearTimeout(clock);clock=setTimeout(()=>$('notice').textContent='',4200);}
function authView(ready){
 $('session-tools').innerHTML='';
 app.innerHTML=`<section class="auth"><div class="auth-form"><div><p class="eyebrow">Registration desk</p><h1>${ready?'Staff sign-in':'Activate your desk'}</h1><p class="sub">${ready?'Sign in to manage guest passes and record arrivals.':'Use the private setup code from your hosting file manager to create the staff password.'}</p></div><form id="authform" class="stack">${ready?'':'<label>One-time setup code<input type="password" name="code" required autocomplete="off" spellcheck="false" autocapitalize="none"></label>'}<label>${ready?'Staff password':'Choose staff password'}<input type="password" name="password" required ${ready?'autocomplete="current-password"':'minlength="12" autocomplete="new-password"'}></label><p id="auth-error" class="error" hidden></p><button class="btn primary">${icon('lock')}${ready?'Sign in':'Activate registration desk'}</button></form></div><div class="art" aria-hidden="true"><div class="ticket"><div class="ticket-top"><span>TechData</span>${icon('pass')}</div><div class="ticket-mid"><span class="eyebrow">Event admission</span><strong>Guest<br>pass</strong></div><div class="ticket-bottom"><span>TECHDATA</span><span class="barcode"></span></div></div></div></section>`;
 $('authform').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{await api(ready?'login':'activate',Object.fromEntries(new FormData(form)));await startDesk();}
  catch(err){showError('auth-error',err.message);}
  finally{button.disabled=false;}
 };
}
function showError(id,txt){const el=$(id);if(el){el.hidden=false;el.textContent=txt;}}
function empty(ic,title,txt){return `<div class="empty"><span class="ico-box">${icon(ic)}</span><h3>${title}</h3><p>${txt}</p></div>`;}
function shell(){
 $('session-tools').innerHTML=`<button class="linkbtn" data-action="change-password" aria-label="Change staff password" title="Change staff password">${icon('lock')}</button><button class="linkbtn" data-action="logout">${icon('logout')}Sign out</button>`;
 app.innerHTML=`<div class="head"><div><h1>Registration desk</h1><p class="sub">${currentEvent} guest passes and attendance.</p></div><div class="actions">${btn('backup','Backup','lock')}${btn('import','Import manifest','up')}${btn('add','Add guest','plus','primary')}</div></div><div id="event-bar" class="event-bar" aria-label="Attendance by event"></div><nav class="tabs" aria-label="Registration views"><button class="tab" data-action="desk" ${tab==='desk'?'aria-current="page"':''}>${icon('scan')}Check-in desk</button><button class="tab" data-action="directory" ${tab==='directory'?'aria-current="page"':''}>${icon('users')}Guest directory</button></nav><div id="sync-error" class="error" hidden></div><div class="metrics" id="metrics"></div><div id="view"></div>`;
 if(tab==='desk'){
  $('view').innerHTML=`<div class="columns"><section class="panel dark"><div class="scanner-top"><span class="eyebrow">QR scanner</span><span class="ico-box">${icon('scan')}</span></div><h2>Scan for ${currentEvent}</h2><p class="sub">Scan a printed pass or phone screen with your QR reader.</p><form id="scanform" class="scanform"><input id="scan-id" aria-label="Guest pass code" placeholder="Scan or paste pass code" autocomplete="off" spellcheck="false" autocapitalize="none" required><button class="btn accent">Check in</button></form><button class="linkbtn" data-action="camera">${icon('camera')}Use camera</button><div id="scan-feedback" role="status" aria-live="polite"></div></section><section class="panel"><div class="panel-head"><h2>Recent arrivals</h2><span class="ico-box mint">${icon('activity')}</span></div><div id="recent"></div></section></div>`;
  $('scanform').onsubmit=e=>{e.preventDefault();const input=$('scan-id');const value=input.value;input.value='';runScan(value);};$('scan-id').focus();
 }else{
  $('view').innerHTML=`<section class="panel directory"><div class="panel-head"><h2>${currentEvent} attendance</h2>${btn('exports','Export','down')}</div><div class="filters"><input id="search" type="search" placeholder="Search name, email or company" aria-label="Search guests"><select id="filter" aria-label="Attendance status"><option value="">All statuses</option><option value="yes">Present</option><option value="no">Awaiting arrival</option></select></div><div id="table"></div><div class="desk-reset">${btn('reset','Reset '+currentEvent+' attendance','clock')}</div></section>`;
  $('search').value=query;$('filter').value=filter;
  $('search').oninput=e=>{query=e.target.value;page=0;drawTable();};
  $('filter').onchange=e=>{filter=e.target.value;page=0;drawTable();};
 }
 draw();
}
function metric(label,value,ic,clr){return `<div class="metric"><div><small>${label}</small><strong>${value.toLocaleString()}</strong></div><span class="ico-box ${clr}">${icon(ic)}</span></div>`;}
function draw(){
 if(!authenticated||!$('metrics'))return;
 showSummary();const list=eventRoster();const present=list.filter(g=>g.present_at);
 $('metrics').innerHTML=metric('Registered guests',list.length,'users','')+metric('Present',present.length,'check','mint')+metric('Awaiting arrival',list.length-present.length,'clock','sand');
 if(tab==='directory'){drawTable();return;}
 const recent=present.sort((a,b)=>b.present_at.localeCompare(a.present_at)).slice(0,6);
 $('recent').innerHTML=recent.length?`<ul class="recent">${recent.map(g=>`<li><span class="avatar">${esc(g.name.trim().split(/\s+/u).slice(0,2).map(w=>w[0]).join('').toUpperCase())}</span><div><strong>${esc(g.name)}</strong><small>${esc([g.category,g.company].filter(Boolean).join(' · '))}</small></div><time title="${esc(formatDate(g.present_at))}">${esc(formatTime(g.present_at))}</time></li>`).join('')}</ul>`:empty('clock','No arrivals yet','The latest check-ins will appear here as guests arrive.');
 const el=$('scan-feedback');
 if(result)el.innerHTML=`<div class="scan-result ${result.kind}"><strong>${esc(result.title)}</strong><br>${esc(result.details)}</div>`;
}
function drawTable(){
 const data=eventRoster().filter(g=>(!filter||Boolean(g.present_at)===(filter==='yes'))&&[...keys,'category'].some(k=>(g[k]||'').toLowerCase().includes(query.trim().toLowerCase()))).sort((a,b)=>a.name.localeCompare(b.name));
 page=Math.min(page,Math.max(0,Math.ceil(data.length/perPage)-1));
 const rows=data.slice(page*perPage,(page+1)*perPage);
 $('table').innerHTML=!rows.length?empty('users',roster.length?'No matching guests':'Your guest list is empty',roster.length?'Try another search or status.':'Add a guest or import your participant CSV to issue the first passes.'):
 `<div class="tablewrap"><table><thead><tr><th>Guest</th><th>Category</th><th>Company / title</th><th>Country of origin</th><th>Attendance</th><th>Pass</th></tr></thead><tbody>${rows.map(g=>`<tr><td class="identity"><strong>${esc(g.name)}</strong><small>${esc(g.email)}</small></td><td>${esc(g.category)||'—'}</td><td class="identity">${esc(g.company)||'—'}<small>${esc(g.title)}</small></td><td>${esc(g.country)||'—'}</td><td><span class="badge ${g.present_at?'yes':''}">${g.present_at?'Present':'Awaiting arrival'}</span></td><td><button class="btn" data-pass="${esc(g.id)}">${icon('pass')}View</button></td></tr>`).join('')}</tbody></table></div><div class="table-foot"><span>${page*perPage+1}–${page*perPage+rows.length} of ${data.length} guests</span>${data.length>perPage?`<div class="row">${btn('prev','Previous')}${btn('next','Next')}</div>`:''}</div>`;
 if(rows.length&&data.length>perPage){document.querySelector('[data-action=prev]').disabled=page===0;document.querySelector('[data-action=next]').disabled=(page+1)*perPage>=data.length;}
}
async function refresh(){
 const gen=++refreshGen;
 try{const d=await api('guests');if(!authenticated||gen!==refreshGen)return;roster=d.guests;draw();if($('sync-error'))$('sync-error').hidden=true;}
 catch(err){if(authenticated&&$('sync-error'))showError('sync-error','Guest list could not refresh. '+err.message);}
}
async function startDesk(){authenticated=true;tab='desk';result=null;roster=[];shell();await refresh();}
function showModal(title,body){
 if(modal.open)modal.close();
 $('modal-body').innerHTML=`<div class="panel-title"><h2>${title}</h2><button type="button" class="x" aria-label="Close dialog" data-action="close">${icon('close')}</button></div>${body}`;
 modal.setAttribute('aria-label',title);modal.showModal();
}
function formDialog(title,body,action,label){
 showModal(title,`<form id="edit" class="stack">${body}<p class="error" id="dialog-error" hidden></p><div class="dialog-actions">${btn('close','Cancel')}<button class="btn primary">${label}</button></div></form>`);
 $('edit').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const b=form.querySelector('button:not([type=button])');b.disabled=true;try{await action(form);}catch(err){showError('dialog-error',err.message);}finally{b.disabled=false;}};
}
function addGuest(){
 const fields=[['first','First name'],['last','Last name'],['category','Category'],['email','Email address'],['company','Company name'],['title','Job title'],['country','Country']];
 const event=currentEvent;
 formDialog(`Add guest to ${event}`,fields.map(([key,label])=>`<label>${label}<input name="${key}" ${key==='first'?'required':''} type="${key==='email'?'email':'text'}" maxlength="${key==='email'?254:180}"></label>`).join(''),async form=>{
  const guest=Object.fromEntries(new FormData(form));
  const res=await api('manifest',{rows:[{...guest,event}]});await refresh();modal.close();
  const created=eventRoster(event).find(g=>g.id===res.id);if(created)openPass(created);
  message(res.enrolled?'Guest registration saved.':'Guest details verified.');
 },'Save registration');
}
function parseCSV(text){
 text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/,1)[0];const delim=first.includes(',')?',':';';
 const rows=[];let row=[],val='',quoted=false,ended=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){val+='"';i++;}else if(c==='"'){quoted=false;ended=true;}else{val+=c;}continue;}
 if(c===delim){row.push(val);val='';ended=false;}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(val);if(row.some(s=>s.trim()))rows.push(row);row=[];val='';ended=false;}
 else if(c==='"'&&!val&&!ended)quoted=true;else if(ended||c==='"')throw Error('Check the quotation marks in your CSV.');else val+=c;
 }
 if(quoted)throw Error('A quoted field in the CSV was left open.');row.push(val);if(row.some(s=>s.trim()))rows.push(row);
 if(rows.length<2)throw Error('Add at least one guest beneath the header row.');
 return window.TechEventFiles.mapRows(rows,currentEvent);
}
function importGuests(){
 formDialog('Import participant manifest',`<p class="field-note">Excel imports use the Inspire and RLS sheets. CSV files import into ${currentEvent}. Matching emails keep their QR code and check-ins.</p><label>Manifest<input type="file" name="file" accept=".xlsx,.csv" required></label>`,async form=>{
  const file=form.elements.file.files[0];if(file.size>4*1024*1024)throw Error('Choose a manifest smaller than 4 MB.');
  const rows=/\.xlsx$/i.test(file.name)?await window.TechEventFiles.workbook(file):parseCSV(await file.text());
  const res=await api('manifest',{rows});modal.close();tab='directory';shell();await refresh();
  message(`${res.added} new passes · ${res.enrolled} new event registrations · ${res.updated} updated · ${res.skipped} unchanged`);
 },'Import participants');
}
function exportFile(name,rows){
 const cell=v=>{let s=String(v??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const blob=new Blob(['\uFEFF',rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
const passLink=id=>new URL('./',location.href).href+'#pass='+encodeURIComponent(id);
function qrMarkup(id){
 const m=window.TechQR(id),n=m.length;let path='';m.forEach((r,y)=>r.forEach((black,x)=>{if(black)path+=`M${x+4} ${y+4}h1v1h-1z`;}));
 return `<svg class="qr" role="img" aria-label="Unique guest QR code" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+8} ${n+8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
function passCard(g){return `<article class="qr-pass"><div class="pass-head"><span>TechData</span><span>Guest pass</span></div><h2>${esc(g.name)}</h2><p class="sub">${esc(g.company)}</p>${qrMarkup(g.id)}<code>${esc(g.id)}</code><div class="pass-foot">Present this QR code at the registration desk.</div></article>`;}
function printPasses(guests){
 $('printarea').innerHTML=guests.map(g=>qrMarkup(g.id)).join('');
 if(modal.open)modal.close();
 window.print();
}
window.addEventListener('afterprint',()=>$('printarea').replaceChildren());
function openPass(g){
 showModal('Guest pass',`${passCard(g)}<div class="row pass-actions"><button class="btn" id="copy">${icon('link')}Copy pass link</button><button class="btn primary" id="print">${icon('print')}Print pass</button></div><div id="copy-field"></div>`);
 $('copy').onclick=async()=>{const url=passLink(g.id);try{await navigator.clipboard.writeText(url);$('copy').textContent='Link copied';}catch{$('copy-field').innerHTML='<label>Guest pass link<input readonly id="pass-link"></label>';$('pass-link').value=url;$('pass-link').select();}};
 $('print').onclick=()=>printPasses([g]);
}
function codeFrom(value){
 const s=value.trim();if(/^TD-[0-9a-f]{24}$/i.test(s))return s.toUpperCase();
 try{const url=new URL(s);if(url.origin===location.origin){const id=new URLSearchParams(url.hash.slice(1)).get('pass');if(id&&/^TD-[0-9a-f]{24}$/i.test(id))return id.toUpperCase();}}catch{}
 throw Error('This is not a TechData pass. Scan the guest QR code again.');
}
let scanQueue=Promise.resolve();
function runScan(raw){
 const event=currentEvent;const task=async()=>{if(!authenticated)return;let confirmed=false;
 try{const id=codeFrom(raw),r=await api('scan',{id,event});confirmed=true;if(currentEvent===event)result={kind:r.duplicate?'duplicate':'',title:r.duplicate?'Already present':'Checked in',details:[event,r.guest.name,r.guest.category,formatDate(r.guest.present_at)].filter(Boolean).join(' · ')};if(authenticated)draw();}
 catch(err){if(currentEvent===event)result={kind:'error',title:'Check-in unsuccessful',details:err.message};if(authenticated)draw();}
 if(confirmed)await refresh();
 if(tab==='desk'&&!modal.open)$('scan-id')?.focus();};
 scanQueue=scanQueue.then(task,task);return scanQueue;
}
function stopCamera(){cameraVersion++;cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());stream=null;scanBusy=false;}
modal.addEventListener('close',()=>{if(!modal.open){stopCamera();if(tab==='desk')$('scan-id')?.focus();}});
let decoderPromise;
async function loadDecoder(){if(window.jsQR)return;if(!decoderPromise)decoderPromise=new Promise((resolve,reject)=>{const tag=document.createElement('script');tag.src='assets/jsQR.js';tag.onload=resolve;tag.onerror=()=>{decoderPromise=null;reject(Error('The QR reader could not load.'));};document.head.append(tag);});return decoderPromise;}
async function camera(){
 stopCamera();const version=cameraVersion;
 showModal('Scan with camera','<div class="stack"><video id="video" playsinline muted autoplay></video><p class="camera-help" id="camhelp">Allow camera access, then hold one guest pass in view.</p></div>');
 try{if(!navigator.mediaDevices?.getUserMedia)throw Error('Use HTTPS and a browser with camera support, or use a USB scanner.');
 await loadDecoder();if(!modal.open||version!==cameraVersion)return;
 const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1000}},audio:false});
 if(!modal.open||version!==cameraVersion){media.getTracks().forEach(t=>t.stop());return;}stream=media;
 const video=$('video');video.srcObject=media;await video.play();const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});let last=0;
 const loop=t=>{if(!modal.open||!stream||version!==cameraVersion)return;
 if(t-last>140&&video.readyState>=2&&video.videoWidth){last=t;const scale=Math.min(1,800/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);ctx.drawImage(video,0,0,canvas.width,canvas.height);const d=ctx.getImageData(0,0,canvas.width,canvas.height);const found=window.jsQR(d.data,d.width,d.height,{inversionAttempts:'attemptBoth'});if(found&&!scanBusy){scanBusy=true;stopCamera();modal.close();runScan(found.data);return;}}
 frame=requestAnimationFrame(loop);};frame=requestAnimationFrame(loop);
 }catch(e){if(version!==cameraVersion||!modal.open)return;stopCamera();$('camhelp').textContent=e.name==='NotAllowedError'?'Camera access was declined. Allow it in the browser, or use the scanner field.':e.message;}
}
async function exportPDFs(scope){
 const d=await api('guests');const people=d.guests.filter(g=>!scope||g.events[scope]);
 if(!people.length){message('There are no participants to export.');return;}
 showModal('Export QR passes','<p id="pdf-progress" role="status">Preparing individual PDFs…</p>');
 const progress=$('pdf-progress');
 const blob=await window.TechEventFiles.zipPasses(people,scope,(done,total)=>progress.textContent=`Preparing pass ${done} of ${total}…`);
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TechData-${scope||'All'}-QR-Passes.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 if(progress.isConnected&&modal.open)modal.close();message(`${people.length} individual PDFs exported.`);
}
async function backupDesk(button){
 button.disabled=true;try{
 const r=await api('backup',{});showModal('Backup saved',`<div class="stack"><p>Your guest records, QR assignments, and check-ins for both events are backed up on Hostinger.</p><p class="field-note">techdata-private/backups/<br>${esc(r.file)}</p>${btn('close','Done')}</div>`);
 }finally{button.disabled=false;}
}
function resetDesk(){
 const event=currentEvent;
 formDialog(`Reset ${event} attendance`,`<p class="field-note">This clears ${event} check-in times. Guest passes, registrations, and the other event’s attendance are preserved. A Hostinger backup is saved first.</p><label>Type RESET ${event}<input name="confirmation" autocomplete="off" required></label>`,async form=>{
  const res=await api('reset-attendance',{event,confirmation:form.elements.confirmation.value});modal.close();result=null;shell();await refresh();message(`${res.cleared} ${event} check-ins cleared. Backup saved.`);
 },'Reset attendance');
}
document.addEventListener('click',async e=>{
 const target=e.target.closest('button');if(!target)return;
 if(target.dataset.event){currentEvent=target.dataset.event;page=0;query='';filter='';result=null;shell();await refresh();return;}
 if(target.dataset.pass){const g=eventRoster().find(r=>r.id===target.dataset.pass);if(g)openPass(g);return;}
 const act=target.dataset.action;if(!act)return;
 try{switch(act){
 case 'close':modal.close();break;
 case 'change-password':
  formDialog('Change staff password','<label>Current password<input type="password" name="password" autocomplete="current-password" required></label><label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="12" maxlength="72" required></label>',async form=>{
   await api('change-password',Object.fromEntries(new FormData(form)));
   modal.close();
   message('Staff password updated.');
  },'Save password');
  break;
 case 'logout':await api('logout',{});authenticated=false;roster=[];result=null;authView(true);break;
 case 'desk':case 'directory':tab=act;shell();await refresh();break;
 case 'add':addGuest();break;case 'import':importGuests();break;case 'camera':await camera();break;
 case 'prev':page=Math.max(0,page-1);drawTable();break;case 'next':page++;drawTable();break;
 case 'backup':await backupDesk(target);break;
 case 'reset':resetDesk();break;
 case 'pdf-all':case 'pdf-event':await exportPDFs(act==='pdf-all'?null:currentEvent);break;
 case 'exports':showModal('Export guest list',`<div class="stack">${btn('pdf-all','Export all participants’ QR PDFs (ZIP)','down','primary')}${btn('pdf-event','Export '+currentEvent+' QR PDFs (ZIP)','down')}${btn('attendance','Download '+currentEvent+' attendance CSV','down')}${btn('links','Download guest pass links','link')}${btn('printall','Print all guest passes','print')}</div>`);break;
 case 'attendance':exportFile(`TechData-${currentEvent}-attendance.csv`,[[...headers,'Category','Attendance','Check-in time (UTC)'],...eventRoster().map(g=>[...keys.map(k=>g[k]),g.category||'',g.present_at?'Present':'Awaiting arrival',g.present_at??''])]);modal.close();break;
 case 'links':exportFile('TechData-pass-links.csv',[['Full Name','Email','Guest pass link'],...roster.map(g=>[g.name,g.email,passLink(g.id)])]);modal.close();break;
 case 'printall':if(!roster.length){modal.close();message('Add guests first to print passes.');}else printPasses(roster);break;
 }}catch(err){message(err.message);}
});
async function init(){
 const count=++serial;authenticated=false;roster=[];if(modal.open)modal.close();$('session-tools').innerHTML='';
 try{
 const id=new URLSearchParams(location.hash.slice(1)).get('pass');
 if(id!==null){const g=await api('pass',{id:codeFrom(id)});if(count!==serial)return;app.innerHTML=`<section class="public-pass">${passCard(g)}<button class="btn" id="public-print">${icon('print')}Print pass</button></section>`;$('public-print').onclick=()=>printPasses([g]);return;}
 const s=await api('session');if(count!==serial)return;if(s.active)await startDesk();else authView(s.ready);
 }catch(err){if(count!==serial)return;app.innerHTML=`<section class="public-pass stack"><h2>Unable to open this page</h2><p class="sub">${esc(err.message)}</p><button class="btn" id="retry">Try again</button></section>`;$('retry').onclick=init;}
}
window.addEventListener('hashchange',init);
setInterval(()=>{if(authenticated&&!document.hidden)refresh();},12000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authenticated)refresh();if(document.hidden&&stream)modal.close();});
init();
})();
