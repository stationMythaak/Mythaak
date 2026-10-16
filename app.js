// ===== Bon Archive PWA - core =====
const $=id=>document.getElementById(id);
const LS='bon_archive_v1';
const APP_VER='v80';
const PIN_KEY='bon_pin_hash';
const USER_KEY='bon_user'; // legacy single account
const USERS_KEY='bon_users'; // [{name,hash,role}]
const CUR_KEY='bon_current'; // session: logged-in name
// migrate legacy single/PIN accounts -> users list (first = admin)
(function migrateUsers(){
  let users=[];try{users=JSON.parse(localStorage.getItem(USERS_KEY)||'[]')}catch(e){}
  if(!users.length&&localStorage.getItem(USER_KEY)){
    try{const u=JSON.parse(localStorage.getItem(USER_KEY));users=[{name:u.name,hash:u.hash,role:'admin'}]}catch(e){}
    localStorage.removeItem(USER_KEY);
  }
  if(!users.length&&localStorage.getItem(PIN_KEY)){
    users=[{name:'admin',hash:localStorage.getItem(PIN_KEY),role:'admin'}];
    localStorage.removeItem(PIN_KEY);
  }
  if(users.length) localStorage.setItem(USERS_KEY,JSON.stringify(users));
})();
// multiple admins allowed — only protection: can't remove/demote the LAST admin
function adminCount(){return getUsers().filter(u=>u.role==='admin').length}
function getUsers(){try{return JSON.parse(localStorage.getItem(USERS_KEY)||'[]')}catch(e){return[]}}
function saveUsers(u){localStorage.setItem(USERS_KEY,JSON.stringify(u))}
function getUser(){const n=sessionStorage.getItem(CUR_KEY);if(!n) return null;return getUsers().find(u=>u.name===n)||null}
function isAdmin(){const u=getUser();return !!(u&&u.role==='admin')}
// role scope: employee sees ONLY his own receipts; admin/guest sees all
function scopeName(){const u=getUser();return (u&&u.role==='employee')?u.name:null}
function visibleReceipts(){const n=scopeName();return n?receipts.filter(r=>(r.takenBy||'—')===n):receipts}
// private archive + soft delete: worker delete hides from him, admin keeps everything
function liveReceipts(){return receipts.filter(r=>!r.del)}
function totalsBase(){const n=scopeName();const l=liveReceipts();return n?l.filter(r=>(r.takenBy||'—')===n):l}
function listPool(){const n=scopeName();const l=isAdmin()?receipts:liveReceipts();return n?l.filter(r=>(r.takenBy||'—')===n):l}
function currentUser(){const u=getUser();return u?u.name:'زائر'}
function showUser(){const u=getUser();$('driveStatus').textContent=(u?(u.role==='admin'?'👑 ':'👤 ')+u.name:'👤 زائر')+' • 📱 جاهز للربط مع Google Drive';if($('appVer'))$('appVer').textContent='إصدار التطبيق: '+APP_VER}
// --- Login / user+password lock ---
// NOTE: single hash fn everywhere (works on http LAN + https). Old SHA-256 accounts auto-migrate on next successful login.
function fallbackHash(s){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return 'fb'+(h2>>>0).toString(16)+(h1>>>0).toString(16)}
async function sha(s){return fallbackHash('bonarch::'+s)}
async function shaLegacy(s){
  try{
    if(window.crypto&&crypto.subtle){
      const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('bonarch::'+s));
      return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
    }
  }catch(e){}
  return null;
}
function lockMode(){if(sessionStorage.getItem('bon_unlocked')==='1')return 'open';const us=getUsers();if(!us.length){return forceSetup?'setup':'login'}return localStorage.getItem('bon_nolock')?'open':'login'}
let forceSetup=false;
// ===== قاعدة المستخدمين المركزية (نفس Apps Script) — دخول من أي هاتف/PC =====
function backendUrl(){try{const v=($('scriptUrl')&&$('scriptUrl').value||'').trim();if(v)return v}catch(e){}try{return localStorage.getItem('scriptUrl')||''}catch(e){return ''}}
async function apiU(action,body){
  const url=backendUrl();if(!url)return null;
  try{
    const r=await fetch(url,{method:'POST',body:JSON.stringify({action,...(body||{})})});
    return await r.json();
  }catch(e){return null}
}
function upsertLocalUser(name,hash,role){
  const users=getUsers();const i=users.findIndex(u=>u.name===name);
  if(i>=0)users[i]={name,hash,role};else users.push({name,hash,role});
  saveUsers(users);
}
// backend رفض العملية (hash قديم/دور تبدل في جهاز آخر) => إعادة الدخول لتحديث الجلسة
function needRelogin(){
  toast('🔄 تبدلات الصلاحيات في السيرفر — سجل الدخول مجددا');
  lock();
}
// مزامنة الأثمنة: الأدمن يدفع، الكل يسحب تلقائيا
async function pullPrices(silent){
  const r=await apiU('prPull',{});
  if(!r||!r.ok||!Array.isArray(r.prices)){if(!silent)toast('❌ تعذر جلب الثمن — تحقق من الرابط وتحديث السكريبت');return false}
  const np=r.prices.slice(0,ST_N).map(v=>parseFloat(v)||0);
  while(np.length<ST_N)np.push(0);
  if(JSON.stringify(np)===JSON.stringify(getPrices()))return true;
  savePrices(np);
  if(!isAdmin()){for(let i=0;i<ST_N;i++){const el=$('st-p-'+i);if(el)el.value=np[i]||''}calcStation(false)}
  if(!silent)toast('💵 تحدثات الأثمنة من السيرفر');
  else toast('💵 ثمن جديد من الأدمن');
  return true;
}
async function pushPrices(){
  const me=getUser();if(!me||me.role!=='admin')return;
  apiU('prPush',{prices:getPrices(),by:me.name,byHash:me.hash});
}
// مزامنة دليل الشركات مع السيرفر (الكل يسحب، الأدمن يدفع)
async function pullCompanies(silent){
  const r=await apiU('coPull',{});
  if(!r||!r.ok||!Array.isArray(r.companies)){if(!silent)toast('❌ تعذر مزامنة الشركات — حدّث كود Apps Script');return false}
  const cos=getCompanies(),low=new Set(cos.map(c=>c.toLowerCase()));let n=0;
  r.companies.forEach(c=>{c=String(c||'').trim();if(c.length>1&&!low.has(c.toLowerCase())){cos.push(c);low.add(c.toLowerCase());n++}});
  if(n)saveCompanies(cos);
  renderCompanies();render();
  if(n)toast(`📥 تستوردو ${n} شركات من السيرفر`);
  else if(!silent)toast('✅ الشركات محدثة already');
  return true;
}
async function pushCompanies(){
  const me=getUser();if(!me||me.role!=='admin')return;
  apiU('coPush',{companies:getCompanies(),by:me.name,byHash:me.hash});
}
// مقارنة بونات بالبيانات (بلا id) — لمنع التكرار مهما كان المصدر
function metaSame(a,b){return (a.company||'')===(b.company||'')&&(a.number||'')===(b.number||'')&&(a.date||'')===(b.date||'')&&(+a.amount||0)===(+b.amount||0)&&((a.takenBy||'—')===(b.takenBy||'—'))}
function metaKey(r){return [r.company||'',r.number||'',r.date||'',+r.amount||0,r.takenBy||'—'].join('§')}
// تومبستونات الحذف: المحذوف ما يرجعش في المزامنة
function getTombs(){try{return JSON.parse(localStorage.getItem('bon_tombs')||'{}')}catch(e){return{}}}
function getStTombs(){try{return JSON.parse(localStorage.getItem('bon_sttombs')||'{}')}catch(e){return{}}}
function tombedLocal(r){const t=getTombs();for(const id in t){if(t[id].m===metaKey(r))return true}return false}
function tombReceipt(r){try{const t=getTombs();t[r.id]={ts:Date.now(),tb:r.takenBy||'',m:metaKey(r)};localStorage.setItem('bon_tombs',JSON.stringify(t))}catch(e){}}
function tombStation(key){try{const t=getStTombs();t[key]=Date.now();localStorage.setItem('bon_sttombs',JSON.stringify(t))}catch(e){}}
// تنظيف مرة واحدة: دمج البونات المكررة محليا (نفس البيانات)
function dedupeReceipts(){
  try{
    if(localStorage.getItem('bon_dedup_v2'))return;
    const seen={},keep=[];
    const sorted=[...receipts].sort((a,b)=>new Date(a.created||0)-new Date(b.created||0));
    for(const r of sorted){
      const k=[r.company||'',r.number||'',r.date||'',+r.amount||0,r.takenBy||'—'].join('§');
      if(!seen[k]){seen[k]=r;keep.push(r);continue}
      const e=seen[k];
      if(!e.img&&r.img)e.img=r.img;
      if(!e.driveId&&r.driveId){e.driveId=r.driveId;e.driveUrl=r.driveUrl}
      if(!e.ahash&&r.ahash)e.ahash=r.ahash;
      if(r.del&&!e.del){e.del=r.del;e.updatedAt=r.updatedAt}
      else if((r.updatedAt||0)>(e.updatedAt||0))Object.assign(e,{company:r.company,number:r.number,date:r.date,amount:r.amount,type:r.type,pay:r.pay,note:r.note,credit:r.credit,fileName:r.fileName,month:r.month,updatedAt:r.updatedAt});
    }
    receipts=keep;
    try{save()}catch(e){}
    localStorage.setItem('bon_dedup_v2','1');
  }catch(e){}
}
// ===== مزامنة البيانات المركزية (بونات+محطة+بيع آخر، بلا صور) =====
let pushT=null;
function schedulePush(){try{if(!backendUrl())return;if(!getUser())return;clearTimeout(pushT);pushT=setTimeout(()=>{pushDataNow()},2500)}catch(e){}}
async function pushDataNow(){
  const me=getUser();if(!me||!backendUrl())return 'no-url';
  const data={receipts:[],station:{},other:{},tombs:getTombs(),sttombs:getStTombs()};
  receipts.forEach(r=>{const {img,...m}=r;data.receipts.push(m)});
  try{
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);
      if(!k)continue;
      if(k.indexOf(ST_KEY)===0){try{const d=JSON.parse(localStorage.getItem(k));if(d&&d.a)data.station[k]={d}}catch(e){}}
      else if(k.indexOf('bon_other_')===0){const v=localStorage.getItem(k);if(v!==null&&v!=='')data.other[k]={v}}}
    const r=await apiU('dataPush',{by:me.name,byHash:me.hash,data});
    if(r&&r.ok)return true;
    return 'server:'+((r&&(r.error||r.message))||'unknown');
  }catch(e){return 'network'}
}
function pushFailMsg(code){
  if(code==='no-url')return '⚠️ رابط السيرفر ناقص في هاد الجهاز — الصقو في Drive';
  if(code==='network')return '⚠️ تعذر الإرسال — تحقق من الاتصال بالإنترنت';
  if((code||'').indexOf('unknown')>=0)return '⚠️ السكريبت قديم — حدّث كود Apps Script (New version)';
  if((code||'').indexOf('forbidden')>=0){needRelogin();return '🔄 سجل الدخول مجددا'}
  return '⚠️ تعذر الإرسال ('+code+')';
}
async function pullData(silent){
  const me=getUser();if(!me||!backendUrl())return false;
  if(!silent)toast('☁️ كنجيب البيانات...');
  const r=await apiU('dataPull',{by:me.name,byHash:me.hash});
  if(!r||!r.ok){if(!silent)toast('❌ تعذر المزامنة');return false}
  const db=r.db||{receipts:{},station:{},other:{}};
  const tombs=r.tombs||{}, sttombs=r.sttombs||{};
  let nR=0,nS=0,nD=0;
  // أولا: طبق الحذف القادم من السيرفر (المحذوف عند الأدمن ما يرجعش)
  const lt=getTombs();let ltCh=false;
  Object.keys(tombs).forEach(id=>{
    if(!lt[id]||(tombs[id].ts||0)>(lt[id].ts||0)){lt[id]=tombs[id];ltCh=true}
  });
  if(ltCh){try{localStorage.setItem('bon_tombs',JSON.stringify(lt))}catch(e){}}
  const lst=getStTombs();let lstCh=false;
  Object.keys(sttombs).forEach(k=>{if(!lst[k]||sttombs[k]>(lst[k]||0)){lst[k]=sttombs[k];lstCh=true}});
  if(lstCh){try{localStorage.setItem('bon_sttombs',JSON.stringify(lst))}catch(e){}}
  const curT=getTombs(),curST=getStTombs();
  const before=receipts.length;
  receipts=receipts.filter(x=>{
    for(const id in curT){const tb=curT[id];if(tb.m===metaKey(x)&&(x.updatedAt||0)<=(tb.ts||0))return false}
    return true;
  });
  nD=before-receipts.length;
  for(const k in curST){try{if(localStorage.getItem(k)!=null)localStorage.removeItem(k)}catch(e){}}
  Object.keys(db.receipts||{}).forEach(id=>{
    const s=db.receipts[id];if(!s||!s.id)return;
    let skipTb=false;for(const tid in curT){const tb=curT[tid];if(tb.m===metaKey(s)&&(s.updatedAt||0)<=(tb.ts||0)){skipTb=true;break}}
    if(skipTb)return; // محذوف عند الأدمن => ما يرجعش (forEach => return)
    let li=receipts.findIndex(x=>String(x.id)===String(id));
    if(li<0)li=receipts.findIndex(x=>metaSame(x,s)); // نفس البون بـ id آخر => دمج بلا تكرار
    if(li<0){receipts.push({...s,img:''});nR++}
    else{const l=receipts[li];if((s.updatedAt||0)>(l.updatedAt||0)){const keep=l.img;receipts[li]={...s,img:keep||''};if(!receipts[li].driveId&&l.driveId){receipts[li].driveId=l.driveId;receipts[li].driveUrl=l.driveUrl}nR++}}
  });
  Object.keys(db.station||{}).forEach(k=>{
    if(curST[k])return; // محذوف => ما يرجعش
    const nd=(db.station[k]||{}).d, nt=(db.station[k]||{}).t||0;
    if(!nd||!nd.a)return;
    const meta=getStMeta();
    if(localStorage.getItem(k)==null||nt>(meta[k]||0)){
      try{localStorage.setItem(k,JSON.stringify(nd));const m2=getStMeta();m2[k]=nt;localStorage.setItem('bon_stmeta',JSON.stringify(m2));nS++}catch(e){}
    }
  });
  Object.keys(db.other||{}).forEach(k=>{if(localStorage.getItem(k)!=null)return;const nv=(db.other[k]||{}).v;if(nv!==undefined&&nv!==''){try{localStorage.setItem(k,nv)}catch(e){}}});
  if(nR||nS||nD){try{save()}catch(e){}render();loadStation()}
  if(!silent||nR||nS||nD)toast((nR||nS)?`☁️ تجلبو ${nR} بون + ${nS} حساب محطة${nD?` (تحذف ${nD})`:''}`:(nD?`🧹 تحذف ${nD} محذوف`:'✅ البيانات محدثة already'));
  return true;
}
// سحب لائحة المستخدمين من السيرفر للمرآة المحلية (الأدمن)
async function pullUsers(silent){
  const me=getUser();if(!me||me.role!=='admin')return false;
  const r=await apiU('list',{by:me.name,byHash:me.hash});
  if(!r||!r.ok){if(!silent)toast('❌ تعذر المزامنة');return false}
  const local=getUsers(),byName={};local.forEach(u=>byName[u.name]=u);
  saveUsers(r.users.map(x=>({name:x.name,role:x.role,hash:(byName[x.name]||{}).hash||null})));
  renderUsers();render();
  if(!silent)toast(`🔄 تزامنو ${r.users.length} حسابات من السيرفر`);
  return true;
}
function unlock(){sessionStorage.setItem('bon_unlocked','1');refreshLock();showUser();claimLegacyStation();render();loadStation()}
// ترحيل مرة واحدة: سجلات قديمة بلا سمية => لصاحب الجهاز (أول عامل يدخل)، إلا كان بدا عهد المسماة كانخليوها للأدمن
function claimLegacyStation(){
  try{
    if(isAdmin()) return;
    let hasSuffixed=false;const bare=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k.indexOf(ST_KEY)!==0) continue;
      const rest=k.slice(ST_KEY.length);
      if(/^\d{4}-\d{2}-\d{2}_.+$/.test(rest)) hasSuffixed=true;
      else if(/^\d{4}-\d{2}-\d{2}$/.test(rest)) bare.push(k);
    }
    if(hasSuffixed||!bare.length) return;
    const me=currentUser()||'زائر';
    bare.forEach(k=>{
      try{
        const d=JSON.parse(localStorage.getItem(k));
        if(d&&d.a) localStorage.setItem(stKey(k.slice(ST_KEY.length),me),JSON.stringify({...d,by:me}));
      }catch(e){}
      localStorage.removeItem(k);
    });
    // نفس الشي لبيع آخر القديم بلا سمية
    let otherSuf=false;const otherBare=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k.indexOf('bon_other_')!==0) continue;
      const rest=k.slice(10);
      if(/^\d{4}-\d{2}-\d{2}_.+$/.test(rest)) otherSuf=true;
      else if(/^\d{4}-\d{2}-\d{2}$/.test(rest)) otherBare.push(k);
    }
    if(!otherSuf) otherBare.forEach(k=>{
      try{
        const v=localStorage.getItem(k);
        if(v!==null&&v!=='') localStorage.setItem(k+'_'+me,v);
      }catch(e){}
      try{localStorage.removeItem(k)}catch(e){}
    });
  }catch(e){}
}
function lock(){sessionStorage.removeItem('bon_unlocked');sessionStorage.removeItem(CUR_KEY);try{stView=null}catch(e){}refreshLock();render();loadStation()}
function refreshLock(){
  const m=lockMode();const users=getUsers();
  $('lockScreen').classList.toggle('hidden',m==='open');
  const dl=$('empDatalist');if(dl) dl.innerHTML=users.map(u=>`<option value="${u.name}">`).join('');
  if(m==='setup'){$('lockTitle').textContent='🔐 أنشئ حساب الأدمن 👑';$('lockSub').textContent='أول حساب كيكون هو الأدمن — هو اللي غيضيف الموظفين';$('lockUser').hidden=false;$('lockPin2').hidden=false;$('lockGo').textContent='✅ إنشاء حساب الأدمن';$('lockSkip').hidden=false;$('lockForgot').hidden=true;$('lockNewAdmin').hidden=true}
  else if(m==='login'){
    const fresh=!getUsers().length;
    $('lockTitle').textContent='🔒 تسجيل الدخول';
    $('lockSub').textContent=fresh?'جهاز جديد؟ الصق رابط السيرفر تحت ودخل بحسابك المسجل':'دخل الاسم الكامل وكلمة السر';
    $('lockUser').hidden=false;$('lockPin2').hidden=true;$('lockGo').textContent='🔓 دخول';$('lockSkip').hidden=true;$('lockForgot').hidden=!fresh;
    $('lockNewAdmin').hidden=!fresh;
    const ls=$('lockSrv');
    if(ls){ls.hidden=!fresh;if(fresh&&!ls.value){try{ls.value=localStorage.getItem('scriptUrl')||''}catch(e){}}}
  }
  const c=getUser();if(c) $('logoutBtn').title='خروج '+c.name;
}
$('lockGo').onclick=async()=>{
  const m=lockMode();const name=$('lockUser').value.trim();const p=$('lockPin').value;
  if(name.length<2){$('lockMsg').textContent='⚠️ دخل الاسم الكامل';return}
  if(p.length<4){$('lockMsg').textContent='⚠️ كلمة السر خاصها 4 حروف على الأقل';return}
  if(m==='setup'){
    if(p!==$('lockPin2').value){$('lockMsg').textContent='⚠️ التأكيد مختلف';return}
    const h=await sha(name+'::'+p);
    const back=await apiU('setupAdmin',{name,hash:h});
    if(back&&back.ok===false&&back.error==='exists'){
      localStorage.setItem('bon_bh','1');localStorage.removeItem('bon_nolock');
      $('lockPin').value='';$('lockPin2').value='';$('lockMsg').textContent='';refreshLock();
      toast('☁️ الحسابات كاينة في السيرفر — دخلو بحساباتكم');return;
    }
    saveUsers([{name,hash:h,role:'admin'}]);localStorage.removeItem('bon_nolock');localStorage.removeItem('bon_bh');
    forceSetup=false;
    sessionStorage.setItem(CUR_KEY,name);
    $('lockPin').value='';$('lockPin2').value='';unlock();toast(back&&back.ok?'👑 مرحبا '+name+' — نتا الأدمن (☁️+📱)':'👑 مرحبا '+name+' — نتا الأدمن');
  }else{
    const h=await sha(name+'::'+p);
    // 1) السيرفر أولا (نفس الحساب في أي هاتف)
    if(backendUrl()){
      const r=await apiU('login',{name,hash:h});
      if(r&&r.ok){
        upsertLocalUser(name,h,r.role);localStorage.setItem('bon_bh','1');localStorage.removeItem('bon_nolock');
        sessionStorage.setItem(CUR_KEY,name);$('lockPin').value='';$('lockMsg').textContent='';unlock();toast('☁️ دخول عبر السيرفر — مرحبا '+name);
        pullCompanies(true);pullPrices(true);pullDriveArchive(true);pullData(true);
        if(r.role==='admin'){const lu=getUsers();if(lu.length>1)apiU('syncUp',{users:lu.map(u=>({name:u.name,hash:u.hash,role:u.role}))});pullUsers(true)}
        return;
      }
      if(r===null)toast('📱 بلا اتصال — دخول محلي');
      else if(r&&r.ok===false&&!getUsers().some(x=>x.name===name)){ $('lockMsg').textContent='❌ هاد الاسم ما مسجلش — طلب من الأدمن يضيفك';return}
    }
    // 2) المحلي (احتياط/بلا سيرفر)
    const u=getUsers().find(x=>x.name===name);
    if(!u){$('lockMsg').textContent='❌ هاد الاسم ما مسجلش — طلب من الأدمن يضيفك';return}
    if(u.hash===h){sessionStorage.setItem(CUR_KEY,name);$('lockPin').value='';$('lockMsg').textContent='';unlock();toast('🔓 مرحبا بعودتك '+name);return}
    // auto-migrate old SHA-256 hash accounts
    const legacy=await shaLegacy(name+'::'+p);
    if(legacy&&u.hash===legacy){saveUsers(getUsers().map(x=>x.name===name?{...x,hash:h}:x));sessionStorage.setItem(CUR_KEY,name);$('lockPin').value='';$('lockMsg').textContent='';unlock();toast('🔓 مرحبا بعودتك '+name);return}
    $('lockMsg').textContent='❌ كلمة السر غلط';
  }
};
$('lockSkip').onclick=()=>{localStorage.setItem('bon_nolock','1');unlock()};
$('lockNewAdmin').onclick=()=>{forceSetup=true;$('lockMsg').textContent='';refreshLock()};
$('lockSrv').addEventListener('input',()=>{try{localStorage.setItem('scriptUrl',$('lockSrv').value.trim())}catch(e){}});
$('lockForgot').onclick=()=>{
  if(!confirm('تصفر الحسابات وتنشئ أدمن جديد؟\nالبونات المحفوظة غتبقى.')) return;
  apiU('wipe',{by:(getUser()||{}).name,byHash:(getUser()||{}).hash});
  localStorage.removeItem(USERS_KEY);localStorage.removeItem(USER_KEY);localStorage.removeItem(PIN_KEY);localStorage.removeItem('bon_nolock');localStorage.removeItem('bon_bh');
  $('lockUser').value='';$('lockPin').value='';$('lockPin2').value='';$('lockMsg').textContent='';
  lock();toast('🔄 تصفر — أنشئ حساب الأدمن');
};
$('logoutBtn').onclick=()=>{if(!getUsers().length){toast('⚠️ ما كاين حتى حساب — غادي يطلب منك تنشئ الأدمن');localStorage.removeItem('bon_nolock')}lock()};
$('changePin').onclick=()=>{document.querySelectorAll('[data-tab="folders"]').forEach(x=>x.click());setTimeout(()=>{const i=$('newEmpName');if(i)i.focus()},150);toast('👑 ضيف موظف جديد من هنا')};
$('removePin').onclick=()=>{if(!isAdmin()){toast('⛔ للأدمن فقط');return}if(confirm('تحيد القفل نهائيا؟ (الحسابات غتبقى مسجلة)')){localStorage.setItem('bon_nolock','1');unlock();toast('🔓 تحيد القفل')}};
// كلمة السر الشخصية: كل واحد يبدل ديالو فقط (حتى العامل، بلا ما يقيس ديال الآخرين)
$('myPass').onclick=async()=>{
  const me=getUser();
  if(!me){toast('⚠️ سجل الدخول أولا');return}
  const cur=prompt('كلمة السر الحالية لـ '+me.name+' :');
  if(cur===null) return;
  const oldH=await sha(me.name+'::'+cur);
  let ok=me.hash&&oldH===me.hash;
  if(!ok){const lg=await shaLegacy(me.name+'::'+cur);if(lg&&lg===me.hash)ok=true}
  if(!ok&&backendUrl()){const chk=await apiU('login',{name:me.name,hash:oldH});if(chk&&chk.ok)ok=true}
  if(!ok){toast('❌ الحالية غلط');return}
  const p1=prompt('كلمة السر الجديدة (4 حروف على الأقل) :');
  if(p1===null) return;
  if(p1.length<4){toast('⚠️ قصيرة بزاف');return}
  const p2=prompt('أكد كلمة السر الجديدة :');
  if(p2===null) return;
  if(p1!==p2){toast('⚠️ التأكيد مختلف');return}
  const users=getUsers();const u=users.find(x=>x.name===me.name);
  if(!u){toast('❌ الحساب ما لقيناهش');return}
  const nh=await sha(me.name+'::'+p1);
  const back=await apiU('setPass',{name:me.name,oldHash:oldH,newHash:nh});
  if(backErr(back))return;
  u.hash=nh;saveUsers(users);toast('✅ تبدلات كلمة السر ديالك'+(back&&back.ok?' (☁️)':''));
};
function backErr(back){
  if(!back||back.ok) return false;
  if(back.error==='forbidden'){needRelogin()}else toast('❌ السيرفر رفض ('+(back.error||'؟')+')');
  return true;
}
// ===== Admin: add/remove employees (admin only — employees can't delete) =====
function renderUsers(){
  const box=$('usersList');if(!box) return;
  const users=getUsers();const me=getUser();
  if(!isAdmin()){box.innerHTML='<p class="hint">⛔ هاد القسم للأدمن فقط.</p>';return}
  if(!users.length){box.innerHTML='<p class="hint">ما كاين حتى موظف.</p>';return}
  box.innerHTML=users.map((u,i)=>{
    let done=false;try{const t=new Date().toISOString().slice(0,10);done=!!localStorage.getItem(stKey(t,u.name))}catch(e){}
    return `<div class="item"><div class="meta"><b>${u.role==='admin'?'👑':'👤'} ${u.name} ${done?'✅':''}</b><br><small>${u.role==='admin'?'أدمن — كل الصلاحيات':'موظف — بلا حذف'}${done?' • عمّر حساب اليوم':''}</small></div><div class="ops">${(me&&u.name!==me.name)?`<button class="btn ghost sm" data-pass="${i}" title="بدل كلمة السر">🔑</button><button class="btn ghost sm" data-role="${i}">${u.role==='admin'?'⬇️ موظف':'⬆️ أدمن'}</button><button class="btn danger sm" data-del="${i}">🗑️</button>`:''}</div></div>`}).join('');
  box.querySelectorAll('[data-pass]').forEach(b=>{b.onclick=async()=>{
    if(!isAdmin()){toast('⛔ للأدمن فقط');return}
    const users=getUsers();const t=users[+b.dataset.pass];if(!t) return;
    const p1=prompt('كلمة سر جديدة لـ '+t.name+' (4+ حروف) :');
    if(p1===null) return;
    if(p1.length<4){toast('⚠️ قصيرة بزاف');return}
    const p2=prompt('أكد كلمة السر الجديدة لـ '+t.name+' :');
    if(p2===null) return;
    if(p1!==p2){toast('⚠️ التأكيد مختلف');return}
    const nh=await sha(t.name+'::'+p1);
    const me=getUser();
    const back=await apiU('setPass',{name:t.name,newHash:nh,by:me.name,byHash:me.hash});
    if(backErr(back))return;
    t.hash=nh;saveUsers(users);toast('✅ تبدلات كلمة سر '+t.name+(back&&back.ok?' (☁️)':''));
  }});
  box.querySelectorAll('[data-del]').forEach(b=>{b.onclick=async()=>{
    const t=getUsers()[+b.dataset.del];if(!t) return;
    if(t.role==='admin'&&adminCount()===1){toast('⛔ ما يمكنش تحذف آخر أدمن');return}
    if(!confirm('تحذف الموظف '+t.name+'؟')) return;
    const me=getUser();
    const back=await apiU('del',{name:t.name,by:me.name,byHash:me.hash});
    if(backErr(back))return;
    saveUsers(getUsers().filter(u=>u.name!==t.name));renderUsers();render();toast('🗑️ تحذف '+t.name);
  }});
  box.querySelectorAll('[data-role]').forEach(b=>{b.onclick=async()=>{
    const users=getUsers();const t=users[+b.dataset.role];if(!t) return;
    const me=getUser();
    if(t.role==='admin'){
      if(adminCount()===1){toast('⛔ ما يمكنش تخفض آخر أدمن');return}
      if(!confirm('تخفض '+t.name+' لموظف؟')) return;
      const back=await apiU('setRole',{name:t.name,role:'employee',by:me.name,byHash:me.hash});
      if(backErr(back))return;
      t.role='employee';toast('⬇️ ولا موظف: '+t.name);
    }else{
      if(!confirm('ترقي '+t.name+' لأدمن؟ (غتولي عندو كل الصلاحيات)')) return;
      const back=await apiU('setRole',{name:t.name,role:'admin',by:me.name,byHash:me.hash});
      if(backErr(back))return;
      t.role='admin';toast('👑 ولا أدمن: '+t.name);
    }
    saveUsers(users);renderUsers();render();
  }});
}
$('addEmp').onclick=async()=>{
  if(!isAdmin()){toast('⛔ للأدمن فقط');return}
  const name=$('newEmpName').value.trim();const p=$('newEmpPass').value;
  if(name.length<2){$('adminMsg').textContent='⚠️ دخل الاسم الكامل';return}
  if(p.length<4){$('adminMsg').textContent='⚠️ كلمة السر 4+ حروف';return}
  if(getUsers().some(u=>u.name===name)){$('adminMsg').textContent='⚠️ هاد الاسم مسجل already';return}
  const nh=await sha(name+'::'+p);
  const me=getUser();
  const back=await apiU('add',{name,hash:nh,role:'employee',by:me.name,byHash:me.hash});
  if(backErr(back)){$('adminMsg').textContent=back&&back.error==='forbidden'?'🔄 سجل الدخول مجددا':'❌ السيرفر رفض ('+((back||{}).error||'؟')+')';return}
  const users=getUsers();users.push({name,hash:nh,role:'employee'});saveUsers(users);
  $('newEmpName').value='';$('newEmpPass').value='';$('adminMsg').textContent='✅ تزاد '+name+(back&&back.ok?' (☁️)':'');
  renderUsers();toast('✅ تزاد الموظف '+name);
};
$('resetUsers').onclick=()=>{
  if(!isAdmin()){toast('⛔ للأدمن فقط');return}
  if(!confirm('تصفر ALL الحسابات؟\nغيبقى حساب أدمن واحد جديد تنشئو من بعد.\nالبونات غتبقى محفوظة.')) return;
  const me=getUser();apiU('wipe',{by:me.name,byHash:me.hash});
  localStorage.removeItem(USERS_KEY);localStorage.removeItem(USER_KEY);localStorage.removeItem(PIN_KEY);localStorage.removeItem('bon_nolock');localStorage.removeItem('bon_bh');
  lock();toast('🧹 تصفر — أنشئ حساب الأدمن الوحيد');
};
$('lockPin').addEventListener('keydown',e=>{if(e.key==='Enter')$('lockGo').click()});
$('lockUser').addEventListener('keydown',e=>{if(e.key==='Enter')$('lockGo').click()});
if($('syncUsers'))$('syncUsers').onclick=()=>pullUsers(false);
if($('syncCompanies'))$('syncCompanies').onclick=()=>pullCompanies(false);
if($('syncData'))$('syncData').onclick=async()=>{
  if(!getUser()){toast('⚠️ سجل الدخول أولا');return}
  toast('☁️ كندفع المحلي...');
  await pushDataNow();
  await pullData(false);
  pullCompanies(true);pullPrices(true);
};
if($('syncCompanies'))$('syncCompanies').onclick=()=>pullCompanies(false);
if($('saveCoDrive'))$('saveCoDrive').onclick=async()=>{
  const me=getUser();if(!me||me.role!=='admin'){toast('⛔ للأدمن فقط');return}
  $('companyMsg').textContent='☁️ كنحفظ في Drive...';
  const r=await apiU('coPush',{companies:getCompanies(),by:me.name,byHash:me.hash});
  if(r&&r.ok){$('companyMsg').textContent=`☁️ تحفظ في Drive (${r.n} شركة) — أي جهاز جديد غيستوردو تلقائيا عند الدخول`;toast('☁️ الدليل محفوظ في Drive')}
  else if(r&&r.error==='forbidden'){needRelogin()}
  else{$('companyMsg').textContent='❌ تعذر — حدّث كود Apps Script (New version) وتأكد من الرابط';toast('❌ تعذر الحفظ')}
};
// security: every load (incl. duplicated tabs) starts locked — login required
sessionStorage.removeItem('bon_unlocked');sessionStorage.removeItem(CUR_KEY);
refreshLock();showUser();
let receipts=JSON.parse(localStorage.getItem(LS)||'[]');
let currentImage=null, currentMonthFilter=null, currentMime='image/jpeg', currentExt='jpg';
let deferredPrompt=null;

