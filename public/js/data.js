// ============================================================
// VERİ KATMANI (Firestore)
// ============================================================
// Koleksiyon yapısı:
//   donemler/{donemId}
//     ad, createdAt, file, materialCount, serviceCount, branslar[]
//     donemler/{donemId}/malzemeler/{materialKey}   (herkes okur)
//     donemler/{donemId}/servisler/{serviceId}      (sadece yönetici)
//   publicData/{token}                              (token ile tek doküman okunur)
//     donemId, donemAd, serviceId, name, branslar[], istekler{ materialKey: {miktar, tarih} }
//   sartnameler/{smtKodu}                          (şartname bilgisi — herkes okur)
//     sartnameler/{smtKodu}/parcalar/{i}           (base64 parçaları — herkes okur)
// ============================================================

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, writeBatch, onSnapshot, FieldPath, deleteField
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { db } from './fb.js';
import { nowIso, randomToken, newId } from './util.js';

const BATCH_LIMIT = 400;

// Firestore hata kodlarını kullanıcıya anlaşılır biçimde döndürür
export function firebaseHata(err) {
  const code = String((err && (err.code || err.name)) || '');
  const msg = String((err && err.message) || err || '');
  if (code.includes('resource-exhausted') || /quota/i.test(msg)) {
    return 'Günlük ücretsiz Firestore kotası doldu. Yarın (Pasifik saati 00:00) sıfırlanır.\n' +
           'Acilse Firebase planını Blaze\'a yükseltin.';
  }
  if (code.includes('permission-denied') || /insufficient permissions/i.test(msg)) {
    return 'Yetki hatası (permission-denied). Projede yayınlanan Firestore kuralları ' +
           '"sartnameler" koleksiyonuna izin vermiyor.\n' +
           'Çözüm: Firebase Console → Firestore → Kurallar → firestore.rules içeriğini yapıştır → Yayınla.\n' +
           '(veya terminalde: npm run deploy:rules)';
  }
  if (code.includes('unauthenticated')) {
    return 'Oturum geçersiz. Sayfayı yenileyip tekrar giriş yapın.';
  }
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || /network/i.test(msg)) {
    return 'Ağ bağlantısı kurulamadı. İnterneti kontrol edip tekrar deneyin.';
  }
  if (code.includes('invalid-argument')) {
    return 'Geçersiz veri: dosya adı veya SMT kodu sorunlu olabilir.';
  }
  return (code ? code + ' — ' : '') + (msg || 'Bilinmeyen hata');
}

const donemRef = id => doc(db, 'donemler', String(id).trim());
const malzemelerCol = id => collection(db, 'donemler', String(id).trim(), 'malzemeler');
const servislerCol = id => collection(db, 'donemler', String(id).trim(), 'servisler');
const publicRef = token => doc(db, 'publicData', String(token || '').trim().toLowerCase());

async function runBatches(tasks) {
  for (let i = 0; i < tasks.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    tasks.slice(i, i + BATCH_LIMIT).forEach(fn => fn(batch));
    await batch.commit();
  }
}

/* ---------------- Yönetici yetki kontrolü ---------------- */

// Firestore kuralları yönetici değilse permission-denied döner.
export async function pingAdmin() {
  await getDocs(query(collection(db, 'donemler'), limit(1)));
  return true;
}

/* ---------------- Dönemler ---------------- */

