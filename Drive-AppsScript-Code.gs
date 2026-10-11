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