const MONTHS_AR=['يناير','فبراير','مارس','أبريل','ماي','يونيو','يوليوز','غشت','شتنبر','أكتوبر','نونبر','دجنبر'];
const MONTHS_FR=['Janvier','Fevrier','Mars','Avril','Mai','Juin','Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}
function save(){localStorage.setItem(LS,JSON.stringify(receipts))}
function slug(s){return (s||'sans-nom').trim().replace(/\s+/g,'_').replace(/[\\/:*?"<>|]/g,'').slice(0,30)||'sans-nom'}

// Tabs
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll(`[data-tab="${b.dataset.tab}"]`).forEach(x=>x.classList.add('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  $('tab-'+b.dataset.tab).classList.add('active');
  if(b.dataset.tab==='hisab'){pullPrices(true);pullData(true)} // تحديث الأثمنة + تأكيدات العمال عند فتح الحساب
});
// تحديث دوري للأثمنة كل دقيقتين (بلا ما يمسح الصفحة)
setInterval(()=>{try{if(sessionStorage.getItem('bon_unlocked')==='1'&&backendUrl())pullPrices(true)}catch(e){}},120000);

// Date default
$('fDate').value=new Date().toISOString().slice(0,10);
$('filterMonth').value=new Date().toISOString().slice(0,7);

// Image handling + compression
function handleFile(f){
  if(!f) return;
  currentMime=f.type||'image/jpeg';
  currentExt=currentMime.indexOf('png')>=0?'png':(currentMime.indexOf('webp')>=0?'webp':'jpg');
  const r=new FileReader();
  r.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const max=1280; let w=img.width,h=img.height;
      const k=Math.min(1,max/Math.max(w,h)); w=Math.round(w*k); h=Math.round(h*k);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      const fmt=currentMime==='image/png'?'image/png':(currentMime==='image/webp'?'image/webp':'image/jpeg');
      if(fmt==='image/png')currentExt='png';else if(fmt==='image/webp')currentExt='webp';else{currentExt='jpg';currentMime='image/jpeg'}
      currentImage=c.toDataURL(fmt,0.9);
      $('preview').src=currentImage;$('preview').hidden=false;
      $('placeholder').style.display='none';$('clearImg').hidden=false;$('ocrBtn').disabled=false;
      updateAutoName(); toast('✅ تم التقاط الصورة');
    };
    img.src=r.result;
  };
  r.readAsDataURL(f);
}
$('fileInput').onchange=e=>handleFile(e.target.files[0]);
$('fileInput2').onchange=e=>handleFile(e.target.files[0]);
$('clearImg').onclick=()=>{currentImage=null;currentMime='image/jpeg';currentExt='jpg';$('preview').hidden=true;$('placeholder').style.display='block';$('clearImg').hidden=true;$('ocrBtn').disabled=true};
const dz=$('dropZone');
['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor='#0f766e'}));
dz.addEventListener('drop',e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])});

