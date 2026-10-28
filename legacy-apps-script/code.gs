// ============================================================
// SARF İSTEK - SUNUCU KODU (Code.gs)
// ============================================================

function doGet(e) {
  const path = (e && e.pathInfo) || "";
  const urlParams = (e && e.parameter) || {};
  const token = String(urlParams.token || urlParams.s || "").trim();

  if (path.includes('s/') || token) {
    // Token'ı sunucu tarafında HTML'e gömüyoruz; istemcide
    // window.location.search boş gelebildiği için bu en güvenilir yöntem.
    const tpl = HtmlService.createTemplateFromFile('Service');
    tpl.token = token.replace(/[^A-Za-z0-9_-]/g, '');
    return tpl.evaluate()
      .setTitle('Servis Portalı')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  return HtmlService.createHtmlOutputFromFile('Admin')
    .setTitle('Admin Paneli')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === 'Donemler') sheet.appendRow(['id', 'ad', 'createdAt', 'file', 'materials', 'branslar']);
    if (name === 'Servisler') sheet.appendRow(['donemId', 'id', 'name', 'token']);
    if (name === 'Istekler') sheet.appendRow(['donemId', 'materialKey', 'serviceId', 'miktar', 'tarih']);
    if (name === 'Malzemeler') sheet.appendRow(['donemId', 'key', 'sutKodu', 'tasinirKodu', 'tanim', 'branslar', 'smtKodu']);
  }
  return sheet;
}

// --- SÜTUN EŞLEME ---
// Başlık satırı varsa sütunlar ADINA göre eşlenir; böylece sekmedeki
// sütun sırası değişse bile servis adı / token doğru okunur.
function normColKey(v) {
  return String(v == null ? '' : v)
    .replace(/[ıİ]/g, 'i').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[çÇ]/g, 'c')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getColumnMap(sheetName, columns) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  const header = (values[0] || []).map(normColKey);
  const hasHeader = columns.some(c => header.indexOf(normColKey(c)) !== -1);
  const idx = {};
  columns.forEach((c, i) => {
    const found = hasHeader ? header.indexOf(normColKey(c)) : -1;
    idx[c] = found !== -1 ? found : i;
  });
  // Sonradan eklenen sütunların (ör. tarih) başlığını tamamla
  if (hasHeader) {
    columns.forEach((c, i) => {
      const cell = String((values[0] || [])[i] == null ? '' : (values[0] || [])[i]).trim();
      if (!cell) {
        try { sheet.getRange(1, i + 1).setValue(c); } catch (e) {}
      }
    });
  }
  return { sheet: sheet, values: values, header: header, hasHeader: hasHeader, dataStart: hasHeader ? 1 : 0, idx: idx };
}

function readTable(sheetName, columns) {
  const map = getColumnMap(sheetName, columns);
  const rows = [];
  for (let i = map.dataStart; i < map.values.length; i++) {
    const raw = map.values[i];
    const o = {};
    let empty = true;
    columns.forEach(c => {
      const v = raw[map.idx[c]];
      o[c] = (v === undefined || v === null) ? '' : v;
      if (String(o[c]).trim() !== '') empty = false;
    });
    if (!empty) rows.push(o);
  }
  return rows;
}

function buildRow(sheetName, columns, record) {
  const map = getColumnMap(sheetName, columns);
  let width = 1;
  columns.forEach(c => { if (map.idx[c] + 1 > width) width = map.idx[c] + 1; });
  const row = [];
  for (let i = 0; i < width; i++) row.push('');
  columns.forEach(c => { row[map.idx[c]] = record[c] === undefined || record[c] === null ? '' : record[c]; });
  return { sheet: map.sheet, row: row };
}

function safeJson(v, fallback) {
  try {
    if (v === '' || v === null || v === undefined) return fallback;
    return JSON.parse(v);
  } catch (e) { return fallback; }
}

const COLS = {
  donemler: ['id', 'ad', 'createdAt', 'file', 'materials', 'branslar'],
  servisler: ['donemId', 'id', 'name', 'token'],
  istekler: ['donemId', 'materialKey', 'serviceId', 'miktar', 'tarih'],
  malzemeler: ['donemId', 'key', 'sutKodu', 'tasinirKodu', 'tanim', 'branslar', 'smtKodu']
};

function isoValue(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
  return String(v).trim();
}

