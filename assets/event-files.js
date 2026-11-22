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
async function qrPdf(id){
 const matrix = window.TechQR(id);
 const moduleSize = 4;
 const quietZone = 4;
 const pageSize = (matrix.length + 2 * quietZone) * moduleSize;
 const pdf = await PDFLib.PDFDocument.create({updateMetadata:false});
 const page = pdf.addPage([pageSize,pageSize]);
 const black = PDFLib.rgb(0,0,0);
 for(const [rowIndex,row] of matrix.entries()){
  for(let column=0;column<row.length;){
   if(!row[column]){column++;continue;}
   const start = column;
   while(column<row.length && row[column]) column++;
   page.drawRectangle({
    x:(quietZone + start) * moduleSize,
    y:pageSize - (quietZone + rowIndex + 1) * moduleSize,
    width:(column - start) * moduleSize,
    height:moduleSize,
    color:black
   });
  }
 }
 return pdf.save();
}
async function zipPasses(guests,scope,onProgress){
 await Promise.all([library('jszip.min.js'),library('pdf-lib.min.js')]);
 const zip=new JSZip(),used=new Set();
 for(const [i,g] of guests.entries()){
  const event=scope||events.find(e=>g.events[e]),p=g.events[event];
  let base=safeName(`[${category(p.category)}] ${p.name}`);if(used.has(base.toLowerCase()))base+=' - '+g.id;
  used.add(base.toLowerCase());zip.file(base+'.pdf',await qrPdf(g.id));
  if(i%8===0||i===guests.length-1){onProgress(i+1,guests.length);await new Promise(r=>setTimeout(r,0));}
 }
 return zip.generateAsync({type:'blob'});
}
window.TechEventFiles={mapRows,workbook,zipPasses};
})();