// Auto filename + folder
function updateAutoName(){
  const d=$('fDate').value||new Date().toISOString().slice(0,10);
  const parts=d.split('-');const y=parts[0],m=parts[1],dd=parts[2];const mi=parseInt(m,10)-1;
  const numFb=slug($('fNumber').value)||'AUTO';
  const name=`${d}_${slug($('fCompany').value)}_${numFb}_${$('fAmount').value||0}DH.${currentExt||'jpg'}`;
  $('autoName').textContent=name;
  $('autoFolder').textContent=`${$('rootFolder')?.value||'Bons_Archivage'} / ${y} / ${m}-${MONTHS_FR[mi]||''} / ${dd} / ${currentUser()}`;
  return {name,y,m,mi,dd};
}
['fCompany','fNumber','fDate','fAmount'].forEach(id=>$(id).oninput=()=>{$(id).classList.remove('invalid');updateAutoName()});
$('fPay').onchange=()=>{$('payLogo').hidden=(!$('fPay').value.includes('Shell'));if(/كريدي|cr[eé]dit/i.test($('fPay').value))toast('💳 غيتسجل تلقائيا ككريدي غير مخلص')};
$('fPay').onchange();
updateAutoName();

// OCR with Tesseract — preprocessed + multi-pattern parsing for max accuracy
function preprocessForOcr(src){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const k=Math.max(1,1600/img.width);
      const w=Math.round(img.width*k),h=Math.round(img.height*k);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const x=c.getContext('2d');x.drawImage(img,0,0,w,h);
      const d=x.getImageData(0,0,w,h),p=d.data;
      const g=new Uint8Array(w*h);let mn=255,mx=0;
      for(let i=0;i<w*h;i++){const v=(p[i*4]*0.299+p[i*4+1]*0.587+p[i*4+2]*0.114)|0;g[i]=v;if(v<mn)mn=v;if(v>mx)mx=v}
      const range=Math.max(1,mx-mn);
      for(let i=0;i<w*h;i++){let v=((g[i]-mn)/range)*255;v=v<128?v*0.82:255-(255-v)*0.82;p[i*4]=p[i*4+1]=p[i*4+2]=v;p[i*4+3]=255}
      x.putImageData(d,0,0);
      res(c.toDataURL('image/png'));
    };
    img.onerror=()=>res(src);
    img.src=src;
  });
}
function normNum(s){
  s=String(s).replace(/[\s\u00a0']/g,'');
  if(/,\d{1,2}$/.test(s)&&!/\.\d+$/.test(s)) s=s.replace(/\./g,'').replace(',','.');
  else s=s.replace(/,/g,'');
  const v=parseFloat(s);return isNaN(v)?null:v;
}
function parseReceipt(t){
  const out={};
  // --- date: DD/MM/YYYY, DD-MM-YY, YYYY-MM-DD ... first VALID one
  const re=/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g;let m;
  while((m=re.exec(t))){
    let Y,M,D;
    if(m[1]){Y=+m[1];M=+m[2];D=+m[3]}
    else{D=+m[4];M=+m[5];Y=+m[6];if(Y<100)Y+=2000}
    if(M>=1&&M<=12&&D>=1&&D<=31&&Y>=2000&&Y<=2035){out.date=`${Y}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`;break}
  }
  // --- amounts: prefer TOTAL-lines; fallback = max currency amount
  const totAmts=[];
  const lineRe=/(total|montant|net\s*[aà]?\s*payer|somme|amount|reste[\s\S]{0,4}payer|total\s*ttc|ttc|net)[^\d\n]{0,14}(\d[\d\s.,]*)/gi;
  while((m=lineRe.exec(t))){const v=normNum(m[2]);if(v!==null&&v>0&&v<10000000)totAmts.push(v)}
  if(totAmts.length) out.amount=Math.max(...totAmts);
  else{
    const cands=[];
    const curRe=/(\d[\d\s.,]*\d|\d)\s*(dh|dhs|mad|dirhams?|درهم|€|\$)/gi;
    while((m=curRe.exec(t))){const v=normNum(m[1]);if(v!==null&&v>0&&v<10000000)cands.push(v)}
    if(cands.length) out.amount=Math.max(...cands);
  }
  // --- receipt number (handles "Facture N: F-123", "Ticket 456", "N° 78")
  const numRe=/(?:n[°o0]|num(?:ero)?|facture|bon|ticket|re[çc]u|r[eé]f(?:erence)?|folio|f[-/])[^\n\d]{0,8}?([a-z0-9][a-z0-9\-\/]{1,19})/i;
  const nm=t.match(numRe);
  if(nm) out.number=nm[1].replace(/^[il\-–]+/,'').toUpperCase();
  // --- company: first lettered line (only fills if empty)
  const lines=t.split('\n').map(s=>s.trim()).filter(s=>s.length>=3&&/[a-zA-Z\u0600-\u06FF]{3}/.test(s)&&!/\d{4}-\d{2}-\d{2}/.test(s));
  if(lines.length) out.company=lines[0].replace(/^[^\w\u0600-\u06FF]+/,'').slice(0,40);
  return out;
}
$('ocrBtn').onclick=async()=>{
  if(!currentImage) return;
  $('ocrBtn').disabled=true;
  try{
    $('ocrMsg').textContent='🧹 تنظيف الصورة...';
    const clean=await preprocessForOcr(currentImage);
    $('ocrMsg').textContent='⏳ القراءة... 0%';
    const {data}=await Tesseract.recognize(clean,'fra+eng',{logger:lg=>{if(lg.status==='recognizing text')$('ocrMsg').textContent=`⏳ القراءة... ${Math.round(lg.progress*100)}%`}});
    const t=data.text||'';
    $('ocrText').textContent=t.slice(0,1500);$('ocrDetails').hidden=!t.trim();
    if(!isAdmin())$('ocrDetails').hidden=true; // raw OCR text: admin only
    const r=parseReceipt(t);let n=0;
    if(r.date){$('fDate').value=r.date;n++}
    if(r.amount!==undefined){$('fAmount').value=r.amount;n++}
    if(r.number){$('fNumber').value=r.number;n++}
    if(r.company&&!$('fCompany').value.trim()){$('fCompany').value=r.company;n++}
    $('ocrMsg').textContent=n?`✅ استخرجنا ${n} حقول (ثقة ${Math.round((data.confidence||0))}%) — تحقق وصحح قبل الحفظ`:'⚠️ ما لقينا والو واضح — جرب صورة أوضح بإضاءة جيدة';
    updateAutoName();toast(n?'✨ OCR اكتمل':'⚠️ تحقق من النص المستخرج');
  }catch(e){console.error(e);$('ocrMsg').textContent='❌ تعذر القراءة، أدخل يدويا'}
  $('ocrBtn').disabled=false;
};
// ===== 📄 مسح المستند: كشف الورقة + قص منظور (بحال وضع Document) =====
let cvReady=null;
function loadCv(){
  if(window.cv&&cv.Mat) return Promise.resolve();
  if(cvReady) return cvReady;
  cvReady=new Promise((res,rej)=>{
    const s=document.createElement('script');s.src='https://docs.opencv.org/4.8.0/opencv.js';s.async=true;
    s.onload=()=>{const iv=setInterval(()=>{if(window.cv&&cv.Mat){clearInterval(iv);res()}},250);setTimeout(()=>{clearInterval(iv);rej(new Error('timeout'))},45000)};
    s.onerror=()=>rej(new Error('load'));
    document.head.appendChild(s);
  });
  return cvReady;
}
function cvDist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function orderCorners(p){
  // p: 4 points {x,y} => [tl,tr,br,bl]
  const s=p.map(q=>q.x+q.y), d=p.map(q=>q.y-q.x);
  const tl=p[s.indexOf(Math.min(...s))], br=p[s.indexOf(Math.max(...s))];
  const tr=p[d.indexOf(Math.min(...d))], bl=p[d.indexOf(Math.max(...d))];
  return [tl,tr,br,bl];
}
// ===== 🎥 مسح مباشر: تحديد الورقة لايف في الكاميرا + التقاط مقصوص =====
let liveStream=null, liveTimer=null, liveQuad=null, liveStable=0, livePrevDet=null, liveCapturing=false;
function quadShift(a,b){
  if(!a||!b) return 1e9;
  let s=0;for(let i=0;i<4;i++)s+=Math.hypot(a[i].x-b[i].x,a[i].y-b[i].y);
  return s/4;
}
function liveDetect(){
  const v=$('liveVideo'), ov=$('liveOverlay');
  if(!v||!v.videoWidth||window.cv===undefined||!cv.Mat) return;
  ov.width=v.clientWidth;ov.height=v.clientHeight;
  const ctx=ov.getContext('2d');ctx.clearRect(0,0,ov.width,ov.height);
  const DW=400, DH=Math.round(400*v.videoHeight/v.videoWidth);
  const dc=liveDetect.c||(liveDetect.c=document.createElement('canvas'));
  dc.width=DW;dc.height=DH;
  dc.getContext('2d').drawImage(v,0,0,DW,DH);
  let srcM=null,gray=null,blur=null,edges=null,contours=null,hier=null;
  try{
    srcM=cv.imread(dc);
    gray=new cv.Mat();cv.cvtColor(srcM,gray,cv.COLOR_RGBA2GRAY);
    blur=new cv.Mat();cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
    edges=new cv.Mat();cv.Canny(blur,edges,75,200);
    contours=new cv.MatVector();hier=new cv.Mat();cv.findContours(edges,contours,hier,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    let best=null,bestArea=0;
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i), area=cv.contourArea(c);
      if(area<DH*DW*0.05) continue;
      const peri=cv.arcLength(c,true), approx=new cv.Mat();
      cv.approxPolyDP(c,approx,0.02*peri,true);
      if(approx.rows===4&&area>bestArea){bestArea=area;if(best)best.delete();best=approx}else approx.delete();
    }
    const kx=v.videoWidth/DW, ky=v.videoHeight/DH;
    if(best){
      const det=[];for(let i=0;i<4;i++)det.push({x:best.data32S[i*2],y:best.data32S[i*2+1]});
      const p=[];for(let i=0;i<4;i++)p.push({x:det[i].x*kx,y:det[i].y*ky});
      liveQuad=p;
      // ثبات الورقة: نفس الموضع لعدة فريمات => التقاط تلقائي
      if(quadShift(det,livePrevDet)<12) liveStable++; else liveStable=0;
      livePrevDet=det;
      // map video coords -> displayed (object-fit:contain)
      const sc=Math.min(ov.width/v.videoWidth,ov.height/v.videoHeight);
      const ox=(ov.width-v.videoWidth*sc)/2, oy=(ov.height-v.videoHeight*sc)/2;
      const [tl,tr,br,bl]=orderCorners(p);
      ctx.strokeStyle='#22ff66';ctx.lineWidth=4;ctx.shadowColor='#22ff66';ctx.shadowBlur=12;
      ctx.beginPath();
      ctx.moveTo(tl.x*sc+ox,tl.y*sc+oy);ctx.lineTo(tr.x*sc+ox,tr.y*sc+oy);
      ctx.lineTo(br.x*sc+ox,br.y*sc+oy);ctx.lineTo(bl.x*sc+ox,bl.y*sc+oy);
      ctx.closePath();ctx.stroke();
      if(liveStable>=3&&!liveCapturing){
        $('liveMsg').textContent='✅ ثبتات الورقة — جاري الالتقاط تلقائيا...';
        doLiveShot();
      }else $('liveMsg').textContent='✅ الورقة محددة — ثبت الهاتف... '+Math.max(0,3-liveStable);
    }else{
      liveQuad=null;liveStable=0;livePrevDet=null;
      $('liveMsg').textContent='وجّه الكاميرا للورقة — الالتقاط تلقائي ملي تثبت';
    }
    if(best)best.delete();
  }catch(e){}
  [srcM,gray,blur,edges,contours,hier].forEach(m=>{try{if(m)m.delete()}catch(e){}});
}
function stopLive(){
  if(liveTimer){clearInterval(liveTimer);liveTimer=null}
  if(liveStream){liveStream.getTracks().forEach(t=>t.stop());liveStream=null}
  $('liveScan').hidden=true;liveQuad=null;liveStable=0;livePrevDet=null;liveCapturing=false;
}
$('liveBtn').onclick=async()=>{
  try{
    $('liveMsg').textContent='⏳ تحميل الماسح...';
    $('liveScan').hidden=false;
    await loadCv();
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){toast('❌ الكاميرا المباشرة خاصها HTTPS — استعمل وضع الصورة العادي');stopLive();return}
    liveStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920}},audio:false});
    const v=$('liveVideo');v.srcObject=liveStream;await v.play();
    liveTimer=setInterval(liveDetect,350);
  }catch(e){console.error(e);toast('❌ تعذر فتح الكاميرا (خاص HTTPS + إذن)');stopLive()}
};
$('liveClose').onclick=stopLive;
async function doLiveShot(){
  if(liveCapturing) return;liveCapturing=true;
  if(liveTimer){clearInterval(liveTimer);liveTimer=null}
  const v=$('liveVideo');
  if(!v||!v.videoWidth){toast('⚠️ الكاميرا ما زال ما خدماتش');return}
  const full=document.createElement('canvas');full.width=v.videoWidth;full.height=v.videoHeight;
  full.getContext('2d').drawImage(v,0,0);
  let out=full.toDataURL('image/jpeg',0.9);
  if(liveQuad&&window.cv&&cv.Mat){
    try{
      const [tl,tr,br,bl]=orderCorners(liveQuad);
      const maxW=Math.min(1400,Math.round(Math.max(cvDist(br,bl),cvDist(tr,tl))));
      const maxH=Math.round(maxW*Math.max(cvDist(tr,br),cvDist(tl,bl))/Math.max(1,Math.max(cvDist(br,bl),cvDist(tr,tl))));
      const sT=cv.matFromArray(4,1,cv.CV_32FC2,[tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y]);
      const dT=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,maxW,0,maxW,maxH,0,maxH]);
      const M=cv.getPerspectiveTransform(sT,dT);
      const srcM=cv.imread(full), warped=new cv.Mat();
      cv.warpPerspective(srcM,warped,M,new cv.Size(maxW,maxH),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
      const oc=document.createElement('canvas');oc.width=maxW;oc.height=maxH;cv.imshow(oc,warped);
      out=oc.toDataURL('image/jpeg',0.9);
      sT.delete();dT.delete();M.delete();srcM.delete();warped.delete();
      toast('📄 تلتقطت مقصوصة ✅');
    }catch(e){console.error(e);toast('📸 تلتقطت كاملة')}
  }else toast('📸 تلتقطت (بلا تحديد — حاول تقرب)');
  const img=new Image();
  img.onload=()=>{
    const max=1280,k=Math.min(1,max/Math.max(img.width,img.height));
    const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    currentImage=c.toDataURL('image/jpeg',0.82);
    currentMime='image/jpeg';currentExt='jpg';
    $('preview').src=currentImage;$('preview').hidden=false;
    $('placeholder').style.display='none';$('clearImg').hidden=false;
    $('ocrBtn').disabled=false;
    updateAutoName();stopLive();
  };
  img.src=out;
}
$('liveShot').onclick=doLiveShot;