function getDB() {
  return {
    donemler: readTable('Donemler', COLS.donemler).map(r => ({
      id: String(r.id).trim(), ad: r.ad, createdAt: r.createdAt, file: r.file,
      materials: safeJson(r.materials, []),
      branslar: safeJson(r.branslar, [])
    })),
    services: readTable('Servisler', COLS.servisler).map(r => ({
      donemId: String(r.donemId).trim(),
      id: String(r.id).trim(),
      name: String(r.name == null ? '' : r.name).trim(),
      token: String(r.token).trim()
    })),
    requests: readTable('Istekler', COLS.istekler).map(r => ({
      donemId: String(r.donemId).trim(),
      materialKey: String(r.materialKey).trim(),
      serviceId: String(r.serviceId).trim(),
      miktar: r.miktar,
      tarih: isoValue(r.tarih)
    }))
  };
}

function readMaterials(donemId) {
  return readTable('Malzemeler', COLS.malzemeler)
    .filter(r => String(r.donemId).trim() === String(donemId).trim())
    .map(r => ({
      key: r.key, sutKodu: r.sutKodu, tasinirKodu: r.tasinirKodu,
      tanim: r.tanim, branslar: safeJson(r.branslar, []), smtKodu: r.smtKodu
    }));
}

// --- API: DÖNEM İŞLEMLERİ ---
function apiGetDonemler() {
  const db = getDB();
  return db.donemler.map(d => ({
    id: d.id, ad: d.ad, createdAt: d.createdAt, file: d.file,
    materials: d.materials.length, branslar: d.branslar.length,
    services: db.services.filter(s => s.donemId === d.id).length
  }));
}

function apiAddDonem(ad) {
  const id = 'donem-' + new Date().getTime();
  const built = buildRow('Donemler', COLS.donemler, {
    id: id, ad: ad, createdAt: new Date().toISOString(), file: '', materials: '[]', branslar: '[]'
  });
  built.sheet.appendRow(built.row);
  return { id, ad };
}

function apiGetDonemData(donemId) {
  const db = getDB();
  const donem = db.donemler.find(d => d.id === String(donemId).trim());
  if(!donem) return { error: 'Dönem bulunamadı' };

  const materials = readMaterials(donem.id);

  const servisler = db.services.filter(s => s.donemId === donem.id);
  const istekler = db.requests.filter(r => r.donemId === donem.id);
  
  const requestsObj = {};
  const requestInfo = {};
  istekler.forEach(r => {
    if (!requestsObj[r.materialKey]) requestsObj[r.materialKey] = {};
    requestsObj[r.materialKey][r.serviceId] = r.miktar;
    if (!requestInfo[r.materialKey]) requestInfo[r.materialKey] = {};
    requestInfo[r.materialKey][r.serviceId] = { miktar: r.miktar, tarih: r.tarih || '' };
  });

  return { ...donem, materials: materials, services: servisler, requests: requestsObj, requestInfo: requestInfo };
}

function apiDeleteDonem(donemId) {
  const dId = String(donemId).trim();
  ['Donemler', 'Servisler', 'Istekler', 'Malzemeler'].forEach(name => {
    const cols = name === 'Donemler' ? COLS.donemler
      : name === 'Servisler' ? COLS.servisler
      : name === 'Istekler' ? COLS.istekler
      : COLS.malzemeler;
    const map = getColumnMap(name, cols);
    const keyCol = name === 'Donemler' ? 'id' : 'donemId';
    for (let i = map.values.length - 1; i >= map.dataStart; i--) {
      if (String(map.values[i][map.idx[keyCol]]).trim() === dId) map.sheet.deleteRow(i + 1);
    }
  });
  return { success: true };
}