export async function listDonemler() {
  const snap = await getDocs(collection(db, 'donemler'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function getDonem(id) {
  const snap = await getDoc(donemRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// İhale süresi (ay): 1-24 arası tam sayı; geçersizse 0 (tanımsız).
function aySureDeger(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(24, n);
}

export async function createDonem(ad, opts = {}) {
  const name = String(ad || '').trim();
  if (!name) throw new Error('Dönem adı boş olamaz');
  const aySure = aySureDeger(opts.aySure);
  const id = 'donem-' + Date.now();
  const now = nowIso();
  await setDoc(donemRef(id), {
    ad: name,
    aySure,
    createdAt: now,
    updatedAt: now,
    file: '',
    materialCount: 0,
    serviceCount: 0,
    branslar: []
  });
  return { id, ad: name, aySure };
}

// Dönem adı ve/veya ihale süresini günceller; servis portallarına da yayar.
export async function updateDonem(donemId, patch = {}) {
  const id = String(donemId).trim();
  const data = { updatedAt: nowIso() };
  if (patch.ad !== undefined) {
    const ad = String(patch.ad).trim();
    if (!ad) throw new Error('Dönem adı boş olamaz');
    data.ad = ad;
  }
  if (patch.aySure !== undefined) data.aySure = aySureDeger(patch.aySure);
  if (Object.keys(data).length === 1) return { success: true };
  await updateDoc(donemRef(id), data);
  await syncPublicData(id);
  return { success: true, ...data };
}

export async function deleteDonem(donemId) {
  const id = String(donemId).trim();
  const [matSnap, svcSnap] = await Promise.all([
    getDocs(malzemelerCol(id)),
    getDocs(servislerCol(id))
  ]);

  await runBatches([
    ...svcSnap.docs.map(s => b => b.delete(publicRef(s.data().token))),
    ...svcSnap.docs.map(s => b => b.delete(s.ref)),
    ...matSnap.docs.map(m => b => b.delete(m.ref))
  ]);

  await deleteDoc(donemRef(id));
  return { success: true };
}

/* ---------------- Malzemeler ---------------- */

export async function listMaterials(donemId) {
  const snap = await getDocs(query(malzemelerCol(donemId), orderBy('order')));
  return snap.docs.map(d => {
    const data = d.data() || {};
    return {
      key: d.id,
      sutKodu: data.sutKodu || '',
      tasinirKodu: data.tasinirKodu || '',
      tanim: data.tanim || '',
      smtKodu: data.smtKodu || '',
      branslar: Array.isArray(data.branslar) ? data.branslar : []
    };
  });
}

export async function saveMaterials(donemId, materials, branslar, fileMeta) {
  const id = String(donemId).trim();
  const oldSnap = await getDocs(malzemelerCol(id));

  // Firestore belge kimliği "/" içeremez; uygun olmayan satırlar atlanır.
  const valid = [];
  let skipped = 0;
  materials.forEach(m => {
    const key = String(m.key === undefined || m.key === null ? '' : m.key).trim();
    if (!key || key.includes('/') || key === '.' || key === '..') { skipped++; return; }
    valid.push({ ...m, key });
  });

  const deletes = oldSnap.docs.map(d => b => b.delete(d.ref));
  const writes = valid.map((m, i) => b => {
    b.set(doc(db, 'donemler', id, 'malzemeler', m.key), {
      key: m.key,
      sutKodu: m.sutKodu || '',
      tasinirKodu: m.tasinirKodu || '',
      tanim: m.tanim || '',
      smtKodu: m.smtKodu || '',
      branslar: Array.isArray(m.branslar) ? m.branslar : [],
      order: i
    });
  });

  await runBatches([...deletes, ...writes]);

  await updateDoc(donemRef(id), {
    materialCount: valid.length,
    branslar: branslar || [],
    file: fileMeta && fileMeta.name ? fileMeta.name : '',
    updatedAt: nowIso()
  });

  await syncPublicData(id);
  return { success: true, count: valid.length, skipped };
}

// Portal dokümanlarını (dönem adı + branş listesi) güncel tutar.
export async function syncPublicData(donemId) {
  const id = String(donemId).trim();
  const [donem, svcSnap] = await Promise.all([getDonem(id), getDocs(servislerCol(id))]);
  if (!donem) return;

  await runBatches(svcSnap.docs.map(s => b => {
    const token = s.data().token;
    if (!token) return;
    b.set(publicRef(token), {
      donemAd: donem.ad || '',
      aySure: Number(donem.aySure) || 0,
      branslar: donem.branslar || []
    }, { merge: true });
  }));
}

/* ---------------- Servisler ---------------- */

export async function listServices(donemId) {
  const snap = await getDocs(servislerCol(donemId));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
}

export async function addService(donemId, name) {
  const id = String(donemId).trim();
  const serviceName = String(name || '').trim();
  if (!serviceName) throw new Error('Servis adı boş olamaz');

  const donem = await getDonem(id);
  const serviceId = newId();
  const token = randomToken(24);
  const now = nowIso();

  await setDoc(doc(db, 'donemler', id, 'servisler', serviceId), {
    id: serviceId, name: serviceName, token, createdAt: now
  });

  await setDoc(publicRef(token), {
    donemId: id,
    donemAd: donem ? (donem.ad || '') : '',
    aySure: donem ? (Number(donem.aySure) || 0) : 0,
    serviceId,
    name: serviceName,
    branslar: donem ? (donem.branslar || []) : [],
    istekler: {},
    createdAt: now
  });

  await updateDoc(donemRef(id), { serviceCount: (await countServices(id)) || 0 });

  return { id: serviceId, name: serviceName, token };
}

async function countServices(donemId) {
  const snap = await getDocs(servislerCol(donemId));
  return snap.size;
}

export async function renameService(donemId, serviceId, newName) {
  const id = String(donemId).trim();
  const name = String(newName || '').trim();
  if (!name) throw new Error('Servis adı boş olamaz');

  const svcRef = doc(db, 'donemler', id, 'servisler', String(serviceId));
  const snap = await getDoc(svcRef);
  if (!snap.exists()) throw new Error('Servis bulunamadı');

  await updateDoc(svcRef, { name });
  const token = snap.data().token;
  if (token) await updateDoc(publicRef(token), { name });
  return { success: true, name };
}

export async function deleteService(donemId, serviceId) {
  const id = String(donemId).trim();
  const svcRef = doc(db, 'donemler', id, 'servisler', String(serviceId));
  const snap = await getDoc(svcRef);
  if (snap.exists()) {
    const token = snap.data().token;
    await deleteDoc(svcRef);
    if (token) await deleteDoc(publicRef(token)); // talepler de bu dokümanın içinde
  }
  await updateDoc(donemRef(id), { serviceCount: await countServices(id) });
  return { success: true };
}

/* ---------------- Talepler ---------------- */

function emptyMaps() {
  return { requests: {}, requestInfo: {} };
}

function collectRequests(snaps, services) {
  const { requests, requestInfo } = emptyMaps();
  snaps.forEach((snap, i) => {
    const svc = services[i];
    if (!snap || !snap.exists()) return;
    const istekler = snap.data().istekler || {};
    Object.keys(istekler).forEach(key => {
      const rec = istekler[key] || {};
      const miktar = Number(rec.miktar) || 0;
      if (!miktar) return;
      if (!requests[key]) requests[key] = {};
      requests[key][svc.id] = miktar;
      if (!requestInfo[key]) requestInfo[key] = {};
      requestInfo[key][svc.id] = { miktar, tarih: rec.tarih || '' };
    });
  });
  return { requests, requestInfo };
}

// Yönetici tablosu için: dönemin tüm servislerinin talepleri
export async function listDonemRequests(donemId, services) {
  const list = services || await listServices(donemId);
  if (!list.length) return emptyMaps();
  const snaps = await Promise.all(list.map(s => getDoc(publicRef(s.token))));
  return collectRequests(snaps, list);
}

// Portal: token ile servis verisini okur
export async function getPublicData(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  const snap = await getDoc(publicRef(t));
  return snap.exists() ? { token: t, ...snap.data() } : null;
}

// Portal: canlı güncelleme
export function watchPublicData(token, cb) {
  const t = String(token || '').trim().toLowerCase();
  return onSnapshot(publicRef(t), snap => {
    cb(snap.exists() ? { token: t, ...snap.data() } : null);
  }, err => cb(null, err));
}

export async function saveRequestByToken(token, materialKey, miktar) {
  const tarih = nowIso();
  await updateDoc(publicRef(token), new FieldPath('istekler', String(materialKey)), {
    miktar: Number(miktar),
    tarih
  });
  return { success: true, tarih };
}

export async function deleteRequestByToken(token, materialKey) {
  await updateDoc(publicRef(token), new FieldPath('istekler', String(materialKey)), deleteField());
  return { success: true };
}

/* ---------------- Şartnameler (Firestore, parçalı) ---------------- */
// Firebase Storage ücretli plan (Blaze) gerektirdiği için şartname dosyaları
// Firestore'da parçalı base64 olarak saklanır: tamamen ücretsiz kotaya dahildir.
// Tek Firestore dokümanı 1 MiB olabildiği için dosya ~384 KB'lık parçalara bölünür.

const SART_CHUNK = 384 * 1024;           // base64 karakter sayısı (parça başına)
const SART_BATCH = 6;                    // aynı anda yazılan parça sayısı (~2.3 MB)
const SART_MAX_BYTES = 20 * 1024 * 1024; // tek dosya üst sınırı

// Firestore ücretsiz (Spark) kotası — panel bu değerlere göre doluluk gösterir
export const FIRESTORE_FREE_QUOTA = 1024 * 1024 * 1024; // 1 GiB

function normCode(code) {
  return String(code === undefined || code === null ? '' : code)
    .trim()
    .replace(/[\/\\#?%*:|"<>]/g, '-');
}

const sartMetaRef = code => doc(db, 'sartnameler', normCode(code));
const sartChunksCol = code => collection(db, 'sartnameler', normCode(code), 'parcalar');

function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const step = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(out);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function readFileBuffer(file) {
  if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Dosya okunamadı'));
    fr.readAsArrayBuffer(file);
  });
}

// İki dosya "aynı" mı? (ad + boyut + son değişiklik zamanı)
export function ayniDosyaMi(meta, file) {
  if (!meta || !file) return false;
  const mSize = Number(meta.size) || 0;
  const fSize = Number(file.size) || 0;
  if (!mSize || mSize !== fSize) return false;
  if (String(meta.fileName || '') !== String(file.name || '')) return false;
  const mLm = Number(meta.lastModified) || 0;
  const fLm = Number(file.lastModified) || 0;
  if (!mLm || !fLm) return false; // eski kayıt (bilgi yok) → bir kez yeniden yazılır
  return mLm === fLm;
}

// opts.skipIfSame: dosya zaten aynıysa hiç yazmaz (kota ve süre tasarrufu)
export async function uploadSartname(smtKodu, file, onProgress, opts) {
  const code = normCode(smtKodu);
  if (!code) throw new Error('SMT kodu boş');
  if (!file) throw new Error('Dosya seçilmedi');

  const size = Number(file.size) || 0;
  const lastModified = Number(file.lastModified) || 0;
  const atlaAyni = !!(opts && opts.skipIfSame);

  if (size > SART_MAX_BYTES) {
    throw new Error(`Dosya çok büyük (${(size / 1048576).toFixed(1)} MB). Tek dosya sınırı ${SART_MAX_BYTES / 1048576} MB — PDF'e çevirip küçültün.`);
  }

  const buf = await readFileBuffer(file);
  const b64 = bytesToBase64(buf);
  const total = Math.max(1, Math.ceil(b64.length / SART_CHUNK));

  // Eski parça sayısı meta'dan okunur; böylece dosya başına fazladan
  // koleksiyon sorgusu (bir okuma) yapılmaz. 400+ dosyalık klasörlerde
  // bu, kotayı ciddi biçimde korur.
  let eskiAdet = 0;
  let eskiMeta = null;
  try {
    const eski = await getDoc(sartMetaRef(code));
    if (eski.exists()) {
      eskiMeta = eski.data();
      eskiAdet = Math.max(0, Math.floor(Number(eskiMeta.chunks) || 0));
    }
  } catch (e) { /* meta okunamazsa yeni dosya gibi davran */ }

  // Aynı dosya zaten yüklüyse hiç yazma (0 yazma, 0 süre)
  if (atlaAyni && ayniDosyaMi(eskiMeta, { size, fileName: file.name, lastModified })) {
    if (typeof onProgress === 'function') onProgress(1, 1);
    return { ...eskiMeta, smtKodu: code, skipped: true };
  }

  // Yeni dosya daha kısaysa artık parçaları sil
  if (eskiAdet > total) {
    const silinecek = [];
    for (let j = total; j < eskiAdet; j++) {
      silinecek.push(b => b.delete(doc(db, 'sartnameler', code, 'parcalar', String(j))));
    }
    await runBatches(silinecek);
  }

  const meta = {
    smtKodu: code,
    fileName: String(file.name || (code + '.pdf')),
    contentType: file.type || 'application/pdf',
    size: size || (buf.byteLength || 0),
    lastModified,
    chunks: total,
    updatedAt: nowIso()
  };

  // Parçaları yaz; bilgi dokümanı SON parçayla aynı batch'te yazılır:
  // hem yarım yükleme listelenmez hem bir yazma işlemi tasarruf edilir.
  for (let i = 0; i < total; i += SART_BATCH) {
    const batch = writeBatch(db);
    const end = Math.min(i + SART_BATCH, total);
    for (let j = i; j < end; j++) {
      batch.set(doc(db, 'sartnameler', code, 'parcalar', String(j)), {
        i: j,
        data: b64.slice(j * SART_CHUNK, (j + 1) * SART_CHUNK)
      });
    }
    if (end === total) batch.set(sartMetaRef(code), meta);
    await batch.commit();
    if (typeof onProgress === 'function') onProgress(end, total);
  }

  return meta;
}

export async function getSartnameMeta(smtKodu) {
  const code = normCode(smtKodu);
  if (!code) return null;
  const snap = await getDoc(sartMetaRef(code));
  return snap.exists() ? { smtKodu: code, ...snap.data() } : null;
}

// Portal/yönetici: dosyayı indirir ve tarayıcıda açılabilir bir adres döner
export async function readSartname(smtKodu) {
  const code = normCode(smtKodu);
  const meta = await getSartnameMeta(code);
  if (!meta) return null;

  const total = Math.max(1, Number(meta.chunks) || 1);
  const snaps = await Promise.all(
    Array.from({ length: total }, (_, i) => getDoc(doc(db, 'sartnameler', code, 'parcalar', String(i))))
  );

  let b64 = '';
  snaps.forEach(s => { if (s.exists()) b64 += String(s.data().data || ''); });
  if (!b64) return null;

  const bytes = base64ToBytes(b64);
  const blob = new Blob([bytes], { type: meta.contentType || 'application/pdf' });
  return { meta, blob, url: URL.createObjectURL(blob) };
}

export async function listSartnameler() {
  const snap = await getDocs(collection(db, 'sartnameler'));
  return snap.docs
    .map(d => ({ smtKodu: d.id, ...d.data() }))
    .sort((a, b) => String(a.smtKodu).localeCompare(String(b.smtKodu), 'tr', { numeric: true }));
}

// Firestore'da base64 ~%33 fazla yer kaplar; gerçek doluluk tahmini
export function tahminiDepolama(dosyalar) {
  const ham = (dosyalar || []).reduce((a, s) => a + (Number(s.size) || 0), 0);
  const dolu = Math.round(ham * 4 / 3);
  return {
    ham,
    dolu,
    oran: dolu / FIRESTORE_FREE_QUOTA,
    kalan: Math.max(0, FIRESTORE_FREE_QUOTA - dolu)
  };
}

export async function deleteSartname(smtKodu) {
  const code = normCode(smtKodu);
  if (!code) throw new Error('SMT kodu boş');
  const chunks = await getDocs(sartChunksCol(code));
  await runBatches([
    ...chunks.docs.map(d => b => b.delete(d.ref)),
    b => b.delete(sartMetaRef(code))
  ]);
  return { success: true };
}