// ===== منع تكرار نفس الصورة: بصمة بصرية (aHash) =====
function imgHash(dataURL){
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{
      try{
        const c=document.createElement('canvas');c.width=8;c.height=8;
        const x=c.getContext('2d');x.drawImage(im,0,0,8,8);
        const d=x.getImageData(0,0,8,8).data;
        const g=[];let sum=0;
        for(let i=0;i<64;i++){const v=(d[i*4]*0.299+d[i*4+1]*0.587+d[i*4+2]*0.114)|0;g.push(v);sum+=v}
        const avg=sum/64;let hex='';
        for(let n=0;n<16;n++){let b=0;for(let k=0;k<4;k++)b=(b<<1)|(g[n*4+k]>avg?1:0);hex+=b.toString(16)}
        res(hex);
      }catch(e){res(null)}
    };
    im.onerror=()=>res(null);
    im.src=dataURL;
  });
}
function hamDist(a,b){
  if(!a||!b||a.length!==b.length) return 99;
  let d=0;for(let i=0;i<a.length;i++){let x=parseInt(a[i],16)^parseInt(b[i],16);while(x){d+=x&1;x>>=1}}
  return d;
}
async function dupCheck(img,excludeId){
  const h=await imgHash(img);
  let best=null,bd=99,needSave=false;
  for(const r of receipts){
    if(excludeId&&r.id===excludeId)continue;
    if(!r.ahash&&r.img){try{r.ahash=await imgHash(r.img);needSave=true}catch(e){}}
    if(r.ahash&&h){const d=hamDist(h,r.ahash);if(d<bd){bd=d;best=r}}
  }
  try{if(needSave)save()}catch(e){}
  return {h,best,bd};
}
async function confirmNotDup(img,meta,excludeId){
  toast('🔍 كنقلب واش مصورة already...');
  const dup=await dupCheck(img,excludeId);
  if(dup.best&&dup.bd<=10){
    return confirm(`⛔ هاد الصورة مطابقة لبون محفوظ already:\n🏢 ${dup.best.company} • 🧾 ${dup.best.number} • 📅 ${dup.best.date}\n\nتحفظ على أي حال؟`) ? dup : null;
  }
  // احتياط: نفس الشركة + نفس الرقم محفوظ (إلا الصورة مختلفة بزاف)
  if(meta){
    const same=receipts.find(r=>(!excludeId||r.id!==excludeId)&&(r.company||'')===(meta.company||'')&&(r.number||'')===(meta.number||''));
    if(same){
      const ok=confirm(`⚠️ نفس الشركة والرقم محفوظ already:\n🏢 ${same.company} • 🧾 ${same.number} • 📅 ${same.date}\n\nتحفظ على أي حال؟`);
      if(!ok) return null;
    }
  }
  return dup;
}
// لقطة للفورم قبل رسالة التكرار + استرجاعها إلا تلغى الحفظ
function snapForm(){return {img:currentImage,co:$('fCompany').value,no:$('fNumber').value,dt:$('fDate').value,am:$('fAmount').value,nt:$('fNote').value,ty:$('fType').value,pay:$('fPay')?$('fPay').value:''}}
function restoreForm(s){
  currentImage=s.img;
  if(s.img){$('preview').src=s.img;$('preview').hidden=false;$('placeholder').style.display='none';$('clearImg').hidden=false;$('ocrBtn').disabled=false}
  $('fCompany').value=s.co;$('fNumber').value=s.no;$('fDate').value=s.dt;$('fAmount').value=s.am;$('fNote').value=s.nt;
  if($('fType'))$('fType').value=s.ty;if($('fPay'))$('fPay').value=s.pay;
  updateAutoName();
}
// Save
// STRICT: company name is mandatory — blocks save AND pdf
function requireCompany(){
  const ok=$('fCompany').value.trim().length>0;
  $('fCompany').classList.toggle('invalid',!ok);
  if(!ok){toast('⛔ اسم الشركة إجباري Strictement obligatoire');$('fCompany').focus();$('fCompany').scrollIntoView({behavior:'smooth',block:'center'})}
  return ok;
}
function buildReceipt(){
  if(!currentImage) {toast('📸 صوّر البون أولا');return null}
  if(!requireCompany()) return null;
  const empMode=!!scopeName(); // employee: simplified fast form
  if(empMode&&!$('fNumber').value.trim()){
    const dt=($('fDate').value||'').replaceAll('-','');
    $('fNumber').value=`AUTO-${dt}-${String(Date.now()).slice(-4)}`;
  }
  if(!$('fNumber').value.trim()){toast('⚠️ رقم البون ضروري');$('fNumber').focus();return null}
  const {name,y,m}=updateAutoName();
  let num=$('fNumber').value.trim();
  const pay=empMode?'نقدا Espèce':$('fPay').value;
  const typ=empMode?'بون Bon':$('fType').value;
  const isCredit=/كريدي|cr[eé]dit/i.test(pay);
  return {id:Date.now(),company:$('fCompany').value.trim(),number:num,
    date:$('fDate').value,amount:parseFloat($('fAmount').value)||0,type:typ,pay,
    credit:isCredit?{unpaid:true,paidBy:null,paidAt:null}:null,updatedAt:Date.now(),
    note:$('fNote').value.trim(),fileName:name,month:`${y}-${m}`,img:currentImage,mime:currentMime,driveId:null,driveUrl:null,takenBy:currentUser(),del:null,created:new Date().toISOString()};
}
function clearForm(){$('fCompany').value='';$('fNumber').value='';$('fAmount').value='';$('fNote').value='';if($('fType'))$('fType').selectedIndex=0;if($('fPay'))$('fPay').selectedIndex=0;if($('payLogo'))$('payLogo').hidden=true;$('clearImg').onclick();updateAutoName()}
// ===== تعديل البونات (للأدمن فقط) =====
let editingId=null;
function resetEdit(){editingId=null;$('saveLocal').textContent='💾 حفظ في الأرشيف';$('cancelEdit').hidden=true}
function startEdit(id){
  if(!isAdmin()){toast('⛔ التعديل للأدمن فقط');return}
  const r=receipts.find(x=>x.id===id);if(!r)return;
  editingId=id;
  $('fCompany').value=r.company||'';$('fNumber').value=r.number||'';$('fDate').value=r.date||'';$('fAmount').value=r.amount||'';$('fNote').value=r.note||'';
  if($('fType'))$('fType').value=r.type||'بون Bon';
  if($('fPay'))$('fPay').value=r.pay||'نقدا Espèce';
  if($('fPay'))$('fPay').onchange();
  currentMime=r.mime||'image/jpeg';
  currentExt=(r.fileName||'').match(/\.(png|webp)$/i)?(r.fileName.match(/\.(png|webp)$/i)[1].toLowerCase()==='png'?'png':'webp'):'jpg';
  if(r.img){currentImage=r.img;$('preview').src=r.img;$('preview').hidden=false;$('placeholder').style.display='none';$('clearImg').hidden=false;$('ocrBtn').disabled=false}
  else{currentImage=null;$('preview').hidden=true;$('placeholder').style.display='block';$('clearImg').hidden=true;$('ocrBtn').disabled=true}
  $('saveLocal').textContent='✅ حفظ التعديل';$('cancelEdit').hidden=false;
  updateAutoName();
  document.querySelectorAll('[data-tab="add"]').forEach(x=>x.click());
  window.scrollTo({top:0,behavior:'smooth'});
  toast('✏️ وضع التعديل — بدل وحفظ');
}
if($('cancelEdit'))$('cancelEdit').onclick=()=>{resetEdit();clearForm();toast('❌ تلغى التعديل')};
async function applyEdit(r,vals,dup){
  const oldDrive=r.driveId;
  Object.assign(r,{company:vals.company,number:vals.number,date:vals.date,amount:vals.amount,type:vals.type,pay:vals.pay,note:vals.note,fileName:vals.fileName,month:vals.month,img:currentImage,ahash:dup.h,credit:vals.credit,driveId:null,driveUrl:null,updatedAt:Date.now()});
  save();schedulePush();render();resetEdit();clearForm();
  if(oldDrive)deleteDriveFile({driveId:oldDrive}); // النسخة القديمة في Drive تتمسح (غيتعاود الرفع)
  toast('✅ تعدل البون — غيتعاود الرفع لـ Drive من جديد');
}
// تنظيف مرة واحدة: سجلات محطة فارغة (أصفار بلا إرسال/تأكيد)
function purgeEmptyStation(){
  try{
    if(localStorage.getItem('bon_stclean_v1'))return;
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i);
      if(!k||k.indexOf(ST_KEY)!==0)continue;
      try{
        const d=JSON.parse(localStorage.getItem(k));
        if(!d||!d.a)continue;
        const any=(d.a||[]).some(v=>+v>0)||(d.b||[]).some(v=>+v>0);
        if(!any&&!d.sent&&!d.confirmed)localStorage.removeItem(k);
      }catch(e){}
    }
    localStorage.setItem('bon_stclean_v1','1');
  }catch(e){}
}
$('saveLocal').onclick=async()=>{
  const r=buildReceipt(); if(!r) return;
  const dup=await confirmNotDup(currentImage,r,editingId);
  if(!dup){resetEdit();clearForm();toast('🗑️ تلغى الحفظ — تصفر الفورم');return}
  if(editingId){const t=receipts.find(x=>x.id===editingId);if(t)await applyEdit(t,r,dup);return}
  r.ahash=dup.h;
  try{receipts.unshift(r);save()}catch(e){toast('❌ التخزين عامر — صدّر Excel ومسح القدام');return}
  render();schedulePush();
  clearForm();
  toast('💾 تحفظ في دوسي '+r.month);
};
$('saveDrive').onclick=async()=>{
  const r=buildReceipt(); if(!r) return;
  const dup=await confirmNotDup(currentImage,r,editingId);
  if(!dup){resetEdit();clearForm();toast('🗑️ تلغى الحفظ — تصفر الفورم');return}
  if(editingId){const t=receipts.find(x=>x.id===editingId);if(t){await applyEdit(t,r,dup);const ok=await uploadToDrive(t).catch(()=>false);if(ok){save();render()}}return}
  r.ahash=dup.h;
  try{receipts.unshift(r);save()}catch(e){toast('❌ التخزين عامر — صدّر Excel ومسح القدام');return}
  render();schedulePush();clearForm();toast('💾 تحفظ محليا...');
  const ok=await uploadToDrive(r);
  if(ok){save();render()} 
};
// ===== Company directory (admin manages, workers get autocomplete) =====
const CO_KEY='bon_companies';
function getCompanies(){try{return JSON.parse(localStorage.getItem(CO_KEY)||'[]')}catch(e){return[]}}
function saveCompanies(c){localStorage.setItem(CO_KEY,JSON.stringify(c))}
function escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}
// ===== أصوات الشركات: تسجيل نطق السمية (أدمن) + استماع (الكل) =====
const CV_KEY='bon_cvoice';
function getVoices(){try{return JSON.parse(localStorage.getItem(CV_KEY)||'{}')}catch(e){return{}}}
function saveVoices(v){localStorage.setItem(CV_KEY,JSON.stringify(v))}
function playVoice(name){
  const u=getVoices()[name];
  if(!u){toast('⚠️ ما كاين حتى تسجيل لهاد الشركة');return}
  try{new Audio(u).play()}catch(e){toast('❌ تعذر التشغيل')}
}
let recState=null;
function recVoice(name,btn){
  if(recState){ // حبس وحفظ
    try{recState.rec.stop()}catch(e){}
    return;
  }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){toast('❌ التسجيل خاصو HTTPS');return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
    const chunks=[];
    const rec=new MediaRecorder(stream);
    recState={rec,name,btn};
    btn.classList.add('listening');btn.textContent='⏹️';
    toast('🎙️ كتسجل... ضغط تاني باش تحبس (8 ثواني max)');
    rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    rec.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      btn.classList.remove('listening');btn.textContent='🎙️';
      recState=null;
      const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
      const rd=new FileReader();
      rd.onload=()=>{
        try{
          const v=getVoices();v[name]=rd.result;saveVoices(v);
          renderCompanies();toast('✅ تحفظ الصوت ديال '+name);
        }catch(e){toast('❌ التخزين عامر — مسح شي تسجيلات')}
      };
      rd.readAsDataURL(blob);
    };
    rec.start();
    setTimeout(()=>{if(recState&&recState.rec===rec){try{rec.stop()}catch(e){}}},8000);
  }).catch(()=>toast('❌ عطي إذن الميكروفون'));
}
function renderCompanies(){
  const card=$('companiesCard');if(card) card.style.display=isAdmin()?'':'none';
  // seed once from existing receipts
  let cos=getCompanies();
  if(!localStorage.getItem(CO_KEY+'_seeded')){
    const fromR=[...new Set(receipts.map(r=>(r.company||'').trim()).filter(c=>c.length>1))];
    if(fromR.length){cos=[...new Set([...cos,...fromR])];saveCompanies(cos)}
    localStorage.setItem(CO_KEY+'_seeded','1');
  }
  const box=$('companiesList');if(!box) return;
  if(!isAdmin()){box.innerHTML='';return}
  box.innerHTML=cos.length?cos.map((c,i)=>{const hasV=!!getVoices()[c];return `<div class="item"><div class="meta"><b>🏢 ${escAttr(c)}</b></div><div class="ops">${hasV?'<button class="btn ghost sm" data-cplay>🔊</button>':''}<button class="btn ghost sm" data-crec>🎙️</button><button class="btn ghost sm" data-cedit="${i}">✏️</button><button class="btn danger sm" data-cdel>🗑️</button></div></div>`}).join(''):'<p class="hint">ما زال ما كاينة حتى شركة — زيد الأولى الفوق.</p>';
  box.querySelectorAll('[data-cplay]').forEach(b=>{b.onclick=()=>{const nm=b.closest('.item').querySelector('b').textContent.replace(/^🏢 /,'');playVoice(nm)}});
  box.querySelectorAll('[data-crec]').forEach(b=>{b.onclick=()=>{if(!isAdmin()){toast('⛔ التسجيل للأدمن فقط');return}const nm=b.closest('.item').querySelector('b').textContent.replace(/^🏢 /,'');recVoice(nm,b)}});
  box.querySelectorAll('[data-cdel]').forEach(b=>{b.onclick=()=>{
    const nm=b.closest('.item').querySelector('b').textContent.replace(/^🏢 /,'');
    if(!confirm('تحذف الشركة '+nm+'؟')) return;
    saveCompanies(getCompanies().filter(x=>x!==nm));
    try{const v=getVoices();delete v[nm];saveVoices(v)}catch(e){}
    renderCompanies();pushCompanies();toast('🗑️ تحذفات '+nm);
  }});
  box.querySelectorAll('[data-cedit]').forEach(b=>{b.onclick=()=>{
    const idx=+b.dataset.cedit, cos=getCompanies(), old=cos[idx];if(!old) return;
    const item=b.closest('.item'), meta=item.querySelector('.meta'), ops=item.querySelector('.ops');
    meta.innerHTML=`<span class="inputmic"><input id="ceditTmp" value="${escAttr(old)}"><button type="button" class="btn ghost sm" id="ceditMic" title="بالصوت">🎤</button></span>`;
    ops.innerHTML=`<button class="btn primary sm" data-csave>✅</button><button class="btn ghost sm" data-ccancel>❌</button>`;
    const inp=meta.querySelector('input');inp.focus();inp.select();
    $('ceditMic').onclick=()=>listenTo($('ceditMic'),inp);
    ops.querySelector('[data-csave]').onclick=()=>{
      const v=inp.value.trim();
      if(v.length<2){toast('⚠️ اسم قصير');return}
      if(cos.some((c,i)=>i!==idx&&c.toLowerCase()===v.toLowerCase())){toast('⚠️ مسجلة already');return}
      cos[idx]=v;saveCompanies(cos);
      try{const vv=getVoices();if(vv[old]&&old!==v){vv[v]=vv[old];delete vv[old];saveVoices(vv)}}catch(e){}
      let n=0;receipts.forEach(r=>{if((r.company||'')===old){r.company=v;n++}});
      if(n)save();
      renderCompanies();pushCompanies();render();toast(n?`✅ تعدلات (${n} بون تحدث)`:'✅ تعدلات');
    };
    ops.querySelector('[data-ccancel]').onclick=renderCompanies;
  }});
  // datalist for everyone: directory + companies already used
  const all=[...new Set([...getCompanies(),...receipts.map(r=>(r.company||'').trim()).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'ar'));
  const dl=$('companyList');if(dl) dl.innerHTML=all.map(c=>`<option value="${escAttr(c)}">`).join('');
}
$('addCompany').onclick=()=>{
  if(!isAdmin()){toast('⛔ للأدمن فقط');return}
  const v=$('newCompany').value.trim();
  if(v.length<2){$('companyMsg').textContent='⚠️ دخل اسم الشركة';return}
  const cos=getCompanies();
  if(cos.some(c=>c.toLowerCase()===v.toLowerCase())){$('companyMsg').textContent='⚠️ هادي مسجلة already';return}
  cos.push(v);saveCompanies(cos);$('newCompany').value='';$('companyMsg').textContent='✅ تزادت '+v;
  renderCompanies();pushCompanies();toast('✅ تزادت الشركة');
};
$('newCompany').addEventListener('keydown',e=>{if(e.key==='Enter')$('addCompany').click()});
if($('micNewCompany'))$('micNewCompany').onclick=e=>{e.preventDefault();listenTo($('micNewCompany'),$('newCompany'))};
// تصدير/استيراد الدليل (شركات + أصوات) للنقل لجهاز آخر
$('expCompanies').onclick=()=>{
  if(!isAdmin()){toast('⛔ للأدمن فقط');return}
  const data={app:'BonArchive-companies',v:1,at:new Date().toISOString(),companies:getCompanies(),voices:getVoices()};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.download='companies-backup.json';a.click();
  toast('📤 تحمل الدليل — صيفطو للجهاز الآخر');
};
$('impCompanies').onchange=e=>{
  if(!isAdmin()){toast('⛔ للأدمن فقط');e.target.value='';return}
  const f=e.target.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const d=JSON.parse(rd.result);
      if(!d||!Array.isArray(d.companies))throw new Error('bad');
      const cos=getCompanies(),low=new Set(cos.map(c=>c.toLowerCase()));let n=0;
      d.companies.forEach(c=>{c=String(c||'').trim();if(c.length>1&&!low.has(c.toLowerCase())){cos.push(c);low.add(c.toLowerCase());n++}});
      saveCompanies(cos);
      let nv=0;
      if(d.voices&&typeof d.voices==='object'){
        const vv=getVoices();
        Object.keys(d.voices).forEach(k=>{if(!vv[k]&&typeof d.voices[k]==='string'&&d.voices[k].indexOf('data:audio')===0){vv[k]=d.voices[k];nv++}});
        try{saveVoices(vv)}catch(err){toast('⚠️ بعض الأصوات ما تحفظاتش (التخزين عامر)')}
      }
      renderCompanies();pushCompanies();render();toast(`📥 تستوردو ${n} شركات + ${nv} أصوات`);
    }catch(err){toast('❌ ملف غير صالح')}
  };
  rd.readAsText(f);e.target.value='';
};
$('importCompanies').onchange=e=>{
  if(!isAdmin()){toast('⛔ للأدمن فقط');e.target.value='';return}
  const f=e.target.files[0];if(!f) return;
  if(typeof XLSX==='undefined'){toast('❌ مكتبة Excel ما تحملاتش — تحقق من الإنترنت');e.target.value='';return}
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const wb=XLSX.read(rd.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      // try named column first (الشركة/Company), else first column
      const rows=XLSX.utils.sheet_to_json(ws);
      let names=[];
      if(rows.length&&(rows[0]['الشركة']||rows[0].company||rows[0].Company)) names=rows.map(r=>String(r['الشركة']||r.company||r.Company||'').trim());
      else names=XLSX.utils.sheet_to_json(ws,{header:1}).map(r=>String((r[0]||'')).trim());
      names=names.filter(s=>s.length>1&&s!=='—');
      const cos=getCompanies();const low=new Set(cos.map(c=>c.toLowerCase()));let n=0;
      names.forEach(v=>{if(!low.has(v.toLowerCase())){cos.push(v);low.add(v.toLowerCase());n++}});
      saveCompanies(cos);$('companyMsg').textContent=`✅ تستوردو ${n} شركات من Excel`;
      renderCompanies();pushCompanies();toast(`📥 تستوردو ${n} شركات`);
    }catch(err){toast('❌ ملف Excel غير صالح')}
  };
  rd.readAsArrayBuffer(f);e.target.value='';
};
// ===== حساب اليوم (between archive & months) — بتاريخ مختار: المحطة + البونات + بيع آخر + المجموع =====
function hisabDay(){
  if($('hisabDay')&&!$('hisabDay').value) $('hisabDay').value=new Date().toISOString().slice(0,10);
  return ($('hisabDay')&&$('hisabDay').value)||new Date().toISOString().slice(0,10);
}
function syncDay(src){
  const v=$(src).value||new Date().toISOString().slice(0,10);
  if($('hisabDay')) $('hisabDay').value=v;
  if($('stDate')) $('stDate').value=v;
  loadStation();renderHisab();
}
function syncDayValue(v){
  if($('hisabDay')) $('hisabDay').value=v;
  if($('stDate')) $('stDate').value=v;
  loadStation();renderHisab();render();
}
function todayRows(){
  const t=hisabDay();
  let arr=totalsBase().filter(r=>r.date===t);
  // admin viewing an employee => his bons only
  let hv=null;try{hv=(isAdmin()&&typeof stView!=='undefined')?stView:null}catch(e){}
  if(hv) arr=arr.filter(r=>(r.takenBy||'—')===hv);
  return arr;
}
function renderHisab(){
  if(!$('hisabDate')) return;
  const t=hisabDay();
  $('hisabDate').textContent=t;
  const arr=todayRows();
  // بيع آخر: مبلغ يدوي لكل موظف (خاوي للي ما عندو والو) + fallback للقديم بلا سمية
  const otherEmp=(()=>{try{return (isAdmin()&&typeof stView!=='undefined'&&stView)?stView:currentUser()}catch(e){return currentUser()}})()||'زائر';
  const otherKey='bon_other_'+t+'_'+otherEmp;
  const otherGet=()=>{try{const v=localStorage.getItem(otherKey);if(v!==null&&v!=='')return v;return localStorage.getItem('bon_other_'+t)||''}catch(e){return ''}};
  const roOther=!!(isAdmin()&&typeof stView!=='undefined'&&stView&&stView!==currentUser());
  $('hOther').disabled=roOther;
  if(document.activeElement!==$('hOther')){$('hOther').value=otherGet()}
  $('hTotal').textContent=arr.reduce((s,r)=>s+(+r.amount||0),0)+' درهم';
  // المجموع الكلي = مجموع حسابات المحطة (حسب المعروض) − مجموع بونات اليوم (حسب المعروض)
  const stTot=stScopeTotal(t);
  const todayTot=arr.reduce((s,r)=>s+(+r.amount||0),0);
  let other2=0;try{other2=parseFloat(otherGet()||'0')||0}catch(e){}
  $('hCredit').textContent=(Math.round((stTot-todayTot+other2)*100)/100)+' درهم';
  const pm={};arr.forEach(r=>{const k=r.pay||'—';pm[k]=pm[k]||{n:0,tot:0};pm[k].n++;pm[k].tot+=(+r.amount||0)});
  $('hPay').innerHTML=Object.keys(pm).length?Object.keys(pm).map(k=>`<div class="folder" style="font-size:14px">💵<b>${k}</b><span>${pm[k].n} • ${pm[k].tot} DH</span></div>`).join(''):'<p class="hint">لا بونات اليوم.</p>';
  const em={};arr.forEach(r=>{const k=r.takenBy||'—';em[k]=em[k]||{n:0,tot:0};em[k].n++;em[k].tot+=(+r.amount||0)});
  $('hEmp').innerHTML=Object.keys(em).length?Object.keys(em).map(k=>`<div class="folder" style="font-size:14px">👤<b>${k}</b><span>${em[k].n} • ${em[k].tot} DH</span></div>`).join(''):'<p class="hint">لا بونات اليوم.</p>';
  $('hList').innerHTML=arr.length?arr.map(r=>`<div class="item">${r.img?`<img src="${r.img}" style="width:52px;height:52px;min-width:52px">`:`<div style="position:relative;width:52px;height:52px;min-width:52px"><div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#ede9fe,#cffafe);display:flex;align-items:center;justify-content:center;font-size:24px">📷</div>${r.driveId?`<img src="https://drive.google.com/thumbnail?id=${r.driveId}&sz=w200" loading="lazy" style="position:absolute;inset:0;width:52px;height:52px;object-fit:cover;border-radius:12px" onerror="this.remove()" alt="">`:''}</div>`}<div class="meta"><b>${r.company}</b> • 🧾 ${r.number}<br>💰 <b>${r.amount} DH</b> • ${r.pay||''} • 👤 ${r.takenBy||'—'}${r.credit?(r.credit.unpaid?' • 🔴 كريدي':' • 🟢 مخلص'):''}</div></div>`).join(''):'<p class="hint">ما زال ما تصور حتى بون اليوم.</p>';
}
$('expToday').onclick=()=>{
  if(typeof XLSX==='undefined'){toast('❌ مكتبة Excel ما تحملاتش');return}
  const arr=todayRows();
  if(!arr.length){toast('⚠️ لا بونات هاد النهار');return}
  const other=parseFloat($('hOther').value)||0;
  const rows=arr.map(r=>({'الشركة':r.company,'الرقم':r.number,'المبلغ DH':r.amount,'الأداء':r.pay||'','الموظف':r.takenBy||'—','الكريدي':r.credit?(r.credit.unpaid?'غير مخلص':'مخلص'):'—','الملف':r.fileName}));
  rows.push({'الشركة':'بيع آخر','المبلغ DH':other});
  const ws=XLSX.utils.json_to_sheet(rows);
  ws['!cols']=[{wch:22},{wch:16},{wch:12},{wch:16},{wch:18},{wch:12},{wch:42}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Hisab');
  XLSX.writeFile(wb,`hisab-${hisabDay()}.xlsx`);toast('📗 تحمل حساب اليوم');
};
$('printToday').onclick=()=>window.print();
if($('showDayImgs'))$('showDayImgs').onclick=()=>{
  const ids=todayRows().filter(r=>!r.img&&r.driveId).map(r=>r.driveId);
  if(!ids.length){toast('✅ كل الصور معروضة already');return}
  fetchImgs(ids);
};
$('hOther').addEventListener('input',()=>{try{localStorage.setItem('bon_other_'+hisabDay()+'_'+(currentUser()||'زائر'),$('hOther').value)}catch(e){}schedulePush();renderHisab()});
$('hisabDay').addEventListener('change',()=>syncDay('hisabDay'));
// ===== ⛽ حساب المحطة لكل موظف: عدادات + ثمن => كمية + مبلغ + مجموع =====
const ST_KEY='bon_station_';
// حاسبة بحال Excel: "100+50*2" => 200 (أرقام و + - * / ( ) فقط)
function evalExpr(s){
  s=String(s==null?'':s).trim().replace(/,/g,'.');
  if(!s) return 0;
  if(!/^[0-9+\-*/().\s]+$/.test(s)) return NaN;
  try{const v=Function('"use strict";return('+s+')')();return (typeof v==='number'&&isFinite(v))?Math.round(v*100)/100:NaN}catch(e){return NaN}
}
const ST_N=9;
const ST_NAMES=['F.S GASOIL','V.SSP','V.P DIESEL','F.S SANS PLOMBE','F.S GASOIL','V.SSP','V.P DIESEL','F.S SANS PLOMBE','mélange'];
// ترحيل مرة واحدة: mélange كان index 4 ولى index 8 — نعاود ترتيب المصفوفات المحفوظة
(function stOrderV2(){
  try{
    if(localStorage.getItem('bon_storder_v2')) return;
    const map=[0,1,2,3,5,6,7,8,4];
    const remap=a=>map.map(i=>a[i]);
    for(let i=localStorage.length-1;i>=0;i--){
      const k=localStorage.key(i);
      if(!k||k.indexOf(ST_KEY)!==0) continue;
      const rest=k.slice(ST_KEY.length);
      if(!/^\d{4}-\d{2}-\d{2}(_.+)?$/.test(rest)) continue;
      try{
        const d=JSON.parse(localStorage.getItem(k));
        if(d&&Array.isArray(d.a)&&d.a.length===9){
          d.a=remap(d.a);d.b=remap(d.b);d.p=remap(d.p);
          if(Array.isArray(d.names)&&d.names.length===9)d.names=remap(d.names);
          localStorage.setItem(k,JSON.stringify(d));
        }
      }catch(e){}
    }
    try{
      const p=JSON.parse(localStorage.getItem(PR_KEY)||'null');
      if(Array.isArray(p)&&p.length===9)localStorage.setItem(PR_KEY,JSON.stringify(remap(p)));
    }catch(e){}
    localStorage.setItem('bon_storder_v2','1');
  }catch(e){}
})();
// الأثمنة عامة وثابتة: الأدمن يحددها، العمال يشوفوها فيكس
const PR_KEY='bon_prices';
function getPrices(){try{const p=JSON.parse(localStorage.getItem(PR_KEY)||'null');if(Array.isArray(p)){if(p.length===ST_N)return p;if(p.length===5&&ST_N===9)return [...p,p[0],p[1],p[2],p[3]]}}catch(e){}return Array(ST_N).fill(0)}
function savePrices(p){try{localStorage.setItem(PR_KEY,JSON.stringify(p))}catch(e){}}
let stView=null; // admin: اسم الموظف المعروض (null = حسابي)
function stEmp(){return stView||currentUser()}
function stKey(dt,emp){return ST_KEY+dt+'_'+emp}
function stTotalOf(d){let t=0;for(let i=0;i<ST_N;i++)t+=((+d.b[i]||0)-(+d.a[i]||0))*(+d.p[i]||0);return Math.round(t*100)/100}
function stDayTotal(dt){
  // مجموع حسابات المحطة ديال نهار (كل العمال + القديم بلا تكرار)
  let tot=0,hasSuffixed=false;const keys=[];
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k===ST_KEY+dt)keys.push(k);else if(k.indexOf(ST_KEY+dt+'_')===0){keys.push(k);hasSuffixed=true}}
  keys.forEach(k=>{
    if(k===ST_KEY+dt&&hasSuffixed) return; // قديم محسوب already مع المسماة
    try{const d=JSON.parse(localStorage.getItem(k));if(d&&d.a)tot+=stTotalOf(d)}catch(e){}
  });
  return Math.round(tot*100)/100;
}
// station total scoped like bons: admin viewing emp => his station; worker => own; admin => all
function stScopeTotal(dt){
  let emp=null;try{emp=isAdmin()?((typeof stView!=='undefined')?stView:null):scopeName()}catch(e){}
  if(emp){
    try{
      const d=JSON.parse(localStorage.getItem(stKey(dt,emp))||'null');
      return d?stTotalOf(d):0;
    }catch(e){return 0}
  }
  return stDayTotal(dt);
}
function stData(){
  const d={names:[],a:[],b:[],p:[],by:stEmp(),at:new Date().toISOString()};
  for(let i=0;i<ST_N;i++){d.names.push($('st-name-'+i)?($('st-name-'+i).value||ST_NAMES[i]):ST_NAMES[i]);d.a.push(evalExpr($('st-a-'+i).value)||0);d.b.push(evalExpr($('st-b-'+i).value)||0);d.p.push(evalExpr($('st-p-'+i).value)||0)}
  return d;
}
// Excel formulas need text inputs (type=number blocks + - * /)
for(let i=0;i<ST_N;i++){['st-a-','st-b-','st-p-'].forEach(p=>{const el=$(p+i);if(el){try{el.type='text'}catch(e){}el.inputMode='decimal';el.setAttribute('inputmode','decimal')}})}
// ملي تخرج من الخانة: إلا فيها عملية حسابية كتتحول للنتيجة
for(let i=0;i<ST_N;i++){['st-a-','st-b-','st-p-'].forEach(p=>{const el=$(p+i);if(el)el.addEventListener('change',()=>{const v=evalExpr(el.value);if(!isNaN(v)){el.value=v;calcStation()}})})}
// طابع زمني محلي لمفاتيح حسابات المحطة (لدمج الصحيح)
function getStMeta(){try{return JSON.parse(localStorage.getItem('bon_stmeta')||'{}')}catch(e){return{}}}
function setStMeta(k){try{const m=getStMeta();m[k]=Date.now();localStorage.setItem('bon_stmeta',JSON.stringify(m))}catch(e){}}
function stReadOnly(){return !!(stView&&stView!==currentUser())}
function calcStation(save=true){
  if(!$('stDate')) return;
  if(!$('stDate').value) $('stDate').value=new Date().toISOString().slice(0,10);
  const d=stData();let tot=0;
  for(let i=0;i<ST_N;i++){
    const q=d.b[i]-d.a[i], m=q*d.p[i];tot+=m;
    const qEl=$('st-q-'+i),mEl=$('st-m-'+i);
    qEl.textContent=(Math.round(q*100)/100);mEl.textContent=(Math.round(m*100)/100)+' DH';
    qEl.parentElement.classList.toggle('neg',q<0);mEl.parentElement.classList.toggle('neg',m<0);
  }
  $('st-total').textContent=(Math.round(tot*100)/100)+' DH';
  if(save&&!stReadOnly()){
    const skey=stKey($('stDate').value,stEmp());
    const hasAny=d.a.some(v=>v>0)||d.b.some(v=>v>0);
    if(hasAny){
      let prev=null;try{prev=JSON.parse(localStorage.getItem(skey)||'null')}catch(e){}
      if(prev&&prev.sent&&!isAdmin())d.sent=prev.sent; // الإرسال يبقى
      if(prev&&prev.confirmed){
        if(!isAdmin()){d.confirmed=null} // العامل بدل بعد التأكيد => خاص إعادة تأكيد
        else d.confirmed=prev.confirmed;
      }
      try{localStorage.setItem(skey,JSON.stringify(d));setStMeta(skey)}catch(e){}
    }
    if(isAdmin()){savePrices(d.p);pushPrices()} // ثمن الأدمن هو المرجع الثابت للكل + دفع للسيرفر
    schedulePush();
  }
  updateStStatus();
  if(typeof renderHisab==='function')renderHisab(); // المجموع الكلي يتبدل مباشرة مع العدادات
}
// حالة حساب المعروض: مسودة / مرسل / مؤكد
function stStatusOf(){
  try{
    const d=JSON.parse(localStorage.getItem(stKey($('stDate').value||new Date().toISOString().slice(0,10),stEmp()))||'null');
    if(d&&d.confirmed)return {k:'ok',t:`✅ مؤكد من طرف ${d.confirmed.by}`};
    if(d&&d.sent)return {k:'sent',t:`📨 مرسل للأدمن`};
  }catch(e){}
  return {k:'draft',t:''};
}
function updateStStatus(){
  const el=$('stStatus');if(!el)return;
  const s=stStatusOf();
  el.textContent=s.t;
  el.style.display=s.t?'':'none';
}
function fillStation(d){
  const gp=getPrices();
  for(let i=0;i<ST_N;i++){
    if($('st-name-'+i))$('st-name-'+i).value=(d&&d.names[i])||ST_NAMES[i];
    if(d){$('st-a-'+i).value=d.a[i]||'';$('st-b-'+i).value=d.b[i]||'';$('st-p-'+i).value=(d.p[i]!==undefined&&d.p[i]!==''&&+d.p[i]!==0)?d.p[i]:(gp[i]||'')}
    else{$('st-a-'+i).value='';$('st-b-'+i).value='';$('st-p-'+i).value=gp[i]||''}
  }
}
// أرشيف حسابات المحطة: كل واحد وأرشيفو (العامل: ديالو فقط / الأدمن: الكل)
function stationRecords(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(k.indexOf(ST_KEY)!==0) continue;
    const rest=k.slice(ST_KEY.length);
    const m=rest.match(/^(\d{4}-\d{2}-\d{2})_(.+)$/);
    let dt,emp;
    if(m){dt=m[1];emp=m[2]} else if(/^\d{4}-\d{2}-\d{2}$/.test(rest)){dt=rest;emp='— (قديم)'} else continue;
    try{
      const d=JSON.parse(localStorage.getItem(k));
      if(!d||!d.a) continue;
      out.push({key:k,date:dt,emp,total:stTotalOf(d),sent:!!d.sent,confirmed:!!d.confirmed,by:(d.confirmed&&d.confirmed.by)||(d.sent&&d.sent.by)||''});
    }catch(e){}
  }
  out.sort((a,b)=>b.date.localeCompare(a.date));
  const me=scopeName(); // العامل: غير سجلاتو
  return me?out.filter(r=>r.emp===me):out;
}
function renderStArchive(){
  const box=$('stArchive');if(!box) return;
  const recs=stationRecords();
  if(!recs.length){box.innerHTML='<p class="hint">لا حسابات محفوظة بعد.</p>';return}
  box.innerHTML=recs.map((r,i)=>`<div class="item"><div class="meta"><b>📅 ${r.date}</b> • 👤 ${r.emp} ${r.confirmed?'✅':(r.sent?'📨':'✏️')}<br>💰 <b>${r.total} DH</b>${r.confirmed?` • ✅ مؤكد (${r.by})`:(r.sent?' • 📨 مرسل':" — ⏳ مسودة")}</div><div class="ops"><button class="btn ghost sm" data-open="${i}">👁️</button>${isAdmin()?`<button class="btn danger sm" data-sdel="${i}">🗑️</button>`:''}</div></div>`).join('');
  box.querySelectorAll('[data-open]').forEach(b=>{b.onclick=()=>{
    const r=recs[+b.dataset.open];if(!r) return;
    if(isAdmin()) stView=(r.emp===currentUser())?null:r.emp;
    syncDayValue(r.date);
    document.querySelector('.stable').scrollIntoView({behavior:'smooth',block:'center'});
    toast('📂 تحل حساب '+r.date);
  }});
  box.querySelectorAll('[data-sdel]').forEach(b=>{b.onclick=()=>{
    if(!isAdmin()){toast('⛔ للأدمن فقط');return}
    const r=recs[+b.dataset.sdel];if(!r) return;
    if(!confirm(`تمسح حساب ${r.date} ديال ${r.emp} نهائيا؟ (من جميع الأجهزة)`)) return;
    tombStation(r.key);localStorage.removeItem(r.key);schedulePush();render();toast('🗑️ تمسح');
  }});
}
function renderStEmps(){  const row=$('stAdminRow');if(!row) return;
  const show=isAdmin();
  row.hidden=!show;
  if(!show) return;
  const dt=$('stDate').value||new Date().toISOString().slice(0,10);
  const users=getUsers();
  $('stEmps').innerHTML=users.map(u=>{
    let st='⬜';
    try{const d=JSON.parse(localStorage.getItem(stKey(dt,u.name))||'null');
      if(d&&d.a)st=d.confirmed?'✅':(d.sent?'📨':'✏️')}catch(e){}
    const active=(stView||currentUser())===u.name;
    return `<button class="btn sm ${active?'primary':'ghost'}" data-stemp="${u.name}">${st} ${u.name}${u.role==='admin'?' 👑':''}</button>`;
  }).join('')||'<p class="hint">لا موظفين.</p>';
  $('stEmps').querySelectorAll('[data-stemp]').forEach(b=>{b.onclick=()=>{
    const n=b.dataset.stemp;stView=(n===currentUser())?null:n;loadStation();render();
  }});
  const v=stEmp();
  $('stViewMsg').textContent=stReadOnly()?`👁️ عرض فقط — حساب ${v} (مجموعو: ${$('st-total').textContent})`:`✍️ حسابك نتا (${v})`;
  const cf=$('stConfirm');
  if(cf){
    let hasRec=false;
    try{const d=JSON.parse(localStorage.getItem(stKey($('stDate').value||new Date().toISOString().slice(0,10),v))||'null');hasRec=!!(d&&d.a)}catch(e){}
    cf.hidden=!(stReadOnly()&&hasRec);
  }
}
function loadStation(){
  if(!$('stDate')) return;
  if(!$('stDate').value) $('stDate').value=new Date().toISOString().slice(0,10);
  if(!isAdmin()) stView=null; // العامل: غير حسابو
  const dt=$('stDate').value, emp=stEmp();
  let d=null;
  try{d=JSON.parse(localStorage.getItem(stKey(dt,emp))||'null')}catch(e){}
  fillStation(d); // بلا سجل => خانات خاوية ديما
  const ro=stReadOnly();
  // أسماء المنتجات ثابتة: التعديل للأدمن فقط
  const roName=ro||!isAdmin();
  // الثمن ثابت للعمال: غير الأدمن يبدلو
  const roPrice=ro||!isAdmin();
  for(let i=0;i<ST_N;i++){['st-a-','st-b-'].forEach(p=>{$(p+i).disabled=ro});if($('st-p-'+i))$('st-p-'+i).disabled=roPrice;if($('st-name-'+i))$('st-name-'+i).disabled=roName}
  $('stClear').disabled=ro;
  renderStEmps();
  calcStation(false);
}
for(let i=0;i<ST_N;i++){['st-name-','st-a-','st-b-','st-p-'].forEach(p=>{if($(p+i))$(p+i).addEventListener('input',()=>calcStation())})}
// تنقل لوحة المفاتيح في العدادات: Enter/OK للتحت + الأسهم الأربعة (يمين/شمال/فوق/تحت)
const ST_ROWS=['st-name-','st-b-','st-a-','st-p-'];
const ST_ORDER=[];ST_ROWS.forEach(p=>{for(let c=0;c<ST_N;c++)ST_ORDER.push(p+c)});
let stNavAt=0, stNavTarget=null, stNavOrigin=null;
function stFocus(r,c,origin){const el=$(ST_ROWS[r]+c);if(el&&!el.disabled){stNavAt=Date.now();stNavTarget=el;stNavOrigin=origin||null;el.focus();try{el.select()}catch(e){}}}
ST_ROWS.forEach((p,r)=>{for(let c=0;c<ST_N;c++){if(!$(p+c))continue;$(p+c).addEventListener('keydown',e=>{
  let nr=r,nc=c,move=false;
  if(e.key==='Enter'){nr=r+1;move=true}
  else if(e.key==='ArrowDown'){nr=r+1;move=true}
  else if(e.key==='ArrowUp'){nr=r-1;move=true}
  else if(e.key==='ArrowLeft'){nc=c+1;move=true}
  else if(e.key==='ArrowRight'){nc=c-1;move=true}
  if(move){e.preventDefault();e.stopPropagation();nr=Math.max(0,Math.min(ST_ROWS.length-1,nr));nc=Math.max(0,Math.min(ST_N-1,nc));stFocus(nr,nc,p+c)}
})}});
// الهاتف كيزيد قفزة أصلية (Next) فوق ديالنا => نرجعو للخانة المقصودة
document.querySelector('.stable').addEventListener('focusin',e=>{
  if(!stNavTarget||e.target===stNavTarget) return;
  if(Date.now()-stNavAt>400){stNavTarget=null;return}
  const oi=ST_ORDER.indexOf(stNavOrigin);
  const expected=(oi>=0&&oi+1<ST_ORDER.length)?$(ST_ORDER[oi+1]):null;
  if(expected&&e.target===expected){stNavTarget.focus();try{stNavTarget.select()}catch(_){}}
  else stNavTarget=null; // ضغطة يدوية في بلاصة أخرى => نقبلوها
});
$('stDate').addEventListener('change',()=>syncDay('stDate'));
if($('updPrices'))$('updPrices').onclick=()=>{pullPrices(false)};
$('stClear').onclick=()=>{if(stReadOnly()){toast('⛔ عرض فقط');return}if(!confirm('تمسح حساب هاد النهار؟ (غيمشي من جميع الأجهزة)'))return;const ck=stKey($('stDate').value,stEmp());tombStation(ck);localStorage.removeItem(ck);localStorage.removeItem(ST_KEY+$('stDate').value);for(let i=0;i<ST_N;i++){$('st-a-'+i).value='';$('st-b-'+i).value=''}calcStation();schedulePush();renderStEmps();renderStArchive()};
// 📨 زر الإرسال: العامل يبعث حسابو للأدمن (يبان تلقائيا عندهم)
if($('stSend'))$('stSend').onclick=async()=>{
  if(stReadOnly()){toast('⛔ عرض فقط');return}
  calcStation(true);
  const chk=stData();
  if(!chk.b.some(v=>v>0)){toast('⚠️ عمر العدادات أولا — والو ما يتبعث');return}
  const key=stKey($('stDate').value,stEmp());
  let d=null;try{d=JSON.parse(localStorage.getItem(key)||'null')}catch(e){}
  if(!d||!d.a){toast('⚠️ عمر العدادات أولا');return}
  d.sent={by:currentUser(),at:new Date().toISOString()};
  try{localStorage.setItem(key,JSON.stringify(d));setStMeta(key)}catch(e){}
  updateStStatus();renderStEmps();renderStArchive();
  toast('⏳ كنبعث...');
  const ok=await pushDataNow();
  toast(ok===true?'📨 تبعث للأدمن ✅':pushFailMsg(ok));
};
if($('stConfirm'))$('stConfirm').onclick=async()=>{
  if(!isAdmin()||!stView){toast('⚠️ اختار حساب عامل أولا');return}
  await pullData(true);
  const key=stKey($('stDate').value,stView);
  let d=null;try{d=JSON.parse(localStorage.getItem(key)||'null')}catch(e){}
  if(!d||!d.a){toast('⚠️ هاد العامل ما عمر والو هاد النهار');return}
  d.confirmed={by:currentUser(),at:new Date().toISOString().slice(0,10)};
  try{localStorage.setItem(key,JSON.stringify(d));setStMeta(key)}catch(e){}
  toast('⏳ كنأكد...');
  const ok2=await pushDataNow();
  updateStStatus();renderStEmps();renderStArchive();renderHisab();
  toast(ok2===true?('✅ تأكدت عملية اليوم ديال '+stView):pushFailMsg(ok2));
};
$('stExcel').onclick=()=>{
  if(typeof XLSX==='undefined'){toast('❌ مكتبة Excel ما تحملاتش');return}
  const d=stData();const dt=$('stDate').value;
  const rows=d.names.map((n,i)=>({'المنتج':n||('P'+(i+1)),'العداد الأول':d.a[i],'العداد الثاني':d.b[i],'الكمية (L)':Math.round((d.b[i]-d.a[i])*100)/100,'الثمن (DH/L)':d.p[i],'المبلغ (DH)':Math.round((d.b[i]-d.a[i])*d.p[i]*100)/100}));
  rows.push({'المنتج':'المجموع العام','المبلغ (DH)':Math.round(rows.reduce((s,r)=>s+(+r['المبلغ (DH)']||0),0)*100)/100});
  const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:16},{wch:14},{wch:14},{wch:12},{wch:14},{wch:14}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Station');
  XLSX.writeFile(wb,`station-${dt}-${stEmp()}.xlsx`);toast('📗 تحمل حساب المحطة');
};
loadStation();
// ===== بحث بالصوت 🎤 (Web Speech API) =====
function listenTo(btn, input, onText){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){toast('❌ المتصفح ما كيدعمش الصوت — جرب Chrome');return}
  try{
    const rec=new SR();
    rec.lang='fr-FR';rec.interimResults=false;rec.maxAlternatives=1;
    btn.classList.add('listening');
    rec.onresult=e=>{
      const txt=e.results[0][0].transcript||'';
      input.value=txt;input.classList.remove('invalid');
      input.dispatchEvent(new Event('input',{bubbles:true}));
      if(onText) onText(txt);
      toast('🎤 '+txt);
    };
    rec.onerror=e=>{toast('❌ الصوت ما تخدمش ('+(e.error||'؟')+') — خاص HTTPS');};
    rec.onend=()=>btn.classList.remove('listening');
    rec.start();
  }catch(e){btn.classList.remove('listening');toast('❌ تعذر تشغيل الميكروفون')}
}
if($('micCompany')) $('micCompany').onclick=e=>{e.preventDefault();listenTo($('micCompany'),$('fCompany'))};
if($('hearCompany')) $('hearCompany').onclick=e=>{
  e.preventDefault();
  const v=$('fCompany').value.trim();
  if(!v){toast('⚠️ كتب السمية أولا');return}
  const vv=getVoices();
  const key=Object.keys(vv).find(k=>k.toLowerCase()===v.toLowerCase());
  if(!key){toast('⚠️ ما كاين حتى تسجيل لهاد السمية');return}
  playVoice(key);
};
if($('micSearch')) $('micSearch').onclick=e=>{e.preventDefault();listenTo($('micSearch'),$('search'))};
// ===== اقتراحات الشركات (لائحة مخصصة خدامة في الهاتف) =====
function coNames(){return [...new Set([...getCompanies(),...receipts.map(r=>(r.company||'').trim()).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'ar'))}
function renderCoSugg(){
  const box=$('coSugg'),inp=$('fCompany');if(!box||!inp) return;
  const q=inp.value.trim().toLowerCase();
  if(!q){box.hidden=true;return}
  const list=coNames().filter(c=>c.toLowerCase().includes(q)).slice(0,8);
  if(!list.length){box.hidden=true;return}
  box.innerHTML=list.map(c=>`<div class="sugg-it" data-v="${escAttr(c)}">🏢 ${escAttr(c)}</div>`).join('');
  box.hidden=false;
  box.querySelectorAll('.sugg-it').forEach(d=>{d.onmousedown=e=>{e.preventDefault();inp.value=d.dataset.v;inp.classList.remove('invalid');updateAutoName();box.hidden=true;inp.focus()}});
}
if($('fCompany')){$('fCompany').addEventListener('input',renderCoSugg);$('fCompany').addEventListener('focus',renderCoSugg)}
document.addEventListener('click',e=>{const b=$('coSugg');if(b&&!b.hidden&&!e.target.closest('#coSugg')&&e.target!==$('fCompany'))b.hidden=true});
// ===== جلب أرشيف البونات من Drive (الميتا للكل، الصور تبقى في Drive) =====
function parseDriveFile(f){
  const parts=(f.desc||'').split('|').map(s=>s.trim());
  const fn=f.name||'';
  const fm=fn.match(/^(\d{4}-\d{2}-\d{2})_(.*)_([^_]+)_([\d.]+)DH\.jpe?g$/i);
  let company='',number='',date='',amount=0,emp=(f.emp||'—'),credit=null;
  if(fm){date=fm[1];company=fm[2].replace(/_/g,' ');number=fm[3];amount=parseFloat(fm[4])||0}
  if(parts.length>=5){
    emp=(parts[0].replace(/^👤\s*/,'')||emp);
    let i=1;
    if(/كريدي/.test(parts[1])){credit={unpaid:parts[1].indexOf('غير مخلص')>=0,paidBy:null,paidAt:null};i=2}
    company=parts[i]||company;number=parts[i+1]||number;date=String(parts[i+2]||date).slice(0,10);amount=parseFloat(parts[i+3])||amount;
  }
  if(!date||!company||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const mext=(fn.match(/\.(jpe?g|png|webp)$/i)||[])[1]||'jpg';
  const mime=/png/i.test(mext)?'image/png':(/webp/i.test(mext)?'image/webp':'image/jpeg');
  return {company,number,date,amount,type:'بون Bon',pay:'',credit,note:'',fileName:fn,mime,month:date.slice(0,7),takenBy:emp,del:null};
}
async function pullDriveArchive(silent){
  const me=getUser();if(!me){if(!silent)toast('⚠️ سجل الدخول أولا');return false}
  if(!silent)toast('☁️ كنجيب الأرشيف من Drive...');
  const r=await apiU('invList',{by:me.name,byHash:me.hash,root:(($('rootFolder')||{}).value||'').trim()||'Bons_Archivage'});
  if(!r||!r.ok){if(!silent)toast('❌ تعذر الجلب'+(r&&r.error==='forbidden'?' — سجل الدخول مجددا':''));return false}
  const have=new Set(receipts.map(x=>x.driveId).filter(Boolean));
  let n=0;
  (r.files||[]).forEach(f=>{
    if(f.id&&have.has(f.id))return;
    const m=parseDriveFile(f);if(!m)return;
    if(tombedLocal(m))return; // محذوف عند الأدمن => ما يرجعش من Drive
    const same=receipts.find(x=>metaSame(x,m));
    if(same){if(!same.driveId&&f.id){same.driveId=f.id;same.driveUrl=f.url;n++}return} // موجود already => ربط/تخطي، أبدا ما نكرر
    receipts.unshift({id:Date.now()+Math.random()+n,driveId:f.id,driveUrl:f.url,img:'',...m,created:f.ct||new Date().toISOString()});
    if(f.id)have.add(f.id);n++;
  });
  if(n){try{save()}catch(e){toast('⚠️ تجلبو ولكن التخزين عامر — بعض الصور ما تحفظاتش محليا')}}
  render();
  toast(n?`☁️ تجلبو ${n} بون من Drive`:(silent?'':'✅ الأرشيف محدث already'));
  return true;
}
// مسح ملف البون من Drive (للأدمن فقط — الحذف النهائي)
async function deleteDriveFile(r){
  if(!r||!r.driveId)return true;
  try{
    if(backendUrl()){
      const me=getUser();
      const x=await apiU('fileDel',{id:r.driveId,by:me.name,byHash:me.hash});
      return !!(x&&x.ok);
    }
    if(typeof gToken!=='undefined'&&gToken){
      const del=await fetch('https://www.googleapis.com/drive/v3/files/'+r.driveId,{method:'DELETE',headers:{Authorization:'Bearer '+gToken}});
      return del.ok;
    }
  }catch(e){}
  return false;
}
// ===== صور البونات عبر السيرفر (بلا Gmail عند المشاهد) =====
async function fetchImgs(ids){
  const me=getUser();ids=[...new Set(ids||[])].filter(Boolean).slice(0,30);
  if(!me||!ids.length)return 0;
  if(!backendUrl()){toast('⚠️ خاص رابط السيرفر');return 0}
  toast('🖼️ كنجيب الصور...');
  const r=await apiU('imgsGet',{by:me.name,byHash:me.hash,ids});
  if(!r||!r.ok){toast('❌ تعذر جلب الصور');return 0}
  let n=0;
  Object.keys(r.imgs||{}).forEach(id=>{
    const it=r.imgs[id];if(!it||!it.data)return;
    const rec=receipts.find(x=>x.driveId===id);
    if(rec&&!rec.img){rec.img='data:'+(it.mime||'image/jpeg')+';base64,'+it.data;n++}
  });
  if(n)render();
  toast(n?`🖼️ تجلبو ${n} صور`:'⚠️ ما تجلب والو');
  return n;
}
// ===== JPG/Image -> PDF (jsPDF) =====
function receiptToPdf(img, meta){
  if(typeof window.jspdf==='undefined'){toast('❌ مكتبة PDF ما تحملاتش — تحقق من الإنترنت');return}
  toast('📄 كنصايب PDF...');
  const im=new Image();
  im.onload=()=>{
    try{
      const {jsPDF}=window.jspdf;
      const landscape=im.width>im.height;
      const pdf=new jsPDF({unit:'mm',format:'a4',orientation:landscape?'landscape':'portrait'});
      const PW=landscape?297:210, PH=landscape?210:297;
      // header bar
      pdf.setFillColor(76,29,149);pdf.rect(0,0,PW,26,'F');
      pdf.setTextColor(255,255,255);pdf.setFont('helvetica','bold');pdf.setFontSize(15);
      pdf.text('Bon Archive - '+ (meta.type||'Bon'), 10, 11);
      pdf.setFontSize(10);pdf.setFont('helvetica','normal');
      pdf.text(`${meta.company||''}  |  ${meta.number||''}  |  ${meta.date||''}  |  ${meta.amount||0} DH`, 10, 18.5);
      // image fitted below header
      const maxW=PW-20, maxH=PH-26-22;
      const k=Math.min(maxW/im.width, maxH/im.height);
      const w=im.width*k, h=im.height*k;
      const fmt=/data:image\/png/i.test(img)?'PNG':'JPEG';
      pdf.addImage(img,fmt,(PW-w)/2,26+(maxH-h)/2,w,h);
      // footer
      pdf.setFontSize(9);pdf.setTextColor(100,100,140);
      pdf.text(`Employee: ${meta.takenBy||'-'}   |   ${meta.fileName||''}`, 10, PH-6);
      pdf.save((meta.fileName||'bon').replace(/\.(jpe?g|png|webp)$/i,'')+'.pdf');
      toast('📄 تحمل PDF بنجاح');
    }catch(e){console.error(e);toast('❌ فشل إنشاء PDF')}
  };
  im.onerror=()=>toast('❌ تعذر قراءة الصورة');
  im.src=img;
}
$('savePdf').onclick=()=>{
  if(!currentImage){toast('📸 صوّر البون أولا');return}
  if(!requireCompany()) return;
  const {name}=updateAutoName();
  receiptToPdf(currentImage,{type:$('fType').value,company:$('fCompany').value.trim()||'—',number:$('fNumber').value.trim()||'—',date:$('fDate').value,amount:$('fAmount').value||0,takenBy:currentUser(),fileName:name});
};

// Render list + stats + folders
function render(){
  const q=($('search').value||'').toLowerCase();
  const mf=$('filterMonth').value||currentMonthFilter;
  const ef=$('filterEmp').value||'';
  // migrate old receipts: takenBy + auto-credit from pay method
  let migrated=false;
  receipts.forEach(r=>{if(!r.takenBy){r.takenBy='—';migrated=true}
    if(!r.mime){r.mime='image/jpeg';migrated=true}
    if(!('del' in r)){r.del=null;migrated=true}
    if(!('credit' in r)){r.credit=/كريدي|cr[eé]dit/i.test(r.pay||'')?{unpaid:true,paidBy:null,paidAt:null}:null;migrated=true}});
  if(migrated) save();
  const base=totalsBase();
  // employee filter options
  const emps=[...new Set(base.map(r=>r.takenBy||'—'))];
  const sel=$('filterEmp');const cur=sel.value;
  sel.innerHTML='<option value="">👥 كل الموظفين</option>'+emps.map(e=>`<option ${e===cur?'selected':''}>${e}</option>`).join('');
  let arr=listPool().filter(r=>
    (!q||(r.company+r.number+r.note+(r.takenBy||'')).toLowerCase().includes(q)) &&
    (!mf||r.month===mf) &&
    (!currentDayFilter||r.date===currentDayFilter) &&
    (!ef||(r.takenBy||'—')===ef) &&
    (!outsideOnly||r.date!==new Date().toISOString().slice(0,10)));
  const box=$('list');box.innerHTML='';
  if(!arr.length) box.innerHTML='<p class="hint" style="text-align:center">لا توجد بونات — صوّر أول بون من تبويب إضافة 📸</p>';
  arr.forEach(r=>{
    const d=document.createElement('div');d.className='item';
    d.innerHTML=`${r.img?`<img src="${r.img}">`:`<div data-a="img" title="ضغط باش تحمل الصورة" style="position:relative;width:78px;height:78px;min-width:78px;cursor:pointer"><div style="width:78px;height:78px;border-radius:14px;background:linear-gradient(135deg,#ede9fe,#cffafe);display:flex;align-items:center;justify-content:center;font-size:30px">${r.driveId?'📷':'📗'}</div>${r.driveId?`<img src="https://drive.google.com/thumbnail?id=${r.driveId}&sz=w400" loading="lazy" style="position:absolute;inset:0;width:78px;height:78px;object-fit:cover;border-radius:14px" onerror="this.remove()" alt="">`:''}</div>`}<div class="meta"><b>${r.company}</b> <span class="badge">${r.type}</span>
      <br>🧾 ${r.number} • 📅 ${r.date}<br>💰 <b>${r.amount} DH</b> • ${r.pay||''}
      <br>👤 <b>${r.takenBy||'—'}</b>${r.credit?` • ${r.credit.unpaid?'🔴 <b>كريدي غير مخلص</b>':'🟢 <b>كريدي مخلص</b>'} <button class="btn ghost sm" data-a="cred">${r.credit.unpaid?'✅ تخلص':'↩️'}</button>`:''}
      <br><small dir="ltr">${r.fileName}</small><br><small>${r.driveId?'☁️ مرفوع Drive ✅':'📱 محلي فقط'}</small>${r.del?'<br><small>🗑️ محذوف من '+r.del.by+' (يبقى عند الأدمن)</small>':''}</div>
      <div class="ops"><button class="btn ghost sm" data-a="dl">⬇️</button><button class="btn ghost sm" data-a="pdf">📄</button><button class="btn ghost sm" data-a="up">☁️</button>${isAdmin()&&!r.del?'<button class="btn ghost sm" data-a="edit">✏️</button>':''}${r.del?(isAdmin()?'<button class="btn ghost sm" data-a="restore">↩️</button><button class="btn danger sm" data-a="del">❌</button>':''):'<button class="btn danger sm" data-a="del">🗑️</button>'}</div>`;
    d.querySelector('[data-a=dl]').onclick=()=>{if(!r.img){toast('لا توجد صورة — صف Excel فقط');return}const a=document.createElement('a');a.href=r.img;a.download=r.fileName;a.click()};
    d.querySelector('[data-a=pdf]').onclick=()=>{if(!r.img){toast('لا توجد صورة — صف Excel فقط');return}receiptToPdf(r.img,r)};
    const delBtn=d.querySelector('[data-a=del]');
    if(delBtn) delBtn.onclick=()=>{
      if(r.del){ // permanent delete: admin only
        if(!isAdmin()){toast('⛔ للأدمن فقط');return}
        if(confirm('حذف نهائي؟ غيمشي حتى من عند الأدمن')){const did=r.id,dfid=r.driveId;tombReceipt(r);receipts=receipts.filter(x=>x.id!==r.id);save();apiU('dataDel',{id:did,by:getUser().name,byHash:getUser().hash});if(dfid)deleteDriveFile({driveId:dfid}).then(ok=>{if(!ok)toast('⚠️ تمسح محليا — ملف Drive بقى (مسحو يدويا)')});schedulePush();render()}
      }else if(isAdmin()){
        if(confirm('حذف؟')){const did2=r.id,dfid2=r.driveId;tombReceipt(r);receipts=receipts.filter(x=>x.id!==r.id);save();apiU('dataDel',{id:did2,by:getUser().name,byHash:getUser().hash});if(dfid2)deleteDriveFile({driveId:dfid2}).then(ok=>{if(!ok)toast('⚠️ تمسح محليا — ملف Drive بقى (مسحو يدويا)')});schedulePush();render()}
      }else{ // worker soft delete: hidden from him, kept for admin
        if(confirm('تحذفو من الأرشيف ديالك؟ (غيبقى عند الأدمن)')){r.del={by:currentUser(),at:new Date().toISOString().slice(0,10)};r.updatedAt=Date.now();save();schedulePush();render();toast('🗑️ تحذف من عندك — باقي عند الأدمن')}
      }
    };
    const resBtn=d.querySelector('[data-a=restore]');
    if(resBtn) resBtn.onclick=()=>{if(!isAdmin()){toast('⛔ للأدمن فقط');return}r.del=null;r.updatedAt=Date.now();save();schedulePush();render();toast('↩️ ترجع البون')};
    const imgBtn=d.querySelector('[data-a=img]');
    if(imgBtn) imgBtn.onclick=()=>{if(!r.driveId){toast('لا توجد صورة');return}fetchImgs([r.driveId])};
    const editBtn=d.querySelector('[data-a=edit]');
    if(editBtn) editBtn.onclick=()=>startEdit(r.id);
    d.querySelector('[data-a=up]').onclick=()=>uploadToDrive(r).then(()=>{save();render()});
    const credBtn=d.querySelector('[data-a=cred]');
    if(credBtn) credBtn.onclick=()=>{
      if(r.credit.unpaid){r.credit={unpaid:false,paidBy:currentUser(),paidAt:new Date().toISOString().slice(0,10)};toast('✅ تخلص الكريدي')}
      else{r.credit={unpaid:true,paidBy:null,paidAt:null};toast('↩️ رجع غير مخلص')}
      r.updatedAt=Date.now();save();schedulePush();render();
    };
    box.appendChild(d);
  });
  // stats: employee = TODAY only; admin = monthly + global
  const cm=new Date().toISOString().slice(0,7);
  const today0=new Date().toISOString().slice(0,10);
  const labs=document.querySelectorAll('.stat label');
  if(scopeName()){
    const t=base.filter(r=>r.date===today0);
    $('stMonth').textContent=t.length;
    $('stTotal').textContent=base.length;
    $('stAmount').textContent=t.reduce((s,r)=>s+(+r.amount||0),0)+' درهم';
    if(labs.length===3){labs[0].textContent='📸 بوناتي اليوم';labs[1].textContent='💰 مجموع اليوم';labs[2].textContent='مجموعي الكلي'}
  }else{
    $('stMonth').textContent=base.filter(r=>r.month===cm).length;
    $('stTotal').textContent=base.length;
    $('stAmount').textContent=base.filter(r=>r.month===cm).reduce((s,r)=>s+(+r.amount||0),0)+' درهم';
    if(labs.length===3){labs[0].textContent='بونات هذا الشهر';labs[1].textContent='مجموع المبالغ';labs[2].textContent='المجموع الكلي'}
  }
  renderFolders();renderEmpTable();renderUsers();renderCreditBar();renderCompanies();renderHisab();
  if(typeof renderStEmps==='function')renderStEmps();
  if(typeof renderStArchive==='function')renderStArchive();
  if(!isAdmin()&&$('ocrDetails'))$('ocrDetails').hidden=true; // raw OCR text: admin only
  // simplified fast form for employees: hide number/type/pay
  const emp=!!scopeName();
  if($('lblNumber'))$('lblNumber').style.display=emp?'none':'';
  if($('advRow'))$('advRow').style.display=emp?'none':'';
  if($('hearCompany'))$('hearCompany').style.display=isAdmin()?'':'none'; // 🔊 للأدمن فقط
}
let outsideOnly=false;
function renderCreditBar(){
  const bar=$('creditBar');if(!bar) return;
  const vis=totalsBase();
  const today0=new Date().toISOString().slice(0,10);
  const grand=vis.reduce((s,r)=>s+(+r.amount||0),0);
  const todayTot=vis.filter(r=>r.date===today0).reduce((s,r)=>s+(+r.amount||0),0);
  const kharaj=Math.round((grand-todayTot)*100)/100;
  if(!vis.length&&!outsideOnly){bar.hidden=true;return}
  bar.hidden=false;
  bar.innerHTML=`💰 الخارج: <b>${kharaj} DH</b> <small>(العام − اليوم)</small> <button class="btn sm ${outsideOnly?'primary':'ghost'}" id="creditFilterBtn">${outsideOnly?'عرض الكل':'عرض خارج اليوم'}</button>`;
  $('creditFilterBtn').onclick=()=>{outsideOnly=!outsideOnly;render()};
}
$('search').oninput=render;
if($('pullDrive'))$('pullDrive').onclick=()=>pullDriveArchive(false);
$('filterMonth').onchange=()=>{currentMonthFilter=null;currentDayFilter=null;render()};
$('filterEmp').onchange=render;
$('clearFilter').onclick=()=>{$('search').value='';$('filterMonth').value='';$('filterEmp').value='';currentMonthFilter=null;currentDayFilter=null;outsideOnly=false;render()};
function renderEmpTable(){
  const box=$('empTable');if(!box) return;
  const map={};
  totalsBase().forEach(r=>{const e=r.takenBy||'—';map[e]=map[e]||{n:0,tot:0};map[e].n++;map[e].tot+=(+r.amount||0)});
  const keys=Object.keys(map);
  if(!keys.length){box.innerHTML='<p class="hint">ما زال ما كاين حتى بون.</p>';return}
  box.innerHTML=keys.map(e=>`<div class="folder" data-emp="${e}" style="font-size:15px">👤<b>${e}</b><span>${map[e].n} بون • ${map[e].tot} DH</span></div>`).join('');
  box.querySelectorAll('[data-emp]').forEach(d=>d.onclick=()=>{
    $('filterEmp').value=d.dataset.emp;
    document.querySelectorAll('[data-tab="archive"]').forEach(x=>x.click());render();
  });
}
$('exportCsv').onclick=()=>{
  if(typeof XLSX==='undefined'){toast('❌ مكتبة Excel ما تحملاتش — تحقق من الإنترنت');return}
  const rows=totalsBase().map(r=>({'الشركة':r.company,'الرقم':r.number,'التاريخ':r.date,'المبلغ DH':r.amount,'النوع':r.type,'الأداء':r.pay||'','الكريدي':r.credit?(r.credit.unpaid?'غير مخلص':'مخلص'):'—','الموظف':r.takenBy||'—','ملاحظات':r.note||'','الملف':r.fileName,'الشهر':r.month,'Drive':r.driveUrl||''}));
  const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'الشركة':'—','الرقم':'—','التاريخ':'—','المبلغ DH':0}]);
  ws['!cols']=[{wch:22},{wch:16},{wch:12},{wch:12},{wch:12},{wch:16},{wch:12},{wch:18},{wch:24},{wch:42},{wch:9},{wch:40}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Bons');
  XLSX.writeFile(wb,'bons-archive.xlsx');toast('📗 تصدر Excel بنجاح');
};
$('importExcel').onchange=e=>{
  const f=e.target.files[0];if(!f) return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const wb=XLSX.read(rd.result,{type:'array'});
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      let n=0;
      rows.forEach(row=>{
        const company=row['الشركة']||row.company||'';if(!company||company==='—') return;
        const date=String(row['التاريخ']||row.date||new Date().toISOString().slice(0,10)).slice(0,10);
        const cr=row['الكريدي']||row.credit||'';
        receipts.unshift({id:Date.now()+Math.random(),company:String(company),number:String(row['الرقم']||row.number||''),
          date,amount:parseFloat(row['المبلغ DH']||row.amount)||0,type:row['النوع']||row.type||'بون Bon',
          pay:row['الأداء']||row.pay||'',credit:(/غير مخلص|unpaid/i.test(cr))?{unpaid:true,paidBy:null,paidAt:null}:(/مخلص|paid/i.test(cr)?{unpaid:false,paidBy:'—',paidAt:date}:null),takenBy:row['الموظف']||row.takenBy||currentUser(),del:null,note:row['ملاحظات']||row.note||'',fileName:String(row['الملف']||row.fileName||'import.xlsx'),
          month:date.slice(0,7),img:'',driveId:null,driveUrl:row['Drive']||row.driveUrl||'',created:new Date().toISOString()});
        n++;
      });
      save();render();toast(`📥 تستورد ${n} بون من Excel`);
    }catch(err){toast('❌ ملف Excel غير صالح')}
  };
  rd.readAsArrayBuffer(f);e.target.value='';
};
$('printBtn').onclick=()=>window.print();

