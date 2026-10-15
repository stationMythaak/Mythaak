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
  return ContentService.createTextOutput(JSON.stringify({ok:true, msg:'BonArchive ready', srv:'v3-users-companies'}))
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
    if(a==='invList'){
      // لائحة البونات من Drive: الأدمن الكل، العامل ديالو فقط (الصور تبقى في Drive)
      var au4=readUsers_(),iu4=findU_(au4,d.by);
      if(!(iu4>=0&&String(au4[iu4].hash)===String(d.byHash)))return jOut({ok:false,error:'forbidden'});
      var isAdm=au4[iu4].role==='admin';
      var out=[],count=0,MAX=2000;
      var collect_=function(fo,emp){
        if(!isAdm&&emp!==d.by&&emp!=='—')return;
        var fits=fo.getFiles();
        while(fits.hasNext()&&count<MAX){
          var f=fits.next();
          out.push({id:f.getId(),name:f.getName(),desc:f.getDescription()||'',emp:emp,url:'https://drive.google.com/file/d/'+f.getId()+'/view',size:f.getSize(),ct:f.getDateCreated().toISOString()});
          count++;
        }
      };
      try{
        var rits=DriveApp.getFoldersByName(d.root||'Bons_Archivage');
        if(rits.hasNext()){
          var yits=rits.next().getFolders();
          while(yits.hasNext()&&count<MAX){
            var mits=yits.next().getFolders();
            while(mits.hasNext()&&count<MAX){
              var dits=mits.next().getFolders();
              while(dits.hasNext()&&count<MAX){
                var df=dits.next(),eits=df.getFolders(),empDirs=[];
                while(eits.hasNext())empDirs.push(eits.next());
                if(!empDirs.length)collect_(df,'—');
                else for(var e=0;e<empDirs.length&&count<MAX;e++)collect_(empDirs[e],empDirs[e].getName());
              }
            }
          }
        }
      }catch(e){return jOut({ok:false,error:String(e)})}
      return jOut({ok:true,files:out});
    }
    var all=readUsers_(),ib=findU_(all,d.by);
    var okAdm=ib>=0&&String(all[ib].hash)===String(d.byHash)&&all[ib].role==='admin';
    if(!okAdm&&a!=='coPull'&&a!=='prPull')return jOut({ok:false,error:'forbidden'});
    if(a==='list'){var li=[];for(var i=0;i<all.length;i++)li.push({name:all[i].name,role:all[i].role});return jOut({ok:true,users:li})}
    if(a==='add'){if(findU_(all,d.name)>=0)return jOut({ok:false,error:'exists'});all.push({name:d.name,hash:d.hash,role:d.role||'employee'});writeUsers_(all);return jOut({ok:true})}
    if(a==='del'){var id=findU_(all,d.name);if(id<0)return jOut({ok:false});if(all[id].role==='admin'&&countAdm_(all)<=1)return jOut({ok:false,error:'last-admin'});all.splice(id,1);writeUsers_(all);return jOut({ok:true})}
    if(a==='setRole'){var ir=findU_(all,d.name);if(ir<0)return jOut({ok:false});if(d.role!=='admin'&&all[ir].role==='admin'&&countAdm_(all)<=1)return jOut({ok:false,error:'last-admin'});all[ir].role=d.role;writeUsers_(all);return jOut({ok:true})}
    if(a==='wipe'){writeUsers_([]);return jOut({ok:true})}
    if(a==='coPull'){
      try{var cf=DriveApp.getFilesByName('bon-companies-db.json');var cl=cf.hasNext()?JSON.parse(cf.next().getBlob().getDataAsString()):[];return jOut({ok:true,companies:Array.isArray(cl)?cl:[]})}catch(e){return jOut({ok:true,companies:[]})}
    }
    if(a==='coPush'){
      var au=readUsers_(),iu=findU_(au,d.by);
      if(!(iu>=0&&String(au[iu].hash)===String(d.byHash)&&au[iu].role==='admin'))return jOut({ok:false,error:'forbidden'});
      if(!Array.isArray(d.companies))return jOut({ok:false});
      var clean=[],seen={};
      for(var ci=0;ci<d.companies.length&&clean.length<500;ci++){var cn=String(d.companies[ci]||'').trim();if(cn.length>1&&!seen[cn.toLowerCase()]){seen[cn.toLowerCase()]=1;clean.push(cn)}}
      var cff=DriveApp.getFilesByName('bon-companies-db.json');
      var cf2=cff.hasNext()?cff.next():DriveApp.createFile('bon-companies-db.json','[]','application/json');
      cf2.setContent(JSON.stringify(clean));
      return jOut({ok:true,n:clean.length});
    }
    if(a==='prPull'){
      try{var pf=DriveApp.getFilesByName('bon-prices-db.json');var pl=pf.hasNext()?JSON.parse(pf.next().getBlob().getDataAsString()):[];return jOut({ok:true,prices:Array.isArray(pl)?pl:[]})}catch(e){return jOut({ok:true,prices:[]})}
    }
    if(a==='prPush'){
      var ap=readUsers_(),ip=findU_(ap,d.by);
      if(!(ip>=0&&String(ap[ip].hash)===String(d.byHash)&&ap[ip].role==='admin'))return jOut({ok:false,error:'forbidden'});
      if(!Array.isArray(d.prices))return jOut({ok:false});
      var nums=[];for(var pi=0;pi<d.prices.length&&pi<20;pi++){var pv=parseFloat(d.prices[pi]);nums.push(isNaN(pv)?0:pv)}
      var pff=DriveApp.getFilesByName('bon-prices-db.json');
      var pf2=pff.hasNext()?pff.next():DriveApp.createFile('bon-prices-db.json','[]','application/json');
      pf2.setContent(JSON.stringify(nums));
      return jOut({ok:true});
    }
    if(a==='dataPush'||a==='dataPull'||a==='dataDel'){
      // مزامنة البيانات المركزية (ميتا فقط بلا صور): الأدمن الكل، العامل ديالو فقط
      var auD=readUsers_(),iuD=findU_(auD,d.by);
      if(!(iuD>=0&&String(auD[iuD].hash)===String(d.byHash)))return jOut({ok:false,error:'forbidden'});
      var isAD=auD[iuD].role==='admin';
      var dff=DriveApp.getFilesByName('bon-data-db.json');
      var db=dff.hasNext()?JSON.parse(dff.next().getBlob().getDataAsString()):{receipts:{},station:{},other:{}};
      if(!db.receipts)db.receipts={};if(!db.station)db.station={};if(!db.other)db.other={};
      var saveDb=function(){var x=DriveApp.getFilesByName('bon-data-db.json');(x.hasNext()?x.next():DriveApp.createFile('bon-data-db.json','{}','application/json')).setContent(JSON.stringify(db))};
      var ownK=function(k){return k.slice(-d.by.length-1)==='_'+d.by};
      if(a==='dataDel'){
        if(!isAD)return jOut({ok:false,error:'forbidden'});
        delete db.receipts[d.id];saveDb();return jOut({ok:true});
      }
      if(a==='dataPush'){
        var dd=d.data||{},rl=dd.receipts||[];
        for(var ri=0;ri<rl.length;ri++){var rr=rl[ri];if(!rr||!rr.id)continue;
          if(!isAD&&String(rr.takenBy)!==String(d.by))continue;
          var ex=db.receipts[rr.id];
          if(!ex||(rr.updatedAt||0)>=(ex.updatedAt||0))db.receipts[rr.id]=rr;
        }
        var sks=dd.station||{};
        for(var sk in sks){if(!isAD&&!ownK(sk))continue;db.station[sk]={d:sks[sk].d,t:new Date().getTime()}}
        var sok=dd.other||{};
        for(var ok3 in sok){if(!isAD&&!ownK(ok3))continue;db.other[ok3]={v:sok[ok3].v,t:new Date().getTime()}}
        saveDb();return jOut({ok:true});
      }
      if(a==='dataPull'){
        if(isAD)return jOut({ok:true,db:db});
        var mine={receipts:{},station:{},other:{}};
        for(var id in db.receipts){if(String(db.receipts[id].takenBy)===String(d.by))mine.receipts[id]=db.receipts[id]}
        for(var k2 in db.station){if(ownK(k2))mine.station[k2]=db.station[k2]}
        for(var k3 in db.other){if(ownK(k3))mine.other[k3]=db.other[k3]}
        return jOut({ok:true,db:mine});
      }
    }
    if(a==='fileDel'){
      // مسح ملف من Drive (للأدمن فقط) — الملفات اللي رفعها السكريبت مملوكة لحساب المالك
      var auF=readUsers_(),iuF=findU_(auF,d.by);
      if(!(iuF>=0&&String(auF[iuF].hash)===String(d.byHash)&&auF[iuF].role==='admin'))return jOut({ok:false,error:'forbidden'});
      try{DriveApp.getFileById(String(d.id)).setTrashed(true);return jOut({ok:true})}
      catch(e){return jOut({ok:false,error:String(e)})}
    }
    if(a==='imgsGet'){      // صور البونات عبر السيرفر (بحساب المالك) — بلا ما يحتاج المشاهد Gmail
      var auI=readUsers_(),iuI=findU_(auI,d.by);
      if(!(iuI>=0&&String(auI[iuI].hash)===String(d.byHash)))return jOut({ok:false,error:'forbidden'});
      var ids=Array.isArray(d.ids)?d.ids.slice(0,30):[];
      var out={};
      for(var gi=0;gi<ids.length;gi++){
        try{
          var gf=DriveApp.getFileById(String(ids[gi]));
          if(gf.getSize()>6*1024*1024)continue;
          out[ids[gi]]={mime:gf.getMimeType(),data:Utilities.base64Encode(gf.getBlob().getBytes())};
        }catch(e){}
      }
      return jOut({ok:true,imgs:out});
    }
    if(a==='fileDel'){
      // مسح ملف من Drive نهائيا (للأدمن فقط)
      var auF=readUsers_(),iuF=findU_(auF,d.by);
      if(!(iuF>=0&&String(auF[iuF].hash)===String(d.byHash)&&auF[iuF].role==='admin'))return jOut({ok:false,error:'forbidden'});
      try{DriveApp.getFileById(String(d.id)).setTrashed(true);return jOut({ok:true})}
      catch(e){return jOut({ok:false,error:String(e)})}
    }
    return jOut({ok:false,error:'unknown'});
  }finally{try{lock.releaseLock()}catch(e){}}
}
