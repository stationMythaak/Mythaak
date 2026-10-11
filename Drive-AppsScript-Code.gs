// ===== Bon Archive → Google Drive WITHOUT Cloud Console =====
// 1) Go to https://script.google.com → New project → paste this file → Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Copy URL
// 2) Paste that URL in the app (tab Drive → Script URL) → Save + Upload works directly
// NOTE: uses only Drive scope (already granted) — no extra authorization needed.

function getOrCreate_(name, parent) {
  var it;
  if (parent) it = parent.getFoldersByName(name);
  else it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  if (parent) return parent.createFolder(name);
  return DriveApp.createFolder(name);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ok:true, msg:'BonArchive ready'}))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if(d.action){try{return userApi_(d)}catch(err){return jOut({ok:false,error:String(err)})}}
    // d = {filename, mime, data(base64), company, number, date, amount, type, year, monthFolder, root}
    var root = getOrCreate_(d.root || 'Bons_Archivage', null);
    var yF = getOrCreate_(d.year, root);
    var mF = getOrCreate_(d.monthFolder, yF);
    var dF = getOrCreate_(d.dayFolder || String(d.date||'').slice(8,10) || '00', mF);
    var eF = getOrCreate_((d.takenBy||'').trim() || '—', dF); // دوسي خاص لكل عامل داخل دوسي التاريخ
    var bytes = Utilities.base64Decode(d.data);
    var blob = Utilities.newBlob(bytes, d.mime || 'image/jpeg', d.filename);
    var file = eF.createFile(blob);
    file.setDescription('👤 ' + (d.takenBy||'') + ' | ' + (d.credit?d.credit+' | ':'') + (d.company||'') + ' | ' + (d.number||'') + ' | ' + (d.date||'') + ' | ' + (d.amount||0) + 'DH');
    return ContentService.createTextOutput(JSON.stringify({ok:true, id: file.getId(), url: file.getUrl()}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error: String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ===== Central users database in a Drive JSON file (login from any phone/PC) =====
function jOut(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function usersFile_(){
  var it=DriveApp.getFilesByName('bon-users-db.json');
  if(it.hasNext())return it.next();
  return DriveApp.createFile('bon-users-db.json','[]','application/json');
}
function readUsers_(){
  try{var a=JSON.parse(usersFile_().getBlob().getDataAsString());return Array.isArray(a)?a:[]}catch(e){return[]}
}
function writeUsers_(a){usersFile_().setContent(JSON.stringify(a))}
function findU_(arr,name){for(var i=0;i<arr.length;i++){if(String(arr[i].name)===String(name))return i}return -1}
function countAdm_(arr){var c=0;for(var i=0;i<arr.length;i++)if(arr[i].role==='admin')c++;return c}
function userApi_(d){
  var a=d.action;
  if(a==='ping')return jOut({ok:true});
  var lock=LockService.getScriptLock();
  try{lock.waitLock(10000)}catch(e){return jOut({ok:false,error:'busy'})}
  try{
    if(a==='setupAdmin'){
      var u0=readUsers_();
      if(u0.length)return jOut({ok:false,error:'exists'});
      u0.push({name:d.name,hash:d.hash,role:'admin'});writeUsers_(u0);return jOut({ok:true,role:'admin'});
    }
    if(a==='login'){
      var u1=readUsers_(),i1=findU_(u1,d.name);
      if(i1>=0&&String(u1[i1].hash)===String(d.hash))return jOut({ok:true,role:u1[i1].role});
      return jOut({ok:false});
    }
    if(a==='syncUp'){
      var u2=readUsers_();
      if(u2.length||!d.users||!d.users.length)return jOut({ok:false,error:'not-empty'});
      var out=d.users.map(function(x,i){return {name:x.name,hash:x.hash,role:i===0?'admin':(x.role||'employee')}});
      writeUsers_(out);return jOut({ok:true,n:out.length});
    }
    if(a==='setPass'){
      var u3=readUsers_(),i3=findU_(u3,d.name);if(i3<0)return jOut({ok:false});
      var selfOk=d.oldHash&&String(u3[i3].hash)===String(d.oldHash);
      var iby=findU_(u3,d.by);
      var admOk=iby>=0&&String(u3[iby].hash)===String(d.byHash)&&u3[iby].role==='admin';
      if(!selfOk&&!admOk)return jOut({ok:false,error:'forbidden'});
      u3[i3].hash=d.newHash;writeUsers_(u3);return jOut({ok:true});
    }
    var all=readUsers_(),ib=findU_(all,d.by);
    var okAdm=ib>=0&&String(all[ib].hash)===String(d.byHash)&&all[ib].role==='admin';
    if(!okAdm)return jOut({ok:false,error:'forbidden'});
    if(a==='list'){var li=[];for(var i=0;i<all.length;i++)li.push({name:all[i].name,role:all[i].role});return jOut({ok:true,users:li})}
    if(a==='add'){if(findU_(all,d.name)>=0)return jOut({ok:false,error:'exists'});all.push({name:d.name,hash:d.hash,role:d.role||'employee'});writeUsers_(all);return jOut({ok:true})}
    if(a==='del'){var id=findU_(all,d.name);if(id<0)return jOut({ok:false});if(all[id].role==='admin'&&countAdm_(all)<=1)return jOut({ok:false,error:'last-admin'});all.splice(id,1);writeUsers_(all);return jOut({ok:true})}
    if(a==='setRole'){var ir=findU_(all,d.name);if(ir<0)return jOut({ok:false});if(d.role!=='admin'&&all[ir].role==='admin'&&countAdm_(all)<=1)return jOut({ok:false,error:'last-admin'});all[ir].role=d.role;writeUsers_(all);return jOut({ok:true})}
    if(a==='wipe'){writeUsers_([]);return jOut({ok:true})}
    return jOut({ok:false,error:'unknown'});
  }finally{try{lock.releaseLock()}catch(e){}}
}