let currentDayFilter=null;
function renderFolders(){
  const y=+$('yearSel').value||new Date().getFullYear();
  const m=+$('monthSel').value||(new Date().getMonth()+1);
  const mm=String(m).padStart(2,'0');const mkey=`${y}-${mm}`;
  // admin only: monthly total
  const mc=$('adminMonthCard');
  if(mc){
    if(isAdmin()){
      const marr=receipts.filter(r=>r.month===mkey);
      const mtot=marr.reduce((s,r)=>s+(+r.amount||0),0);
      mc.hidden=false;
      mc.innerHTML=`👑 المجموع الشهري (${mm}/${y}): <b>${marr.length} بون • ${mtot} DH</b>`;
    } else mc.hidden=true;
  }
  // days grid: one folder per day with daily total (role-scoped)
  const g=$('daysGrid');if(!g) return;g.innerHTML='';
  const dim=new Date(y,m,0).getDate();
  const today=new Date().toISOString().slice(0,10);
  const vbase=totalsBase();
  for(let dd=1;dd<=dim;dd++){
    const dk=`${mkey}-${String(dd).padStart(2,'0')}`;
    const arr=vbase.filter(r=>r.date===dk);
    const tot=arr.reduce((s,r)=>s+(+r.amount||0),0);
    const d=document.createElement('div');
    d.className='folder'+(currentDayFilter===dk?' active':'')+(dk===today?' today':'');
    d.innerHTML=`📁<b>${dd} ${MONTHS_AR[m-1]}</b><span>${arr.length} بون • ${tot} DH</span>`;
    d.onclick=()=>{currentDayFilter=dk;currentMonthFilter=null;$('filterMonth').value='';
      document.querySelectorAll('[data-tab="archive"]').forEach(x=>x.click());render()};
    g.appendChild(d);
  }
}
// years + months
(()=>{const s=$('yearSel');const cy=new Date().getFullYear();for(let y=cy-3;y<=cy+1;y++){const o=document.createElement('option');o.value=y;o.textContent=y;if(y===cy)o.selected=true;s.appendChild(o)}s.onchange=renderFolders;
const ms=$('monthSel');const cm=new Date().getMonth()+1;for(let m=1;m<=12;m++){const o=document.createElement('option');o.value=m;o.textContent=String(m).padStart(2,'0')+' - '+MONTHS_AR[m-1];if(m===cm)o.selected=true;ms.appendChild(o)}ms.onchange=renderFolders})();

