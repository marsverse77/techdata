(function eventFiles(){
'use strict';
const events=['Inspire','RLS'];
const scripts=new Map();
function library(src){
 if(!scripts.has(src)) scripts.set(src,new Promise((resolve,reject)=>{
  const tag=document.createElement('script');tag.src='assets/'+src;
  tag.onload=resolve;tag.onerror=()=>{scripts.delete(src);reject(Error('Could not load the file tools. Please retry.'));};
  document.head.append(tag);
 }));
 return scripts.get(src);
}
function xml(text){
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.querySelector('parsererror'))throw Error('This workbook contains unreadable XML.');
 return doc;
}
function elements(node,name){return Array.from(node.getElementsByTagNameNS('*',name));}
function mapRows(rows,event){
 const first=rows.findIndex(row=>row?.some(c=>String(c||'').trim()));
 if(first<0)return [];
 const header=rows[first].map(c=>String(c||'').trim().toLowerCase());
 function column(...names){return header.findIndex(h=>names.includes(h));}
 const fields={name:column('full name'),first:column('first name'),last:column('last name'),category:column('category'),company:column('company','company name'),country:column('country of origin','country'),title:column('title','job title'),email:column('email','email address')};
 if(fields.name<0&&(fields.first<0||fields.last<0))throw Error(`${event} needs First Name and Last Name columns, or Full Name.`);
 if(fields.email<0)throw Error(`${event} needs an Email or Email Address column. An individual email cell can be blank.`);
 return rows.slice(first+1).filter(row=>Object.values(fields).some(i=>i>=0&&String(row[i]||'').trim())).map(row=>{
  const obj={event};
  Object.entries(fields).forEach(([key,i])=>obj[key]=i<0?'':String(row[i]??'').trim());
  return obj;
 });
}
async function workbook(file){
 await library('jszip.min.js');const zip=await JSZip.loadAsync(file);
 async function part(path){const entry=zip.file(path);if(!entry)throw Error('Missing workbook part: '+path);return xml(await entry.async('string'));}
 const book=await part('xl/workbook.xml'),rels=await part('xl/_rels/workbook.xml.rels');
 const targets=new Map(elements(rels,'Relationship').map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
 const richText=n=>elements(n,'t').map(t=>t.textContent).join('');
 const strings=zip.file('xl/sharedStrings.xml')?elements(await part('xl/sharedStrings.xml'),'si').map(richText):[];
 const result=[];
 for(const sheet of elements(book,'sheet')){
  const event=events.find(e=>e.toLowerCase()===sheet.getAttribute('name').trim().toLowerCase());
  if(!event)continue;
  const path=targets.get(sheet.getAttribute('r:id'));if(!path)throw Error('Missing sheet '+event);
  const doc=await part(new URL(path,'https://workbook.local/xl/').pathname.slice(1));
  const rows=elements(doc,'row').map(row=>{
   const cells=[];
   for(const c of elements(row,'c')){
    const letters=(c.getAttribute('r')||'').match(/^[A-Z]+/)?.[0];if(!letters)continue;
    const col=Array.from(letters).reduce((v,l)=>v*26+l.charCodeAt(0)-64,0)-1;
    let value=elements(c,'v')[0]?.textContent||'';
    if(c.getAttribute('t')==='s')value=strings[Number(value)]||'';
    if(c.getAttribute('t')==='inlineStr')value=richText(c);
    if(value!=='')cells[col]=value;
   }return cells;
  });
  result.push(...mapRows(rows,event));
 }
 if(!result.length)throw Error('No participants found on the Inspire or RLS sheets.');
 return result;
}
function category(value){return (value||'Participant').replace(/\s+[-–—]\s+/g,' ').replace(/\s+/g,' ').trim().toUpperCase();}
function safeName(value){
 return value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1F]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,170);
}
function textPanel(g,profile,eventLabel){
 const canvas=document.createElement('canvas');const w=300,h=186,scale=2.5;
 canvas.width=w*scale;canvas.height=h*scale;
 const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
 ctx.fillStyle='#12344e';ctx.fillRect(0,0,w,32);ctx.fillStyle='#b4edc8';ctx.font='bold 12px Arial, sans-serif';ctx.fillText('TechData',18,20);
 ctx.fillStyle='#ffffff';ctx.textAlign='right';ctx.font='bold 9px Arial, sans-serif';ctx.fillText(eventLabel,282,20);ctx.textAlign='left';
 function lines(text,size,bold,maxLines){
  let font=size,parts=[];
  for(;font>=6;font-=0.5){
   ctx.font=`${bold?'bold ':''}${font}px Arial, sans-serif`;parts=[''];
   for(const word of String(text||'').split(/\s+/)){
    const i=parts.length-1,combined=(parts[i]+' '+word).trim();
    if(ctx.measureText(combined).width>264&&parts[i])parts.push(word);else parts[i]=combined;
   }
   if(parts.length<=maxLines&&parts.every(s=>ctx.measureText(s).width<=264))break;
  }
  return {parts,font:Math.max(font,6)};
 }
 function write(value,y,size,bold,maxLines,color){
  const {parts,font}=lines(value,size,bold,maxLines);ctx.fillStyle=color;ctx.font=`${bold?'bold ':''}${font}px Arial, sans-serif`;
  for(const l of parts){ctx.fillText(l,18,y,264);y+=font*1.12;}return y;
 }
 let y=write(category(profile.category),54,9.5,true,2,'#327256')+10;
 y=write(profile.name||g.name,y+10,23,true,2,'#12344e')+2;
 for(const value of [profile.company,profile.title,profile.country])if(value)y=write(value,y,10,false,2,'#354e61')+3;
 return canvas.toDataURL('image/png');
}
async function zipPasses(guests,scope,onProgress){
 await Promise.all([library('jszip.min.js'),library('pdf-lib.min.js')]);
 const zip=new JSZip(),used=new Set();
 for(const [i,g] of guests.entries()){
  const event=scope||events.find(e=>g.events[e]),p=g.events[event];
  const label=scope||events.filter(e=>g.events[e]).join('  /  ');
  const pdf=await PDFLib.PDFDocument.create();
  pdf.setTitle(`${p.name} · ${label} guest pass`);pdf.setAuthor('TechData');
  const page=pdf.addPage([300,408]);
  const panel=await pdf.embedPng(textPanel(g,p,label));page.drawImage(panel,{x:0,y:222,width:300,height:186});
  const matrix=window.TechQR(g.id),unit=4.5,left=(300-matrix.length*unit)/2,top=202;
  for(let y=0;y<matrix.length;y++)for(let x=0;x<matrix.length;){
   if(!matrix[y][x]){x++;continue;}let start=x;while(x<matrix.length&&matrix[y][x])x++;
   page.drawRectangle({x:left+start*unit,y:top-(y+1)*unit,width:(x-start)*unit,height:unit,color:PDFLib.rgb(0,0,0)});
  }
  const font=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);const navy=PDFLib.rgb(.07,.2,.3);
  function center(text,y,size){page.drawText(text,{x:(300-font.widthOfTextAtSize(text,size))/2,y,size,font,color:navy});}
  center(g.id,47,9);center('Show this QR code at the registration desk.',28,10);
  let base=safeName(`[${category(p.category)}] ${p.name}`);if(used.has(base.toLowerCase()))base+=' - '+g.id;
  used.add(base.toLowerCase());zip.file(base+'.pdf',await pdf.save());
  if(i%8===0||i===guests.length-1){onProgress(i+1,guests.length);await new Promise(r=>setTimeout(r,0));}
 }
 return zip.generateAsync({type:'blob'});
}
window.TechEventFiles={mapRows,workbook,zipPasses};
})();