function apiSaveMaterials(donemId, materials, branslar) {
  try {
    const map = getColumnMap('Malzemeler', COLS.malzemeler);
    const dId = String(donemId).trim();
    for (let i = map.values.length - 1; i >= map.dataStart; i--) {
      if (String(map.values[i][map.idx.donemId]).trim() === dId) map.sheet.deleteRow(i + 1);
    }
    if (materials.length > 0) {
      let width = 1;
      COLS.malzemeler.forEach(c => { if (map.idx[c] + 1 > width) width = map.idx[c] + 1; });
      const rows = materials.map(m => {
        const rec = {
          donemId: donemId, key: m.key, sutKodu: m.sutKodu, tasinirKodu: m.tasinirKodu,
          tanim: m.tanim, branslar: JSON.stringify(m.branslar || []), smtKodu: m.smtKodu
        };
        const row = [];
        for (let i = 0; i < width; i++) row.push('');
        COLS.malzemeler.forEach(c => { row[map.idx[c]] = rec[c] === undefined || rec[c] === null ? '' : rec[c]; });
        return row;
      });
      map.sheet.getRange(map.sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
    }
    const dMap = getColumnMap('Donemler', COLS.donemler);
    for (let i = dMap.dataStart; i < dMap.values.length; i++) {
      if (String(dMap.values[i][dMap.idx.id]).trim() === dId) {
        dMap.sheet.getRange(i + 1, dMap.idx.materials + 1).setValue('');
        dMap.sheet.getRange(i + 1, dMap.idx.branslar + 1).setValue(JSON.stringify(branslar));
        break;
      }
    }
    return { success: true };
  } catch(e) { return { error: e.toString() }; }
}

// --- API: SERVİS İŞLEMLERİ ---
function apiAddService(donemId, name) {
  const id = Utilities.getUuid();
  const token = Utilities.getUuid().replace(/-/g, '').substring(0, 24);
  const serviceName = String(name == null ? '' : name).trim();
  const built = buildRow('Servisler', COLS.servisler, {
    donemId: donemId, id: id, name: serviceName, token: token
  });
  built.sheet.appendRow(built.row);
  return { id: id, name: serviceName, token: token };
}

function apiRenameService(donemId, serviceId, newName) {
  try {
    const serviceName = String(newName == null ? '' : newName).trim();
    if (!serviceName) return { error: 'Servis adı boş olamaz' };
    const map = getColumnMap('Servisler', COLS.servisler);
    for (let i = map.dataStart; i < map.values.length; i++) {
      const r = map.values[i];
      if (String(r[map.idx.donemId]).trim() === String(donemId).trim() &&
          String(r[map.idx.id]).trim() === String(serviceId).trim()) {
        map.sheet.getRange(i + 1, map.idx.name + 1).setValue(serviceName);
        return { success: true, name: serviceName };
      }
    }
    return { error: 'Servis bulunamadı' };
  } catch(e) { return { error: e.toString() }; }
}

function apiDeleteService(donemId, serviceId) {
  try {
    const dId = String(donemId).trim(), sId = String(serviceId).trim();
    const map = getColumnMap('Servisler', COLS.servisler);
    for (let i = map.values.length - 1; i >= map.dataStart; i--) {
      const r = map.values[i];
      if (String(r[map.idx.donemId]).trim() === dId && String(r[map.idx.id]).trim() === sId) {
        map.sheet.deleteRow(i + 1); break;
      }
    }
    const iMap = getColumnMap('Istekler', COLS.istekler);
    for (let i = iMap.values.length - 1; i >= iMap.dataStart; i--) {
      const r = iMap.values[i];
      if (String(r[iMap.idx.donemId]).trim() === dId && String(r[iMap.idx.serviceId]).trim() === sId) {
        iMap.sheet.deleteRow(i + 1);
      }
    }
    return { success: true };
  } catch(e) { return { error: e.toString() }; }
}

function normalizeToken(v) {
  return String(v == null ? '' : v)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
    .toLowerCase();
}

function findServiceByToken(db, token) {
  const t = normalizeToken(token);
  if (!t) return null;
  return db.services.find(s => normalizeToken(s.token) === t) || null;
}

// Admin paneli servis linklerini bu adresten üretir; böylece link her zaman
// yayında olan (güncel sürümü çalıştıran) dağıtıma işaret eder.
function apiGetBaseUrl() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function apiGetServiceData(token) {
  try {
    const db = getDB();
    const service = findServiceByToken(db, token);
    if (!service) {
      return { error: 'Servis bulunamadı (kayıtlı servis sayısı: ' + db.services.length + '). Token: ' + token };
    }
    
    const donem = db.donemler.find(d => d.id === service.donemId);
    if (!donem) return { error: 'Dönem bulunamadı.' };

    const donemIstekler = db.requests.filter(r => r.donemId === donem.id);
    const requestsObj = {};
    const requestInfo = {};
    donemIstekler.forEach(r => {
      if (!requestsObj[r.materialKey]) requestsObj[r.materialKey] = {};
      requestsObj[r.materialKey][r.serviceId] = r.miktar;
      if (!requestInfo[r.materialKey]) requestInfo[r.materialKey] = {};
      requestInfo[r.materialKey][r.serviceId] = { miktar: r.miktar, tarih: r.tarih || '' };
    });

    // Malzemeleri çek
    const materials = readMaterials(donem.id);

    return {
      donem: { id: donem.id, ad: donem.ad },
      // Ad boşsa portalın hiçbir yerde boş görünmemesi için yedek ad
      service: { id: service.id, name: service.name || ('Servis ' + String(service.token || '').slice(0, 6)) },
      nameMissing: !service.name,
      materials: materials,
      branslar: donem.branslar,
      requests: requestsObj,
      requestInfo: requestInfo
    };
  } catch(e) { return { error: 'Sunucu Hatası: ' + e.toString() }; }
}

function apiSaveRequest(token, materialKey, miktar) {
  const db = getDB();
  const service = findServiceByToken(db, token);
  if (!service) return { error: 'Geçersiz link' };

  const tarihValue = new Date();
  const tarih = tarihValue.toISOString();
  const map = getColumnMap('Istekler', COLS.istekler);
  for (let i = map.dataStart; i < map.values.length; i++) {
    const r = map.values[i];
    if (String(r[map.idx.donemId]).trim() === service.donemId &&
        String(r[map.idx.materialKey]).trim() === String(materialKey).trim() &&
        String(r[map.idx.serviceId]).trim() === service.id) {
      map.sheet.getRange(i + 1, map.idx.miktar + 1).setValue(miktar);
      map.sheet.getRange(i + 1, map.idx.tarih + 1).setValue(tarihValue);
      return { success: true, tarih: tarih };
    }
  }
  const built = buildRow('Istekler', COLS.istekler, {
    donemId: service.donemId, materialKey: materialKey, serviceId: service.id, miktar: miktar, tarih: tarihValue
  });
  built.sheet.appendRow(built.row);
  return { success: true, tarih: tarih };
}

function apiDeleteRequest(token, materialKey) {
  const db = getDB();
  const service = findServiceByToken(db, token);
  if (!service) return { error: 'Geçersiz link' };

  const map = getColumnMap('Istekler', COLS.istekler);
  for (let i = map.values.length - 1; i >= map.dataStart; i--) {
    const r = map.values[i];
    if (String(r[map.idx.donemId]).trim() === service.donemId &&
        String(r[map.idx.materialKey]).trim() === String(materialKey).trim() &&
        String(r[map.idx.serviceId]).trim() === service.id) {
      map.sheet.deleteRow(i + 1); return { success: true };
    }
  }
  return { success: false };
}

function apiSaveAdminRequest(donemId, materialKey, serviceId, miktar) {
  const dId = String(donemId).trim(), sId = String(serviceId).trim(), mKey = String(materialKey).trim();
  const tarihValue = new Date();
  const tarih = tarihValue.toISOString();
  const map = getColumnMap('Istekler', COLS.istekler);
  for (let i = map.dataStart; i < map.values.length; i++) {
    const r = map.values[i];
    if (String(r[map.idx.donemId]).trim() === dId &&
        String(r[map.idx.materialKey]).trim() === mKey &&
        String(r[map.idx.serviceId]).trim() === sId) {
      if (miktar <= 0) { map.sheet.deleteRow(i + 1); return { success: true }; }
      map.sheet.getRange(i + 1, map.idx.miktar + 1).setValue(miktar);
      map.sheet.getRange(i + 1, map.idx.tarih + 1).setValue(tarihValue);
      return { success: true, tarih: tarih };
    }
  }
  if (miktar > 0) {
    const built = buildRow('Istekler', COLS.istekler, {
      donemId: donemId, materialKey: materialKey, serviceId: serviceId, miktar: miktar, tarih: tarihValue
    });
    built.sheet.appendRow(built.row);
  }
  return { success: true, tarih: tarih };
}

function apiGetSartname(smtKodu) {
  try {
    const klasorler = DriveApp.getFoldersByName('Sartnameler');
    if (!klasorler.hasNext()) return { error: 'Sartnameler klasörü bulunamadı' };
    const klasor = klasorler.next();
    const tumDosyalar = klasor.getFiles();
    let hedefDosya = null;
    while (tumDosyalar.hasNext()) {
      const d = tumDosyalar.next();
      if (d.getName().startsWith(smtKodu + '-') || d.getName().startsWith(smtKodu + ' ')) {
        hedefDosya = d; break;
      }
    }
    if (!hedefDosya) return { error: 'Dosya bulunamadı: ' + smtKodu };
    const blob = hedefDosya.getBlob();
    return { 
      success: true, 
      url: `data:${blob.getContentType()};base64,${Utilities.base64Encode(blob.getBytes())}`,
      dosyaAdi: hedefDosya.getName()
    };
  } catch(e) { return { error: e.message }; }
}