// ===== Google Drive: 1) Apps Script direct (no Cloud Console) 2) OAuth advanced =====
let gToken=null;
function dataURLtoBlob(u){const [h,d]=u.split(',');const mime=h.match(/:(.*?);/)[1];const b=atob(d);const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return new Blob([a],{type:mime})}
if(localStorage.getItem('scriptUrl')) $('scriptUrl').value=localStorage.getItem('scriptUrl');
$('scriptUrl').oninput=e=>{localStorage.setItem('scriptUrl',e.target.value.trim());updateAutoName()};
if(localStorage.getItem('gcid')) $('clientId').value=localStorage.getItem('gcid');

$('driveTest').onclick=async()=>{
  const url=$('scriptUrl').value.trim();
  if(!url){$('driveMsg').textContent='⚠️ الصق رابط Web App أولا';return}
  localStorage.setItem('scriptUrl',url);
  $('driveMsg').textContent='⏳ كنختبر...';
  try{const r=await fetch(url);const j=await r.json();
    if(!j.ok){$('driveMsg').textContent='⚠️ الرد غير متوقع';return}
    // فحص نسخة كود السيرفر: واش فيه المستخدمين + الشركات؟
    let caps='';
    try{
      const t=await (await fetch(url,{method:'POST',body:JSON.stringify({action:'coPull'})})).json();
      if(t&&t.ok&&Array.isArray(t.companies)) caps=` ✅ سيرفر محدث (شركات: ${t.companies.length})`;
      else if(t&&t.msg) caps=' ⚠️ السيرفر رد بـ GET بدل POST (مشكل تحويل) — صورو ليا هاد الرسالة';
      else caps=` ⚠️ خطأ السيرفر: ${(t&&(t.error||t.message))||'؟'} — صورو ليا`;
    }catch(e){caps=' ⚠️ تعذر فحص النسخة'}
    $('driveMsg').textContent=`✅ خدام! (سيرفر: ${j.srv||'قديم — حدّث الكود'})${caps}`;
    $('driveStatus').textContent='☁️ متصل بـ Drive مباشرة ✅';toast('☁️ متصل');
  }catch(e){$('driveMsg').textContent='❌ فشل: تأكد أن Deploy → Access: Anyone'}
};

