// ===== Bon Archive → Google Drive WITHOUT Cloud Console =====
// 1) Go to https://script.google.com → New project → paste this file → Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Copy URL
// 2) Paste that URL in the app (tab Drive → Script URL) → Save + Upload works directly

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

// ===== Central users database (login from any phone/PC) =====
function jOut(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}
function dbSs_(){
  var id=PropertiesService.getScriptProperties().getProperty('SSID');
  var ss=null;
  try{if(id)ss=SpreadsheetApp.openById(id)}catch(e){ss=null}
  if(!ss){ss=SpreadsheetApp.create('BonArchiveDB');PropertiesService.getScriptProperties().setProperty('SSID',ss.getId())}
  return ss;
}
function usersSheet_(){
  var sh=dbSs_().getSheetByName('Users');
  if(!sh){sh=dbSs_().insertSheet('Users');sh.appendRow(['name','hash','role'])}
  return sh;
}
function userRow_(sh,name){
  var v=sh.getDataRange().getValues();
  for(var i=1;i<v.length;i++){if(String(v[i][0])===String(name))return {i:i+1,row:v[i]}}
  return null;
}
function isAdmin_(sh,name,hash){
  if(!name||!hash)return false;
  var u=userRow_(sh,name);
  return !!(u&&String(u.row[1])===String(hash)&&u.row[2]==='admin');
}
function userApi_(d){
  var sh=usersSheet_(),a=d.action;
  if(a==='ping')return jOut({ok:true});
  if(a==='setupAdmin'){
    if(sh.getLastRow()>1)return jOut({ok:false,error:'exists'});
    sh.appendRow([d.name,d.hash,'admin']);return jOut({ok:true,role:'admin'});
  }
  if(a==='login'){
    var u=userRow_(sh,d.name);
    if(u&&String(u.row[1])===String(d.hash))return jOut({ok:true,role:u.row[2]});
    return jOut({ok:false});
  }
  if(a==='syncUp'){
    if(sh.getLastRow()===1&&d.users&&d.users.length){
      d.users.forEach(function(x,i){sh.appendRow([x.name,x.hash,i===0?'admin':(x.role||'employee')])});
      return jOut({ok:true,n:d.users.length});
    }
    return jOut({ok:false,error:'not-empty'});
  }
  if(a==='setPass'){
    var s=userRow_(sh,d.name);if(!s)return jOut({ok:false});
    var selfOk=d.oldHash&&String(s.row[1])===String(d.oldHash);
    if(!selfOk&&!isAdmin_(sh,d.by,d.byHash))return jOut({ok:false,error:'forbidden'});
    sh.getRange(s.i,2).setValue(d.newHash);return jOut({ok:true});
  }
  if(!isAdmin_(sh,d.by,d.byHash))return jOut({ok:false,error:'forbidden'});
  if(a==='list'){var v=sh.getDataRange().getValues(),out=[];for(var i=1;i<v.length;i++)out.push({name:v[i][0],role:v[i][2]});return jOut({ok:true,users:out})}
  if(a==='add'){if(userRow_(sh,d.name))return jOut({ok:false,error:'exists'});sh.appendRow([d.name,d.hash,d.role||'employee']);return jOut({ok:true})}
  if(a==='del'){var t=userRow_(sh,d.name);if(!t)return jOut({ok:false});var all=sh.getDataRange().getValues(),adm=0;for(var j=1;j<all.length;j++)if(all[j][2]==='admin')adm++;if(t.row[2]==='admin'&&adm<=1)return jOut({ok:false,error:'last-admin'});sh.deleteRow(t.i);return jOut({ok:true})}
  if(a==='setRole'){var t2=userRow_(sh,d.name);if(!t2)return jOut({ok:false});if(d.role!=='admin'){var a2=sh.getDataRange().getValues(),c2=0;for(var k=1;k<a2.length;k++)if(a2[k][2]==='admin')c2++;if(t2.row[2]==='admin'&&c2<=1)return jOut({ok:false,error:'last-admin'})}sh.getRange(t2.i,3).setValue(d.role);return jOut({ok:true})}
  if(a==='wipe'){var lr=sh.getLastRow();if(lr>1)sh.deleteRows(2,lr-1);return jOut({ok:true})}
  return jOut({ok:false,error:'unknown'});
}