async function uploadViaScript(r){
  const url=$('scriptUrl').value.trim();
  if(!url) return null; // not configured
  const [y,m]=r.month.split('-');
  const payload={filename:r.fileName,mime:r.mime||'image/jpeg',data:r.img.split(',')[1],
    company:r.company,number:r.number,date:r.date,amount:r.amount,type:r.type,takenBy:r.takenBy||currentUser(),
    credit:r.credit?(r.credit.unpaid?'كريدي غير مخلص':'كريدي مخلص'):'',
    year:y,monthFolder:`${m}-${MONTHS_FR[parseInt(m,10)-1]}`,dayFolder:r.date.slice(8,10),root:$('rootFolder').value||'Bons_Archivage'};
  const res=await fetch(url,{method:'POST',body:JSON.stringify(payload)});
  const j=await res.json();
  if(!j.ok) throw new Error(j.error||'script error');
  r.driveId=j.id; r.driveUrl=j.url; return true;
}

$('driveLogin').onclick=()=>{
  const cid=$('clientId').value.trim();
  if(!cid||!cid.includes('.apps.googleusercontent')){$('driveMsg').textContent='⚠️ الصق Client ID صحيح أولا';return}
  localStorage.setItem('gcid',cid);
  google.accounts.oauth2.initTokenClient({client_id:cid,scope:'https://www.googleapis.com/auth/drive.file',callback:t=>{gToken=t.access_token;$('driveStatus').textContent='☁️ متصل بـ Google Drive ✅';$('driveMsg').textContent='✅ متصل! الحفظ سيرفع تلقائيا.';toast('☁️ Drive متصل')}}).requestAccessToken();
};
if(localStorage.getItem('gcid')) $('clientId').value=localStorage.getItem('gcid');

async function driveFetch(path,opts={}){
  const r=await fetch('https://www.googleapis.com/'+path,{...opts,headers:{...(opts.headers||{}),Authorization:'Bearer '+gToken}});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}
async function findOrCreateFolder(name,parent=null){
  let q=`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if(parent) q+=` and '${parent}' in parents`;
  const res=await driveFetch('drive/v3/files?q='+encodeURIComponent(q)+'&fields=files(id)');
  if(res.files?.length) return res.files[0].id;
  const meta={name,mimeType:'application/vnd.google-apps.folder',...(parent?{parents:[parent]}:{})};
  const c=await driveFetch('drive/v3/files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)});
  return c.id;
}
async function uploadToDrive(r){
  // 1) try direct script (no Cloud Console)
  if($('scriptUrl').value.trim()){
    try{toast('☁️ جاري الرفع المباشر...');
      await uploadViaScript(r);
      toast('☁️ ترفع بنجاح إلى '+r.month);return true;
    }catch(e){console.error(e);toast('❌ فشل الرفع: '+e.message);return false}
  }
  // 2) fallback OAuth
  if(!gToken){toast('🔑 الصق رابط Apps Script أولا (تبويب Drive) — بلا Cloud Console');document.querySelectorAll('[data-tab="drive"]').forEach(x=>x.click());return false}
  try{
    toast('☁️ جاري الرفع...');
    const root=$('rootFolder').value||'Bons_Archivage';
    const [y,m]=r.month.split('-');
    const rootId=await findOrCreateFolder(root);
    const yId=await findOrCreateFolder(y,rootId);
    const mId=await findOrCreateFolder(`${m}-${MONTHS_FR[parseInt(m)-1]}`,yId);
    const dayId=await findOrCreateFolder(r.date.slice(8,10),mId);
    const empId=await findOrCreateFolder((r.takenBy||'—').trim()||'—',dayId);
    const meta={name:r.fileName,parents:[empId],description:`${r.company} | ${r.number} | ${r.date} | ${r.amount}DH`};
    const fd=new FormData();
    fd.append('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));
    fd.append('file',dataURLtoBlob(r.img),r.fileName);
    const up=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{Authorization:'Bearer '+gToken},body:fd});
    const j=await up.json();r.driveId=j.id;
    toast('☁️ ترفع بنجاح إلى '+r.month);return true;
  }catch(e){console.error(e);toast('❌ فشل الرفع: تحقق من الاتصال');return false}
}
$('driveSync').onclick=async()=>{
  if($('scriptUrl').value.trim()){
    const todo=receipts.filter(r=>!r.driveId);
    if(!todo.length){toast('✅ كلشي مزامن');return}
    for(const r of todo){
      try{
        const m=receipts.find(x=>x!==r&&x.driveId&&metaSame(x,r));
        if(m){r.driveId=m.driveId;r.driveUrl=m.driveUrl;save();render();continue} // مرفوع already بنسخة أخرى => ربط بلا إعادة رفع
        await uploadViaScript(r)
      }catch(e){toast('❌ توقف عند '+r.fileName);break}save();render()}
    toast('☁️ سالات المزامنة ✅');return;
  }
  if(!gToken){toast('🔑 الصق رابط Apps Script أولا');return}
  const todo=receipts.filter(r=>!r.driveId);
  if(!todo.length){toast('✅ كلشي مزامن');return}
  for(const r of todo){
    const m=receipts.find(x=>x!==r&&x.driveId&&metaSame(x,r));
    if(m){r.driveId=m.driveId;r.driveUrl=m.driveUrl;save();render();continue}
    await uploadToDrive(r);save();render()
  }
};

// PWA install
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();deferredPrompt=null;$('installBtn').hidden=true}};

dedupeReceipts(); // تنظيف التكرارات القديمة مرة واحدة
purgeEmptyStation(); // مسح مسودات العدادات الفارغة مرة واحدة
render();
