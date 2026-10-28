// ============================================================
// YÖNETİCİ PANELİ
// ============================================================
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { auth, configured } from './fb.js';
import { firebaseConfig } from './firebase-config.js';
import * as cfgMod from './firebase-config.js';
import * as api from './data.js';
import { $, toast, esc, fmt, fmtTs, sartKodunuBul, dosyaYolu, downloadObjectUrl } from './util.js';
import { sayfaliYazdir } from './print.js';

const XLSX = window.XLSX;

const PORTAL_BASE_URL = String((cfgMod && cfgMod.PORTAL_BASE_URL) || '');

const STATE = {
  user: null,
  donemler: [],
  activeDonemId: null,
  donem: null,
  sortKey: '',
  sortDir: 1,
  colFilters: {},
  lastRender: { rows: [], svcCols: [], grand: 0 }
};

/* ---------------- Ekran yönetimi ---------------- */

function showOnly(id) {
  ['setupPanel', 'loginPanel', 'app'].forEach(x => $(x).classList.toggle('hidden', x !== id));
  document.body.classList.toggle('app-mode', id === 'app');
}

function showLogin(msg) {
  showOnly('loginPanel');
  $('loginError').style.color = '#b91c1c';
  $('loginError').textContent = msg || '';
}

function showApp() {
  showOnly('app');
  $('userEmail').textContent = (STATE.user && STATE.user.email) || '';
  loadDonemler();
  renderSartList();
}

function loginErrorText(err) {
  const code = String((err && err.code) || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') ||
      code.includes('user-not-found') || code.includes('invalid-login')) {
    return 'E-posta veya şifre hatalı.';
  }
  if (code.includes('too-many-requests')) return 'Çok fazla deneme yapıldı. Lütfen biraz bekleyin.';
  if (code.includes('network')) return 'Ağ hatası. İnternet bağlantınızı kontrol edin.';
  if (code.includes('invalid-email')) return 'Geçersiz e-posta adresi.';
  if (code.includes('user-disabled')) return 'Bu hesap devre dışı bırakılmış.';
  return (err && err.message) ? err.message : 'Giriş yapılamadı.';
}

/* ---------------- Kimlik doğrulama ---------------- */

if (!configured) {
  showOnly('setupPanel');
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) {
      STATE.user = null;
      showLogin('');
      return;
    }
    try {
      await api.pingAdmin();
      STATE.user = user;
      showApp();
    } catch (e) {
      STATE.user = null;
      try { await signOut(auth); } catch (_) { /* yoksay */ }
      showLogin('Bu hesap yönetici yetkisine sahip değil. firestore.rules dosyasındaki e-posta listesine ekleyin.');
    }
  });

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('loginEmail').value.trim();
    const pass = $('loginPass').value;
    if (!email || !pass) { $('loginError').textContent = 'E-posta ve şifre girin.'; return; }

    $('loginBtn').disabled = true;
    $('loginError').style.color = '#b91c1c';
    $('loginError').textContent = '';
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      $('loginError').textContent = loginErrorText(err);
    } finally {
      $('loginBtn').disabled = false;
    }
  });

  $('forgotBtn').onclick = async () => {
    const email = $('loginEmail').value.trim();
    if (!email) { $('loginError').textContent = 'Önce e-posta adresinizi yazın.'; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      $('loginError').style.color = '#15803d';
      $('loginError').textContent = 'Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.';
    } catch (err) {
      $('loginError').style.color = '#b91c1c';
      $('loginError').textContent = loginErrorText(err);
    }
  };

  $('logoutBtn').onclick = () => signOut(auth);
}

/* ---------------- Dönemler ---------------- */

async function loadDonemler() {
  try {
    STATE.donemler = await api.listDonemler();
    renderDonemList();
  } catch (e) {
    $('donemList').innerHTML = '<div class="hint" style="color:#b91c1c;">Dönemler yüklenemedi: ' + esc(e.message) + '</div>';
  }
}

function renderDonemList() {
  const el = $('donemList');
  $('donemCountBadge').textContent = STATE.donemler.length;

  if (!STATE.donemler.length) {
    el.innerHTML = '<div class="hint">Henüz dönem yok. Yukarıdan oluşturun.</div>';
    return;
  }
  el.innerHTML = STATE.donemler.map(d => `
    <div class="donem-item ${d.id === STATE.activeDonemId ? 'active' : ''}" data-open="${esc(d.id)}">
      <div class="left">
        <div class="ad"><span>${esc(d.ad)}</span>${d.id === STATE.activeDonemId ? '<span class="badge badge-active">AKTİF</span>' : ''}</div>
        <div class="info">${d.materialCount || 0} malzeme · ${(d.branslar || []).length} branş · ${d.serviceCount || 0} servis</div>
        <div class="info">${Number(d.aySure) ? `${Number(d.aySure)} aylık ihale` : '<span style="color:#b45309;">⚠️ ihale süresi tanımsız</span>'}</div>
      </div>
      <button class="btn btn-sm btn-gray ad-edit" data-ayar="${esc(d.id)}"
              title="Dönem adı ve ihale süresini düzenle">✏️</button>
    </div>`).join('');

  el.querySelectorAll('[data-open]').forEach(item => {
    item.onclick = () => openDonem(item.dataset.open);
  });
  el.querySelectorAll('[data-ayar]').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); donemAyarAc(btn.dataset.ayar); };
  });
}

const AY_IPUCU = 'İhale süresi 1-24 ay arasında olmalı (boş bırakılırsa "tanımsız" kalır)';

// Boş alan → 0 (tanımsız). Geçersiz aralık → hata.
function aySureOku(input) {
  const raw = String(input && input.value != null ? input.value : '').trim();
  if (!raw) return { ok: true, aySure: 0 };
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > 24) return { ok: false, aySure: 0 };
  return { ok: true, aySure: n };
}

$('addDonemBtn').onclick = async () => {
  const ad = $('donemAd').value.trim();
  if (!ad) return toast('Dönem adı girin');
  const ay = aySureOku($('donemAy'));
  if (!ay.ok) return toast(AY_IPUCU);
  $('addDonemBtn').disabled = true;
  try {
    const res = await api.createDonem(ad, { aySure: ay.aySure });
    $('donemAd').value = '';
    toast(ay.aySure ? `Dönem oluşturuldu · ${ay.aySure} aylık` : 'Dönem oluşturuldu · ihale süresi tanımsız');
    await loadDonemler();
    await openDonem(res.id);
  } catch (e) {
    alert('Dönem oluşturulamadı: ' + e.message);
  } finally {
    $('addDonemBtn').disabled = false;
  }
};

// Dönem listesindeki ✏️ (aktif olmayan dönem için önce onu açar)
async function donemAyarAc(id) {
  if (!id) return toast('Önce bir dönem açın');
  if (STATE.activeDonemId !== id || !STATE.donem) await openDonem(id);
  if (!STATE.donem) return;
  openDonemAyar();
}

function openDonemAyar() {
  const d = STATE.donem;
  if (!d) return toast('Önce bir dönem açın');
  const root = $('modalRoot');
  const ayVar = Number(d.aySure) || 0;
  root.innerHTML = `<div class="modal-backdrop">
    <div class="modal">
      <h3>✏️ Dönem Bilgileri</h3>
      <label for="ayarAd">Dönem adı</label>
      <input type="text" id="ayarAd" value="${esc(d.ad || '')}" style="width:100%; font-size:14px; padding:9px;">
      <label for="ayarAy" style="margin-top:12px;">İhale süresi (ay) — isteğe bağlı</label>
      <input type="number" id="ayarAy" min="1" max="24" step="1" value="${ayVar || ''}"
             placeholder="ör. 4" style="width:100px; font-size:14px; padding:9px;">
      <div class="mat-info" style="margin-top:10px;">
        ${ayVar ? '' : '<b>Bu dönemde süre tanımsız.</b> 2, 4, 6… gibi bir ay sayısı yazıp kaydedin.<br>'}
        Süre, servis portalındaki taahhüt metninde ve tüm çıktılarda görünür.
        Değişiklik bütün servis linklerine yayılır.
      </div>
      <div class="actions">
        <button class="btn btn-gray" id="ayarIptal">İptal</button>
        <button class="btn btn-green" id="ayarKaydet">💾 Kaydet</button>
      </div>
    </div>
  </div>`;

  const kapat = () => { root.innerHTML = ''; };
  $('ayarIptal').onclick = kapat;
  root.querySelector('.modal-backdrop').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) kapat();
  });
  $('ayarAy').addEventListener('keydown', e => { if (e.key === 'Enter') $('ayarKaydet').click(); });

  $('ayarKaydet').onclick = async () => {
    const ad = $('ayarAd').value.trim();
    if (!ad) return toast('Dönem adı boş olamaz');
    const ay = aySureOku($('ayarAy'));
    if (!ay.ok) return toast(AY_IPUCU);
    const btn = $('ayarKaydet');
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor…';
    try {
      await api.updateDonem(d.id, { ad, aySure: ay.aySure });
      STATE.donem = { ...STATE.donem, ad, aySure: ay.aySure };
      kapat();
      toast(ay.aySure ? `Dönem güncellendi · ${ay.aySure} aylık` : 'Dönem güncellendi · süre tanımsız');
      await loadDonemler();
      await openDonem(d.id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '💾 Kaydet';
      toast('Güncellenemedi: ' + (e && e.message ? e.message : e));
    }
  };
  setTimeout(() => { const el = $('ayarAd'); if (el) { el.focus(); el.select(); } }, 60);
}

{
  const btn = $('donemAyarBtn');
  if (btn) btn.onclick = () => donemAyarAc(STATE.activeDonemId);
}

$('deleteDonemBtn').onclick = async () => {
  if (!STATE.activeDonemId) return;
  if (!confirm('Dönem, malzemeleri, servisleri ve tüm talepleri silinecek. Emin misiniz?')) return;
  try {
    await api.deleteDonem(STATE.activeDonemId);
    STATE.activeDonemId = null;
    STATE.donem = null;
    $('donemPanel').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    $('svcCountBadge').textContent = '0';
    await loadDonemler();
    toast('Dönem silindi');
  } catch (e) {
    alert('Dönem silinemedi: ' + e.message);
  }
};

async function openDonem(id) {
  STATE.activeDonemId = id;
  STATE.sortKey = '';
  STATE.sortDir = 1;
  STATE.colFilters = {};

  try {
    const [donem, materials, services] = await Promise.all([
      api.getDonem(id),
      api.listMaterials(id),
      api.listServices(id)
    ]);
    if (!donem) { toast('Dönem bulunamadı'); return; }

    const { requests, requestInfo } = await api.listDonemRequests(id, services);

    STATE.donem = { id, ...donem, materials, services, requests, requestInfo };

    $('emptyState').classList.add('hidden');
    $('donemPanel').classList.remove('hidden');
    $('donemHeaderAd').textContent = donem.ad;
    $('donemHeaderMeta').textContent =
      `${materials.length} malzeme · ${(donem.branslar || []).length} branş · ${services.length} servis · ` +
      (Number(donem.aySure) ? `${Number(donem.aySure)} aylık ihale` : 'ihale süresi tanımsız ✏️');
    $('dataStatus').textContent = materials.length ? `${materials.length} malzeme` : 'Excel yok';

    renderDonemList();
    renderServices();
    renderMatrix();
    renderSartList();
  } catch (e) {
    alert('Dönem açılamadı: ' + e.message);
  }
}

/* ---------------- Servisler ---------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) { /* güvenli olmayan bağlam */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e2) {
    return false;
  }
}

/* ---- Servis portalı linkleri ---- */

// Linkler her zaman firebase-config.js içindeki PORTAL_BASE_URL adresine göre üretilir
// (Netlify'da yayınlanan site). Değer boşsa sayfanın açıldığı adres kullanılır.
//   https://site              → https://site/s/<token>
//   https://site/s/           → https://site/s/<token>
//   https://.../exec?token=   → https://.../exec?token=<token>
//   https://.../?s={token}    → {token} yerine kod yazılır
function serviceUrl(token) {
  const t = encodeURIComponent(String(token || ''));
  const base = String(PORTAL_BASE_URL || '').trim();
  if (!base) return `${location.origin}/s/${t}`;
  if (/\{token\}/i.test(base)) return base.replace(/\{token\}/gi, t);
  if (/[?&](?:token|s)=[^&]*$/i.test(base)) {
    return base.replace(/([?&](?:token|s)=)[^&]*$/i, (m, p1) => p1 + t);
  }
  if (/[?&]$/.test(base)) return `${base}token=${t}`;
  if (/\/s\/?$/i.test(base)) return `${base.replace(/\/+$/, '')}/${t}`;
  return `${base.replace(/\/+$/, '')}/s/${t}`;
}

function renderServices() {
  const el = $('svcList');
  $('svcCountBadge').textContent = (STATE.donem && STATE.donem.services) ? STATE.donem.services.length : 0;

  if (!STATE.donem || !STATE.donem.services.length) {
    el.innerHTML = '<div class="hint">Henüz servis yok.</div>';
    return;
  }

  el.innerHTML = STATE.donem.services.map(s => {
    const url = serviceUrl(s.token);
    const nm = String(s.name || '').trim();
    return `<div class="svc-list-item">
      <span class="name">${nm ? esc(nm) : '<i style="color:#b91c1c;">(adı boş)</i>'}</span>
      <span class="url" title="${esc(url)}">${esc(url)}</span>
      <button class="btn btn-sm btn-gray" data-rename="${esc(s.id)}" title="Adı düzenle">✏️</button>
      <button class="btn btn-sm btn-gray" data-copy="${esc(url)}" title="Linki kopyala">📋</button>
      <button class="btn btn-sm btn-red" data-del="${esc(s.id)}" title="Servisi sil">🗑</button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-rename]').forEach(b => {
    b.onclick = () => servisAdiDuzenle(b.dataset.rename);
  });

  el.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = async () => {
      const ok = await copyText(b.dataset.copy);
      if (ok) { toast('Link kopyalandı'); return; }
      b.closest('.svc-list-item').classList.add('expanded');
      toast('Kopyalanamadı — linki elle kopyalayın');
    };
  });

  el.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => servisSil(b.dataset.del);
  });

  el.querySelectorAll('.svc-list-item').forEach(item => {
    const nm = item.querySelector('.name');
    if (!nm) return;
    nm.title = 'Linki görmek için tıkla';
    nm.onclick = () => item.classList.toggle('expanded');
  });
}

async function servisAdiDuzenle(serviceId) {
  const svc = (STATE.donem.services || []).find(s => s.id === serviceId);
  const root = $('modalRoot');
  const mevcut = svc ? String(svc.name || '') : '';

  root.innerHTML = `<div class="modal-backdrop">
    <div class="modal">
      <h3>✏️ Servis Adını Düzenle</h3>
      <label for="svcRenameInput">Servis adı</label>
      <input type="text" id="svcRenameInput" value="${esc(mevcut)}" placeholder="ör. Ameliyathane">
      <div class="actions">
        <button class="btn btn-gray" id="svcRenameCancel">İptal</button>
        <button class="btn" id="svcRenameSave">Kaydet</button>
      </div>
    </div>
  </div>`;

  const input = $('svcRenameInput');
  const kapat = () => { root.innerHTML = ''; };

  $('svcRenameCancel').onclick = kapat;

  const kaydet = async () => {
    const ad = input.value.trim();
    if (!ad) { toast('Ad boş olamaz'); input.focus(); return; }
    $('svcRenameSave').disabled = true;
    try {
      await api.renameService(STATE.activeDonemId, serviceId, ad);
      kapat();
      toast('Servis adı güncellendi');
      await openDonem(STATE.activeDonemId);
    } catch (e) {
      $('svcRenameSave').disabled = false;
      alert('Hata: ' + e.message);
    }
  };

  $('svcRenameSave').onclick = kaydet;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') kaydet();
    if (e.key === 'Escape') kapat();
  });
  setTimeout(() => { input.focus(); input.select(); }, 40);
}

async function servisSil(serviceId) {
  if (!confirm('Servis ve bu servise ait tüm talepler silinecek. Emin misiniz?')) return;
  try {
    await api.deleteService(STATE.activeDonemId, serviceId);
    toast('Servis silindi');
    await openDonem(STATE.activeDonemId);
    await loadDonemler();
  } catch (e) {
    alert('Servis silinemedi: ' + e.message);
  }
}

$('addSvcBtn').onclick = async () => {
  const name = $('svcName').value.trim();
  if (!name) return toast('Servis adı girin');
  if (!STATE.activeDonemId) return toast('Önce soldan bir dönem açın');
  $('addSvcBtn').disabled = true;
  try {
    await api.addService(STATE.activeDonemId, name);
    $('svcName').value = '';
    toast('Servis eklendi');
    await openDonem(STATE.activeDonemId);
    await loadDonemler();
  } catch (e) {
    alert('Servis eklenemedi: ' + e.message);
  } finally {
    $('addSvcBtn').disabled = false;
  }
};

/* ---------------- Ana tablo: sıralama / filtre / Excel ---------------- */

function cellRaw(m, sid) {
  const v = STATE.donem.requests[m.key] ? STATE.donem.requests[m.key][sid] : undefined;
  return v === undefined || v === null || v === '' ? 0 : Number(v) || 0;
}

function colValue(row, key) {
  if (key === 'sutKodu') return row.m.sutKodu || '';
  if (key === 'tasinirKodu') return row.m.tasinirKodu || '';
  if (key === 'tanim') return row.m.tanim || '';
  if (key === 'smtKodu') return row.m.smtKodu || '';
  if (key === 'total') return row.total;
  if (key.startsWith('svc:')) return row.vals[key.slice(4)] || 0;
  return '';
}

function isNumericKey(key) {
  return key === 'total' || key.startsWith('svc:');
}

function passesFilters(row) {
  const f = STATE.colFilters;
  const checks = {
    sutKodu: String(row.m.sutKodu || '').trim(),
    tasinirKodu: String(row.m.tasinirKodu || '').trim(),
    tanim: String(row.m.tanim || '').trim(),
    smtKodu: String(row.m.smtKodu || '').trim(),
    total: row.total
  };
  for (const k in f) {
    const val = f[k];
    if (!val) continue;
    let filled;
    if (k.startsWith('svc:')) filled = (row.vals[k.slice(4)] || 0) > 0;
    else if (k === 'total') filled = (checks.total || 0) > 0;
    else filled = String(checks[k] || '').trim() !== '';
    if (val === 'filled' && !filled) return false;
    if (val === 'empty' && filled) return false;
  }
  return true;
}

function filterSelectHTML(key) {
  const cur = STATE.colFilters[key] || '';
  const opt = (v, t) => `<option value="${v}"${cur === v ? ' selected' : ''}>${t}</option>`;
  return `<select data-colfilter="${esc(key)}">${opt('', 'Tümü')}${opt('filled', 'Dolu')}${opt('empty', 'Boş')}</select>`;
}

function sortIndicator(key) {
  if (STATE.sortKey !== key) return '';
  return STATE.sortDir === 1 ? '▲' : '▼';
}

function thSort(key, label, extra) {
  return `<th class="sortable" data-sort="${esc(key)}" style="${extra || ''}">${label} <span class="sort-ind">${sortIndicator(key)}</span></th>`;
}

function svcTh(s) {
  const key = 'svc:' + s.id;
  const nm = String(s.name || '').trim() || '(adsız)';
  return `<th class="sortable" data-sort="${esc(key)}" title="${esc(nm)}" style="text-align:center;">${esc(nm)} <span class="sort-ind">${sortIndicator(key)}</span></th>`;
}

// Sütun genişlikleri: TOPLAM sabit ve sağda kalır, servis sütunları daralır,
// kalan alan malzeme adına (Tanım) verilir.
const COL_W = {
  sut: 88, tasinir: 112, smt: 84, sart: 72, total: 96,
  svcMin: 64, svcMax: 148, tanimMin: 220, tanimMax: 780
};

function applyColWidths(svcCount) {
  const cols = $('mainCols'), wrap = $('tableWrap'), table = $('mainTable');
  if (!cols || !wrap || !table) return;

  const avail = wrap.clientWidth;
  if (avail < 240) return; // panel gizli/animasyon sırasında ölçüm yapma

  const fixed = COL_W.sut + COL_W.tasinir + COL_W.smt + COL_W.sart + COL_W.total;
  const spare = Math.max(0, avail - fixed);

  let svcW = COL_W.svcMin;
  if (svcCount > 0) {
    const tanimTarget = Math.max(COL_W.tanimMin, Math.min(COL_W.tanimMax, Math.floor(spare * 0.55)));
    svcW = Math.floor((spare - tanimTarget) / svcCount);
    svcW = Math.max(COL_W.svcMin, Math.min(COL_W.svcMax, svcW));
  }

  const tanimW = Math.max(COL_W.tanimMin, spare - svcW * svcCount);

  const widths = [COL_W.sut, COL_W.tasinir, tanimW, COL_W.smt, COL_W.sart];
  for (let i = 0; i < svcCount; i++) widths.push(svcW);
  widths.push(COL_W.total);

  cols.innerHTML = widths.map(w => `<col style="width:${Math.round(w)}px">`).join('');
  table.style.minWidth = Math.round(widths.reduce((a, b) => a + b, 0)) + 'px';
}

// Panel genişliği değişince (menü gizleme, pencere boyutu, zoom) yeniden hesapla
let _wrapObserver = null;
function observeTableWrap() {
  const wrap = $('tableWrap');
  if (!wrap || typeof ResizeObserver === 'undefined' || _wrapObserver) return;
  _wrapObserver = new ResizeObserver(() => {
    if (!STATE.donem) return;
    applyColWidths(STATE.donem.services.length);
  });
  _wrapObserver.observe(wrap);
}

observeTableWrap();

let _rsz = null;
window.addEventListener('resize', () => {
  clearTimeout(_rsz);
  _rsz = setTimeout(() => {
    if (STATE.donem) applyColWidths(STATE.donem.services.length);
  }, 150);
});

function renderMatrix() {
  if (!STATE.donem) return;
  const thead = $('mainThead'), tbody = $('mainTbody'), tfoot = $('mainTfoot');
  const filter = ($('mainFilter').value || '').toLowerCase();
  const svcCols = STATE.donem.services;
  const infoAll = STATE.donem.requestInfo || {};

  thead.innerHTML = `<tr>
    ${thSort('sutKodu', 'SutKodu')}
    ${thSort('tasinirKodu', 'Taşınır Kodu')}
    ${thSort('tanim', 'Malzeme Tanımı')}
    ${thSort('smtKodu', 'SMT Kodu')}
    <th style="text-align:center;">Şartname</th>
    ${svcCols.map(svcTh).join('')}
    ${thSort('total', 'TOPLAM', 'text-align:center;')}
  </tr>
  <tr class="filter-row">
    <th>${filterSelectHTML('sutKodu')}</th>
    <th>${filterSelectHTML('tasinirKodu')}</th>
    <th>${filterSelectHTML('tanim')}</th>
    <th>${filterSelectHTML('smtKodu')}</th>
    <th style="text-align:center;">—</th>
    ${svcCols.map(s => `<th>${filterSelectHTML('svc:' + s.id)}</th>`).join('')}
    <th>${filterSelectHTML('total')}</th>
  </tr>`;

  applyColWidths(svcCols.length);

  // 1) Satırları hazırla
  const rows = [];
  for (const m of STATE.donem.materials) {
    const searchStr = `${m.tanim || ''} ${m.sutKodu || ''} ${m.tasinirKodu || ''} ${m.smtKodu || ''}`.toLowerCase();
    if (filter && !searchStr.includes(filter)) continue;

    const vals = {};
    let total = 0;
    for (const s of svcCols) {
      const v = cellRaw(m, s.id);
      vals[s.id] = v;
      total += v;
    }
    rows.push({ m, vals, total, info: infoAll[m.key] || {} });
  }

  const beforeColFilter = rows.length;
  const visible = rows.filter(passesFilters);

  // 2) Sıralama
  if (STATE.sortKey) {
    const key = STATE.sortKey, dir = STATE.sortDir;
    visible.sort((a, b) => {
      if (isNumericKey(key)) {
        const av = colValue(a, key), bv = colValue(b, key);
        return (av - bv) * dir || String(a.m.tanim || '').localeCompare(String(b.m.tanim || ''), 'tr');
      }
      const av = String(colValue(a, key) || ''), bv = String(colValue(b, key) || '');
      return av.localeCompare(bv, 'tr', { numeric: true, sensitivity: 'base' }) * dir;
    });
  }

  // 3) Gövde
  let html = '', grand = 0;
  for (const row of visible) {
    const m = row.m;
    grand += row.total;
    let cells = '';
    for (const s of svcCols) {
      const v = row.vals[s.id];
      const rec = row.info[s.id];
      const ts = rec && rec.tarih ? fmtTs(rec.tarih) : '';
      cells += `<td style="text-align:center;">
        <input type="number" min="0" class="amount-input" data-key="${esc(m.key)}" data-sid="${esc(s.id)}" value="${v || ''}" title="${ts ? 'Son kayıt: ' + esc(ts) : ''}">
        ${ts ? `<div class="cell-ts" title="${esc(ts)}">🕒 ${esc(ts)}</div>` : ''}
      </td>`;
    }
    const sartBtn = m.smtKodu
      ? `<button class="btn btn-sm btn-orange" data-sart="${esc(m.smtKodu)}">📄</button>`
      : '—';
    html += `<tr>
      <td title="${esc(m.sutKodu)}">${esc(m.sutKodu)}</td>
      <td title="${esc(m.tasinirKodu)}">${esc(m.tasinirKodu)}</td>
      <td title="${esc(m.tanim)}">${esc(m.tanim)}</td>
      <td title="${esc(m.smtKodu)}">${esc(m.smtKodu)}</td>
      <td style="text-align:center;">${sartBtn}</td>
      ${cells}
      <td style="font-weight:700;">${row.total ? fmt(row.total) : ''}</td>
    </tr>`;
  }
  tbody.innerHTML = html || `<tr><td colspan="${5 + svcCols.length + 1}" style="text-align:center;">Kayıt yok</td></tr>`;

  // 4) Toplam satırı (görünen satırlar üzerinden)
  let totalCells = '';
  for (const s of svcCols) {
    let t = 0;
    for (const row of visible) t += row.vals[s.id] || 0;
    totalCells += `<td style="text-align:center;">${t ? fmt(t) : ''}</td>`;
  }
  tfoot.innerHTML = `<tr class="total-row"><td colspan="5" style="text-align:right;">TOPLAM →</td>${totalCells}<td>${grand ? fmt(grand) : ''}</td></tr>`;
  $('grandBadge').textContent = 'Toplam: ' + fmt(grand);
  $('rowBadge').textContent = visible.length + (beforeColFilter !== visible.length ? ' / ' + beforeColFilter : '') + ' satır';

  STATE.lastRender = { rows: visible, svcCols, grand };

  // 5) Olaylar
  tbody.querySelectorAll('.amount-input').forEach(inp => {
    inp.addEventListener('change', async e => {
      const key = e.target.dataset.key;
      const sid = e.target.dataset.sid;
      const val = e.target.value.trim();
      const miktar = val ? Number(val) : 0;
      const svc = STATE.donem.services.find(s => s.id === sid);
      if (!svc) return;

      e.target.disabled = true;
      try {
        if (miktar > 0) {
          const res = await api.saveRequestByToken(svc.token, key, miktar);
          STATE.donem.requests[key] = STATE.donem.requests[key] || {};
          STATE.donem.requests[key][sid] = miktar;
          STATE.donem.requestInfo[key] = STATE.donem.requestInfo[key] || {};
          STATE.donem.requestInfo[key][sid] = { miktar, tarih: res.tarih };
        } else {
          await api.deleteRequestByToken(svc.token, key);
          if (STATE.donem.requests[key]) delete STATE.donem.requests[key][sid];
          if (STATE.donem.requestInfo[key]) delete STATE.donem.requestInfo[key][sid];
        }
        renderMatrix();
      } catch (err) {
        alert('Kaydedilemedi: ' + err.message);
        e.target.disabled = false;
      }
    });
  });

  tbody.querySelectorAll('[data-sart]').forEach(b => {
    b.onclick = () => sartnameAc(b.dataset.sart);
  });

  thead.querySelectorAll('th[data-sort]').forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (STATE.sortKey === key) STATE.sortDir = -STATE.sortDir;
      else { STATE.sortKey = key; STATE.sortDir = 1; }
      renderMatrix();
    };
  });

  thead.querySelectorAll('select[data-colfilter]').forEach(sel => {
    sel.onchange = () => {
      const k = sel.dataset.colfilter;
      if (sel.value) STATE.colFilters[k] = sel.value;
      else delete STATE.colFilters[k];
      renderMatrix();
    };
  });
}

$('mainFilter').addEventListener('input', renderMatrix);

$('clearColFiltersBtn').onclick = () => {
  STATE.colFilters = {};
  document.querySelectorAll('#mainThead select[data-colfilter]').forEach(s => { s.value = ''; });
  renderMatrix();
  toast('Sütun filtreleri temizlendi');
};

$('exportXlsxBtn').onclick = () => exportMatrixXlsx();

function exportMatrixXlsx() {
  if (!STATE.donem) return toast('Önce bir dönem açın');
  if (!XLSX) return alert('Excel kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.');

  const svcCols = STATE.lastRender.svcCols.length ? STATE.lastRender.svcCols : STATE.donem.services;
  const rows = STATE.lastRender.rows || [];
  if (!rows.length) return toast('Dışa aktarılacak satır yok');

  const svcName = s => String(s.name || '').trim() || '(adsız)';
  const head = ['SutKodu', 'Taşınır Kodu', 'Malzeme Tanımı', 'SMT Kodu']
    .concat(svcCols.map(svcName))
    .concat(['TOPLAM']);

  const aoa = [head];
  for (const row of rows) {
    const line = [row.m.sutKodu || '', row.m.tasinirKodu || '', row.m.tanim || '', row.m.smtKodu || ''];
    for (const s of svcCols) line.push(row.vals[s.id] || '');
    line.push(row.total || '');
    aoa.push(line);
  }
  const totalLine = ['TOPLAM', '', '', ''];
  for (const s of svcCols) {
    let t = 0;
    for (const row of rows) t += row.vals[s.id] || 0;
    totalLine.push(t || '');
  }
  totalLine.push(STATE.lastRender.grand || '');
  aoa.push(totalLine);

  const flat = [['Servis', 'SutKodu', 'Taşınır Kodu', 'Malzeme Tanımı', 'Miktar', 'Tarih / Saat']];
  for (const row of rows) {
    for (const s of svcCols) {
      const miktar = row.vals[s.id] || 0;
      if (!miktar) continue;
      const rec = row.info ? row.info[s.id] : null;
      flat.push([
        svcName(s), row.m.sutKodu || '', row.m.tasinirKodu || '', row.m.tanim || '',
        miktar, rec && rec.tarih ? fmtTs(rec.tarih) : ''
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'İstek Tablosu');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(flat), 'İstek Listesi');

  const fileName = `istek-${dosyaAdiSlug(STATE.donem.ad)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    XLSX.writeFile(wb, fileName);
    toast('Excel indirildi');
  } catch (e) {
    try {
      const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
      const a = document.createElement('a');
      a.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64;
      a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('Excel indirildi');
    } catch (e2) {
      alert('Excel oluşturulamadı: ' + (e2 && e2.message ? e2.message : e2));
    }
  }
}

/* ---------------- Çıktı / Rapor (servisler dahil & hariç) ---------------- */

const HASTANE_ADI = 'T.C. SAĞLIK BAKANLIĞI — YOZGAT ŞEHİR HASTANESİ';

function satirVerisi() {
  const svcCols = STATE.donem.services;
  const infoAll = STATE.donem.requestInfo || {};
  return STATE.donem.materials.map(m => {
    const vals = {};
    let total = 0;
    for (const s of svcCols) {
      const v = cellRaw(m, s.id);
      vals[s.id] = v;
      total += v;
    }
    return { m, vals, total, info: infoAll[m.key] || {} };
  });
}

function ciktiSatirlari(kapsam) {
  if (kapsam === 'filtre') return (STATE.lastRender.rows || []).slice();
  const hepsi = satirVerisi();
  if (kapsam === 'hepsi') return hepsi;
  return hepsi.filter(r => r.total > 0);
}

function ciktiModel(opts) {
  const d = STATE.donem;
  const svcCols = d.services;
  const rows = ciktiSatirlari(opts.kapsam);
  const aySure = Number(d.aySure) || 0;
  const kalem = rows.length;
  const svcAdlari = svcCols
    .filter(s => rows.some(r => (r.vals[s.id] || 0) > 0))
    .map(s => String(s.name || '').trim() || '(adsız)');
  const svcSayisi = svcAdlari.length;

  // Servisler hariç çıktıda servislerden hiç söz edilmez; dahil çıktıda
  // "hastanemiz sarf depo ve X servis" ifadesi kullanılır.
  const talepEden = opts.dahil ? talepEdenIfadesi(svcAdlari) : 'hastanemiz';
  // Dönem adı zaten "A Grubu" içeriyorsa cümlede ikinci kez yazılmaz.
  const grup = /a\s*grubu/i.test(String(d.ad || '')) ? '' : 'A Grubu ';
  const donemTxt = `${d.ad}${aySure ? ` ${aySure} aylık` : ''}`;
  const metin =
    `Yozgat Şehir Hastanesi'nin ${donemTxt} döneminde ${grup}tıbbi sarf malzeme ihtiyacı için ` +
    'hazırlanan talep listesidir. ' +
    (kalem
      ? `Listede toplam ${kalem} kalem malzeme ${talepEden} tarafından talep edilmiştir.`
      : 'Listede malzeme bulunmamaktadır.');

  let basliklar, satirlar, altlik;
  if (opts.dahil) {
    basliklar = ['#', 'SutKodu', 'Taşınır Kodu', 'Malzeme Tanımı', 'SMT Kodu']
      .concat(svcCols.map(s => String(s.name || '').trim() || '(adsız)'))
      .concat(['TOPLAM']);
    satirlar = rows.map((r, i) => [i + 1, r.m.sutKodu || '', r.m.tasinirKodu || '', r.m.tanim || '', r.m.smtKodu || '']
      .concat(svcCols.map(s => r.vals[s.id] || ''))
      .concat([r.total || '']));
    altlik = ['', '', '', 'TOPLAM (kalem)', '']
      .concat(svcCols.map(s => {
        const n = rows.filter(r => (r.vals[s.id] || 0) > 0).length;
        return n ? `${n} kalem` : '';
      }))
      .concat([`${kalem} kalem`]);
  } else {
    basliklar = ['#', 'SutKodu', 'Taşınır Kodu', 'Malzeme Tanımı', 'SMT Kodu', 'Branş', 'Miktar'];
    satirlar = rows.map((r, i) =>
      [i + 1, r.m.sutKodu || '', r.m.tasinirKodu || '', r.m.tanim || '', r.m.smtKodu || '',
        (r.m.branslar || []).join(', '), r.total || '']);
    altlik = ['TOPLAM', '', '', `${kalem} kalem malzeme`, '', '', ''];
  }

  return {
    metin, basliklar, satirlar, altlik, kalem, svcSayisi, svcAdlari, aySure, dahil: !!opts.dahil,
    not: String(opts.not || '').trim()
  };
}

// "hastanemiz sarf depo", "hastanemiz sarf depo ve Ameliyathane servisi",
// "hastanemiz sarf depo, A ve B servisleri", çok servis varsa "... ve 22 servis"
function talepEdenIfadesi(adlar) {
  const n = (adlar || []).length;
  if (!n) return 'hastanemiz sarf depo';
  if (n > 6) return `hastanemiz sarf depo ve ${n} servis`;
  if (n === 1) return `hastanemiz sarf depo ve ${adlar[0]} servisi`;
  return `hastanemiz sarf depo, ${adlar.slice(0, -1).join(', ')} ve ${adlar[n - 1]} servisleri`;
}

function ciktiMerkez(m, i) {
  if (i === 0) return true;
  if (m.dahil) return i >= 5;
  return i === 6;
}

// Çıktıyı yazdırma penceresinin sayfalayabileceği parçalara ayırır.
// header  : her sayfada yinelenen başlık
// rows    : tablo satırları (toplam satırı en sonda)
// blocks  : bölünmemesi gereken bloklar (imza kutuları)
function ciktiParcalari(m) {
  const d = STATE.donem;
  const now = new Date();
  const tarih = now.toLocaleDateString('tr-TR');
  const saat = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const imza = $('ciktiImza') && $('ciktiImza').checked;

  const headHtml = m.basliklar.map(h => `<th>${esc(String(h))}</th>`).join('');
  const rows = m.satirlar.map((r, i) => `<tr${i % 2 ? ' class="alt"' : ''}>` + r.map((c, k) =>
    `<td style="text-align:${ciktiMerkez(m, k) ? 'center' : 'left'};">${esc(String(c))}</td>`
  ).join('') + '</tr>');

  let footHtml;
  if (m.dahil) {
    const svcN = STATE.donem.services.length;
    footHtml = `<td colspan="5" style="text-align:right;">TOPLAM (kalem)</td>` +
      m.altlik.slice(5, 5 + svcN).map(c => `<td style="text-align:center;">${esc(String(c))}</td>`).join('') +
      `<td style="text-align:center;">${esc(String(m.kalem + ' kalem'))}</td>`;
  } else {
    footHtml = `<td colspan="6" style="text-align:right;">TOPLAM — ${m.kalem} kalem malzeme</td><td></td>`;
  }
  rows.push(`<tr class="sum-row">${footHtml}</tr>`);

  const imzaHtml = imza ? `<div class="sig">
      <div><span class="lbl">HAZIRLAYAN</span><div class="sub">Ad Soyad / İmza</div></div>
      <div><span class="lbl">KONTROL EDEN</span><div class="sub">Ad Soyad / İmza</div></div>
      <div><span class="lbl">ONAYLAYAN</span><div class="sub">Başhekim / İmza — Kaşe</div></div>
    </div>` : '';

  return {
    header: `<div class="org">${esc(HASTANE_ADI)}</div>
      <div class="ttl">A GRUBU TIBBİ SARF MALZEME TALEP LİSTESİ</div>
      <div class="ttl2">${m.dahil ? 'Servisler dahil — her servis ayrı sütun' : 'Servisler hariç — malzeme bazında toplam'}</div>
      <div class="hr"></div>
      <table class="info"><tr>
        <td><b>Dönem:</b> ${esc(d.ad || '')}</td>
        <td><b>İhale süresi:</b> ${m.aySure ? esc(m.aySure + ' aylık') : '—'}</td>
        <td><b>Kalem sayısı:</b> ${m.kalem}</td>
        ${m.dahil && m.svcSayisi ? `<td><b>Servis sayısı:</b> ${m.svcSayisi}</td>` : ''}
        <td><b>Tarih:</b> ${esc(tarih)} ${esc(saat)}</td>
      </tr></table>
      <p class="desc">${esc(m.metin)}</p>
      ${m.not ? `<p class="note">${esc(m.not)}</p>` : ''}`,
    tableHead: `<tr>${headHtml}</tr>`,
    rows,
    blocks: imzaHtml ? [{ grup: 'imza', html: imzaHtml }] : [],
    altBilgi: `Oluşturan: ${esc((STATE.user && STATE.user.email) || '—')} · ${esc(HASTANE_ADI)} · ${esc(tarih)} ${esc(saat)}`
  };
}

const CIKTI_CSS = `
  .org { font-size: 13px; font-weight: 700; text-align: center; }
  .ttl { font-size: 12px; font-weight: 700; text-align: center; letter-spacing: .7px; margin-top: 2px; }
  .ttl2 { font-size: 10px; text-align: center; color: #475569; margin-top: 1px; }
  .hr { border-top: 2px solid #0f172a; margin: 5px 0 7px; }
  .info { width: 100%; font-size: 10.5px; border-collapse: collapse; }
  .info td { padding: 1px 3px; }
  .desc { font-size: 10.5px; line-height: 1.5; margin: 6px 0 4px; text-align: justify; }
  .note { font-size: 10.5px; font-style: italic; margin: 2px 0 6px; }
  table.pd { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.pd th, table.pd td { border: 1px solid #334155; padding: 2px 4px; vertical-align: top; }
  table.pd th { background: #1e40af; color: #fff; }
  table.pd .sum-row td { background: #fef3c7; font-weight: 700; }
  table.pd tbody tr.alt td { background: #f8fafc; }
  .sig { display: flex; gap: 10px; padding-top: 12px; break-inside: avoid; page-break-inside: avoid; }
  .sig > div { flex: 1; border: 1.2px solid #334155; border-radius: 5px; height: 88px; position: relative; padding: 6px; }
  .sig .lbl { font-size: 9.5px; font-weight: 700; color: #475569; }
  .sig .sub { position: absolute; bottom: 5px; left: 6px; right: 6px; font-size: 9px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 2px; }
`;

function yazdirPenceresi(parcalar, baslik) {
  const sonuc = sayfaliYazdir({
    baslik,
    header: parcalar.header,
    tableHead: parcalar.tableHead,
    rows: parcalar.rows,
    blocks: parcalar.blocks,
    altBilgi: parcalar.altBilgi,
    css: CIKTI_CSS
  });
  if (sonuc === 'blocked') toast('Yazdırma penceresi engellendi — açılır pencereye izin verin');
}

function dosyaAdiSlug(s) {
  const map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U' };
  return String(s || 'donem')
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, c => map[c] || c)
    .replace(/[^\w\-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'donem';
}

function xlsxKaydet(wb, fileName) {
  try {
    XLSX.writeFile(wb, fileName);
  } catch (e) {
    const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const a = document.createElement('a');
    a.href = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64;
    a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
}

function ciktiExcel(m) {
  if (!XLSX) return alert('Excel kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.');
  if (!m.satirlar.length) return toast('Seçilen kapsamda malzeme yok');

  const d = STATE.donem;
  const now = new Date();
  const aoa = [
    [HASTANE_ADI],
    ['A GRUBU TIBBİ SARF MALZEME TALEP LİSTESİ'],
    [`Dönem: ${d.ad || ''}`, '', `İhale süresi: ${m.aySure ? m.aySure + ' aylık' : '—'}`, '', `Tarih: ${now.toLocaleDateString('tr-TR')}`],
    [`Kapsam: ${m.dahil ? 'Servisler dahil' : 'Servisler hariç'} · ${m.kalem} kalem` +
      (m.dahil && m.svcSayisi ? ` · ${m.svcSayisi} servis` : '')],
    [m.metin]
  ];
  if (m.not) aoa.push([m.not]);
  aoa.push([]);
  aoa.push(m.basliklar);
  m.satirlar.forEach(r => aoa.push(r));
  aoa.push(m.altlik);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = m.basliklar.map((h, i) => ({ wch: i === 3 ? 58 : (i === 0 ? 5 : 16) }));
  ws['!freeze'] = { xSplit: 0, ySplit: 7 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Talep Listesi');

  const ad = dosyaAdiSlug(d.ad);
  xlsxKaydet(wb, `talep-${ad}-${m.dahil ? 'servisli' : 'servissiz'}-${now.toISOString().slice(0, 10)}.xlsx`);
  toast('Excel indirildi');
}

{
  const btn = $('ciktiBtn');
  if (btn) btn.onclick = () => openCiktiModal();
}

function openCiktiModal() {
  if (!STATE.donem) return toast('Önce bir dönem açın');
  if (!STATE.donem.materials.length) return toast('Bu dönemde malzeme yok — önce Excel yükleyin');

  const filtreSayi = (STATE.lastRender.rows || []).length;
  const talepSayi = satirVerisi().filter(r => r.total > 0).length;
  const root = $('modalRoot');

  root.innerHTML = `<div class="modal-backdrop">
    <div class="modal modal-wide">
      <h3>🖨 Çıktı / Rapor</h3>
      <label>Servis sütunları</label>
      <div class="seg">
        <label class="seg-i">
          <input type="radio" name="ciktiServis" value="haric" checked>
          <span class="seg-t"><b>Servisler hariç</b><span class="hint">Her malzeme tek satır · branş + toplam miktar (servis sütunu yok)</span></span>
        </label>
        <label class="seg-i">
          <input type="radio" name="ciktiServis" value="dahil">
          <span class="seg-t"><b>Servisler dahil</b><span class="hint">Her servis ayrı sütun · satır sonunda toplam</span></span>
        </label>
      </div>
      <label for="ciktiKapsam" style="margin-top:12px;">Kapsam</label>
      <select id="ciktiKapsam" style="width:100%;">
        <option value="talep">Sadece talebi olanlar (${talepSayi} kalem)</option>
        <option value="filtre">Ekrandaki sıralama / filtre (${filtreSayi} satır)</option>
        <option value="hepsi">Tüm malzemeler (${STATE.donem.materials.length} satır)</option>
      </select>
      <label for="ciktiNot" style="margin-top:12px;">Ek açıklama (opsiyonel)</label>
      <textarea id="ciktiNot" rows="2" placeholder="ör. İhale komisyonuna sunulmak üzere hazırlanmıştır."></textarea>
      <label class="chk" style="margin-top:10px;"><input type="checkbox" id="ciktiImza" checked> İmza alanları ekle</label>
      <div class="cikti-ozet" id="ciktiOzet"></div>
      <div class="actions">
        <button class="btn btn-gray" id="ciktiIptal">İptal</button>
        <button class="btn btn-sm btn-green" id="ciktiExcelBtn">⬇️ Excel</button>
        <button class="btn btn-green" id="ciktiYazdirBtn">🖨 Yazdır</button>
      </div>
    </div>
  </div>`;

  const secili = () => ({
    dahil: document.querySelector('input[name="ciktiServis"]:checked').value === 'dahil',
    kapsam: $('ciktiKapsam').value,
    not: $('ciktiNot').value
  });

  const ozetle = () => {
    const m = ciktiModel(secili());
    $('ciktiOzet').textContent = `${m.kalem} kalem · ` +
      (m.dahil ? `${m.svcSayisi} servis · ` : '') +
      (m.aySure ? `${m.aySure} aylık` : 'süre tanımsız') +
      ` · ${m.dahil ? 'servisler dahil' : 'servisler hariç'}`;
  };

  root.querySelectorAll('input[name="ciktiServis"], #ciktiKapsam, #ciktiNot').forEach(el => {
    el.addEventListener('input', ozetle);
    el.addEventListener('change', ozetle);
  });
  ozetle();

  $('ciktiIptal').onclick = () => { root.innerHTML = ''; };
  $('ciktiYazdirBtn').onclick = () => {
    const m = ciktiModel(secili());
    if (!m.satirlar.length) return toast('Seçilen kapsamda malzeme yok');
    const parcalar = ciktiParcalari(m); // imza onay kutusu modal kapanmadan okunmalı
    root.innerHTML = '';
    yazdirPenceresi(parcalar, 'Talep Listesi');
  };
  $('ciktiExcelBtn').onclick = () => {
    const m = ciktiModel(secili());
    if (!m.satirlar.length) return toast('Seçilen kapsamda malzeme yok');
    ciktiExcel(m);
  };
}

/* ---------------- Excel yükleme ---------------- */

$('fileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!STATE.activeDonemId) { e.target.value = ''; return toast('Önce soldan bir dönem açın'); }
  if (!XLSX) { alert('Excel kütüphanesi yüklenemedi.'); return; }

  $('dataStatus').textContent = 'Okunuyor...';

  const reader = new FileReader();
  reader.onload = async evt => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

      if (rows.length === 0) {
        alert('Excel dosyası boş görünüyor.');
        $('dataStatus').textContent = 'Boş dosya';
        return;
      }

      const materials = [];
      const branslar = [];

      rows.forEach(r => {
        const getVal = keys => {
          for (const k of keys) {
            if (r[k] !== undefined && r[k] !== '') return String(r[k]).trim();
            const cleanK = Object.keys(r).find(x => x.replace(/\s/g, '').toLowerCase() === k.replace(/\s/g, '').toLowerCase());
            if (cleanK && r[cleanK] !== undefined && r[cleanK] !== '') return String(r[cleanK]).trim();
          }
          return '';
        };

        const tanim = getVal(['Malzeme Tanımı', 'Malzeme Adı', 'Malzeme', 'Malzeme Adi']);
        const tasinir = getVal(['Taşınır Kodu', 'TaşınırKodu', 'Tasinir Kodu', 'TasinirKodu']);
        const sut = getVal(['SutKodu', 'SUT Kodu', 'Sut Kodu', 'SUTKodu']);
        const smt = getVal(['Teknik Şartname Kodu', 'SMT Kodu', 'SMTKodu', 'SMT']);
        const kat = getVal(['Kategori Adı', 'Branş', 'Brans', 'Kategori']);

        if (!tanim && !tasinir) return;

        const key = tasinir || sut;
        if (!key) return;

        const mevcut = materials.find(m => m.key === key);
        if (!mevcut) {
          materials.push({
            key, sutKodu: sut, tasinirKodu: tasinir, tanim,
            branslar: kat ? [kat] : [], smtKodu: smt
          });
        } else if (kat && !mevcut.branslar.includes(kat)) {
          mevcut.branslar.push(kat);
        }

        if (kat && !branslar.includes(kat)) branslar.push(kat);
      });

      if (materials.length === 0) {
        alert("Excel'de uygun sütunlar bulunamadı.\nLütfen 'Malzeme Tanımı' ve 'Taşınır Kodu' sütunlarının olduğundan emin olun.");
        $('dataStatus').textContent = 'Sütun hatası';
        return;
      }

      $('dataStatus').textContent = `${materials.length} kaydediliyor...`;

      const res = await api.saveMaterials(STATE.activeDonemId, materials, branslar, { name: file.name });

      if (res && res.skipped) {
        alert(`${res.skipped} satır atlandı: Taşınır/SUT kodu boş veya "/" içeriyor.`);
      }
      toast('Excel başarıyla yüklendi!');
      $('dataStatus').textContent = `✅ ${(res && res.count) || materials.length} malzeme`;
      await openDonem(STATE.activeDonemId);
      await loadDonemler();
    } catch (err) {
      alert('Excel yüklenemedi: ' + err.message);
      $('dataStatus').textContent = 'Kayıt hatası';
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
});

/* ---------------- Şartnameler ---------------- */

function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

const SART_KURAL_METNI = [
  'match /sartnameler/{smtKodu} {',
  '  allow get: if true;',
  '  allow list: if isAdmin();',
  '  allow write: if isAdmin();',
  '',
  '  match /parcalar/{parca} {',
  '    allow read: if true;',
  '    allow write: if isAdmin();',
  '  }',
  '}'
].join('\n');

function projeId() {
  return String((firebaseConfig && firebaseConfig.projectId) || '').trim();
}

function kurallarUrl() {
  const id = projeId();
  return id ? `https://console.firebase.google.com/project/${id}/firestore/rules` : 'https://console.firebase.google.com/';
}

let sartCache = [];
let sartListeHatasi = null;

const SART_CACHE_KEY = 'dmo.sart.cache';

// Son başarılı liste tarayıcıda saklanır: ağ/kota hatasında panel boş kalmaz.
function sartCacheOku() {
  try {
    const raw = localStorage.getItem(SART_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

async function renderSartList() {
  const el = $('sartList');
  if (!el) return;
  el.innerHTML = '<div class="hint">Yükleniyor...</div>';

  try {
    sartCache = await api.listSartnameler();
    sartListeHatasi = null;
    try { localStorage.setItem(SART_CACHE_KEY, JSON.stringify(sartCache)); } catch (e) { /* yoksay */ }
  } catch (e) {
    sartListeHatasi = api.firebaseHata(e);
    sartCache = sartCacheOku(); // son bilinen liste
  }

  $('sartCountBadge').textContent = sartCache.length ? sartCache.length : (sartListeHatasi ? '—' : 0);

  if (!sartCache.length) {
    $('sartStatus').textContent = sartListeHatasi ? 'Liste alınamadı' : '0 dosya';
    el.innerHTML = sartListeHatasi
      ? sartHataKutusu(sartListeHatasi)
      : '<div class="hint">Henüz şartname yok.</div>';
    sartHataBagla(el);
    return;
  }

  const depo = api.tahminiDepolama(sartCache);
  const total = depo.ham;
  const yuzde = depo.oran < 0.001 ? '0'
    : (depo.oran < 0.1 ? (depo.oran * 100).toFixed(1) : String(Math.round(depo.oran * 100)));

  const yuklu = new Set(sartCache.map(s => kodNormal(s.smtKodu)));
  const donemKodlar = Array.from(new Set(((STATE.donem && STATE.donem.materials) || [])
    .map(m => String(m.smtKodu || '').trim())
    .filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
  const eksik = donemKodlar.filter(k => !yuklu.has(kodNormal(k)));

  const statusEl = $('sartStatus');
  statusEl.textContent = `${sartCache.length} dosya · ${fmtBytes(total)} · %${yuzde} kota` +
    (eksik.length ? ` · ${eksik.length} kod eksik` : '');

  const ipucu = [];
  if (sartListeHatasi) ipucu.push('Liste yenilenemedi (son bilinen liste gösteriliyor):\n' + sartListeHatasi);
  if (eksik.length) ipucu.push('Şartnamesi olmayan kodlar:\n' + eksik.join(', '));
  ipucu.push(
    `Firestore doluluk: ${fmtBytes(depo.dolu)} / 1 GB (%${yuzde})\n` +
    `Kalan alan: ${fmtBytes(depo.kalan)}\n` +
    '(base64 nedeniyle dosya boyutunun ~1,33 katı yazılır)'
  );
  statusEl.title = ipucu.join('\n\n');
  statusEl.style.color = depo.oran >= 0.9 ? '#b91c1c' : (depo.oran >= 0.7 ? '#b45309' : '');

  if (depo.oran >= 0.7 && !renderSartList._uyardi) {
    renderSartList._uyardi = true;
    toast(`Depolama %${yuzde} dolu — ${fmtBytes(depo.kalan)} kaldı`);
  }

  const uyariBandi = sartListeHatasi
    ? `<div class="sart-error" style="margin-bottom:8px;">
         <b>Liste yenilenemedi</b> — son bilinen liste gösteriliyor.
         <div class="hint" style="margin:4px 0 8px; white-space:pre-line;">${esc(sartListeHatasi)}</div>
         <button class="btn btn-sm" id="sartRetry">↻ Tekrar Dene</button>
       </div>`
    : '';

  const aramaKutusu = sartCache.length > 12
    ? '<input type="text" id="sartAra" placeholder="🔍 dosya ara..." style="width:100%; margin-bottom:6px;">'
    : '';

  const aracCubugu = `<div class="sart-tools">
    <label class="sart-all"><input type="checkbox" id="sartHepsi"> <span>Tümü</span></label>
    <button class="btn btn-sm btn-red" id="sartSecSil" disabled>🗑 Seçilenleri Sil</button>
    <button class="btn btn-sm btn-gray" id="sartTumSil" title="Bu dönemdeki tüm şartname dosyalarını sil">Tümünü Sil</button>
    <span class="hint" id="sartSecSayi" style="font-size:10.5px;"></span>
  </div>`;

  el.innerHTML = uyariBandi + aramaKutusu + aracCubugu + sartCache.map(s => `
    <div class="svc-list-item" data-sartkayit="${esc(String(s.smtKodu).toLowerCase())}" data-kod="${esc(s.smtKodu)}">
      <input type="checkbox" class="sart-sec" data-kod="${esc(s.smtKodu)}" title="Seç">
      <span class="name" title="${esc(s.fileName || '')}">${esc(s.smtKodu)}</span>
      <span class="hint" style="font-size:10.5px; white-space:nowrap;">${fmtBytes(s.size)}</span>
      <button class="btn btn-sm btn-gray" data-sartopen="${esc(s.smtKodu)}" title="Aç">📄</button>
      <button class="btn btn-sm btn-red" data-sartdel="${esc(s.smtKodu)}" title="Sil">🗑</button>
    </div>`).join('') + eksikUyarisi(eksik, donemKodlar.length);

  const rb = $('sartRetry');
  if (rb) rb.onclick = () => renderSartList();

  const ara = $('sartAra');
  if (ara) {
    ara.oninput = () => {
      const q = ara.value.toLowerCase().trim();
      el.querySelectorAll('[data-sartkayit]').forEach(row => {
        row.style.display = !q || row.dataset.sartkayit.indexOf(q) !== -1 ? '' : 'none';
      });
    };
  }

  el.querySelectorAll('[data-sartopen]').forEach(b => { b.onclick = () => sartnameAc(b.dataset.sartopen); });
  el.querySelectorAll('[data-sartdel]').forEach(b => { b.onclick = () => sartnameSil(b.dataset.sartdel); });
  baglaEksikKodlar(el);
  sartSecimBagla(el);
}

// Seçim kutuları: sayaç + "Tümü" + toplu silme
function sartSecimBagla(el) {
  const hepsi = $('sartHepsi');
  const secBtn = $('sartSecSil');
  const tumBtn = $('sartTumSil');
  const sayi = $('sartSecSayi');
  const kutular = () => Array.from(el.querySelectorAll('.sart-sec'));

  const secilenler = () => kutular().filter(k => k.checked).map(k => k.dataset.kod);

  const guncelle = () => {
    const n = secilenler().length;
    const toplam = kutular().length;
    if (secBtn) {
      secBtn.disabled = n === 0;
      secBtn.textContent = n ? `🗑 Seçilenleri Sil (${n})` : '🗑 Seçilenleri Sil';
    }
    if (sayi) sayi.textContent = n ? `${n} / ${toplam} seçili` : '';
    if (hepsi) {
      hepsi.checked = toplam > 0 && n === toplam;
      hepsi.indeterminate = n > 0 && n < toplam;
    }
  };

  kutular().forEach(k => { k.onchange = guncelle; });

  if (hepsi) {
    hepsi.onchange = () => {
      kutular().forEach(k => {
        // yalnızca görünür (filtrelenmiş) satırları seç
        const satir = k.closest('.svc-list-item');
        if (satir && satir.style.display === 'none') return;
        k.checked = hepsi.checked;
      });
      guncelle();
    };
  }

  if (secBtn) secBtn.onclick = () => sartlariSil(secilenler());

  if (tumBtn) {
    tumBtn.onclick = () => {
      const kodlar = kutular().map(k => k.dataset.kod);
      sartlariSil(kodlar, true);
    };
  }

  guncelle();
}

// Yetki hatasında: kuralları kopyala + konsolu aç düğmeleri
function sartHataKutusu(mesaj) {
  const yetki = /yetki|permission-denied/i.test(mesaj);
  return `<div class="sart-error">
    <b>Şartnameler yüklenemedi / listelenemedi</b>
    <div class="hint" style="margin:4px 0 8px; white-space:pre-line;">${esc(mesaj)}</div>
    <div class="row" style="gap:6px;">
      <button class="btn btn-sm" id="sartRetry">↻ Tekrar Dene</button>
      ${yetki ? '<button class="btn btn-sm btn-orange" id="sartKuralKopyala">📋 Kural metnini kopyala</button>' : ''}
      ${yetki ? '<a class="btn btn-sm btn-gray" id="sartKonsol" target="_blank" rel="noopener" href="' + esc(kurallarUrl()) + '">🔗 Firebase Kuralları</a>' : ''}
    </div>
    ${yetki ? '<div class="small-note" style="margin-top:6px;">Firestore → Kurallar: <b>sartnameler</b> bloğunu ekleyip <b>Yayınla</b> düğmesine basın.</div>' : ''}
  </div>`;
}

function sartHataBagla(el) {
  const rb = $('sartRetry');
  if (rb) rb.onclick = () => renderSartList();

  const kb = $('sartKuralKopyala');
  if (kb) {
    kb.onclick = async () => {
      const ok = await copyText(SART_KURAL_METNI);
      toast(ok ? 'Kural metni kopyalandı — Firestore → Kurallar bölümüne yapıştırın' : 'Kopyalanamadı');
    };
  }
}

// Eksik kodları tıklanabilir etiket olarak gösterir (tıklayınca koda yazılır)
function eksikUyarisi(eksik, toplam) {
  if (!eksik.length) {
    return toplam ? '<div class="small-note" style="color:#15803d;">✔ Tüm SMT kodlarının şartnamesi var.</div>' : '';
  }
  const ilk = eksik.slice(0, 6);
  const kalan = eksik.length - ilk.length;
  return `<div class="sart-missing">
    <div class="small-note" style="margin-bottom:4px;">Şartnamesi olmayan ${eksik.length} kod:</div>
    ${ilk.map(k => `<button class="sart-chip" data-kod="${esc(k)}">${esc(k)}</button>`).join('')}
    ${kalan > 0 ? `<span class="small-note">+${kalan}</span>` : ''}
  </div>`;
}

function baglaEksikKodlar(el) {
  el.querySelectorAll('.sart-chip').forEach(b => {
    b.onclick = () => {
      const input = $('sartKod');
      if (!input) return;
      input.value = b.dataset.kod;
      input.focus();
      input.select();
      toast('Kod seçildi — dosya seçin veya kodu elle girin');
    };
  });
}

/* ---- Şartname yükleme (dosya / klasör / sürükle-bırak) ---- */

const SART_UZANTI = /\.(docx?|pdf|png|jpe?g|gif|webp)$/i;

// Word kilit dosyaları, sistem dosyaları ve desteklenmeyen uzantılar atlanır
function sartDesteklenir(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  if (!base) return false;
  if (base.startsWith('~$')) return false;
  if (/^(thumbs\.db|desktop\.ini|\.ds_store)$/i.test(base)) return false;
  if (/^\./.test(base)) return false;
  return SART_UZANTI.test(base);
}

// "SMT001", "SMT1", "SMT-1", "smt 1" aynı kod sayılır.
function kodNormal(v) {
  return String(v === undefined || v === null ? '' : v)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, '')   // ayraçları (- _ boşluk .) at
    .replace(/^([A-ZÇĞİÖŞÜ]+)0+(\d)/, '$1$2');
}

// Dosya adından bulunan kodu, dönemde varsa Excel'deki yazımına çevirir;
// böylece portal (malzemenin SMT koduyla arar) dosyayı bulur.
function kanonikKod(kod, known) {
  const hedef = kodNormal(kod);
  const eslesen = (known || []).find(k => kodNormal(k) === hedef);
  if (eslesen) return eslesen;
  // Dönemde yoksa ayraçları atıp kompakt yaz: "SMT-1500" -> "SMT1500"
  return String(kod || '').trim().toUpperCase().replace(/[-_\s.]+/g, '');
}

function sartKodlari() {
  return Array.from(new Set(
    ((STATE.donem && STATE.donem.materials) || [])
      .map(m => String(m.smtKodu || '').trim())
      .filter(Boolean)
  ));
}

async function sartlariYukle(fileList) {
  const files = Array.from(fileList || []).filter(f => f && f.name);
  if (!files.length) return;

  const manual = ($('sartKod').value || '').trim();
  const tekDosya = files.length === 1;
  const known = sartKodlari();

  const atlaAyni = !!($('sartAyniAtla') && $('sartAyniAtla').checked);

  // Mevcut kayıtlar (kod -> meta). Paneldeki liste: ek okuma yapılmaz.
  const mevcut = new Map();
  (sartCache || []).forEach(s => mevcut.set(kodNormal(s.smtKodu), s));

  const hazir = [];        // { file, code }
  const ayni = [];         // değişmemiş → atlandı
  const atlanan = [];      // desteklenmeyen uzantı
  const kodsuz = [];       // dosya adından kod bulunamadı
  const cakisan = [];      // aynı kod birden fazla dosyada
  const kodHaritasi = new Map();

  for (const f of files) {
    if (!sartDesteklenir(f.name)) { atlanan.push(f.name); continue; }

    // 1) Dosya adı → 2) klasör adları (SMT1044/derin cerrahi.docx) → 3) tahmin
    const ham = (tekDosya && manual) ? manual : sartKodunuBul(f, known);
    if (!ham) { kodsuz.push(dosyaYolu(f)); continue; }
    const code = kanonikKod(ham, known);

    const anahtar = kodNormal(code);
    if (kodHaritasi.has(anahtar)) {
      cakisan.push(`${code}: ${kodHaritasi.get(anahtar)} + ${dosyaYolu(f)}`);
      continue;
    }
    kodHaritasi.set(anahtar, f.name);

    // Aynı ad + boyut + tarih → zaten yüklü, tekrar yazma
    if (atlaAyni && api.ayniDosyaMi(mevcut.get(anahtar), f)) {
      ayni.push(code);
      continue;
    }
    hazir.push({ file: f, code });
  }

  if (!hazir.length) {
    await renderSartList();
    $('sartStatus').textContent = ayni.length
      ? `${ayni.length} dosya zaten güncel — yüklenecek yenisi yok`
      : 'Yüklenecek uygun dosya yok';
    if (ayni.length) toast(`${ayni.length} dosya zaten güncel, hiçbiri yeniden yazılmadı`);
    const msj = [];
    if (kodsuz.length) msj.push(`Kod bulunamadı (${kodsuz.length}):\n` + kodsuz.slice(0, 10).join('\n') +
      (kodsuz.length > 10 ? `\n… +${kodsuz.length - 10}` : ''));
    if (atlanan.length) msj.push(`Desteklenmeyen dosya atlandı: ${atlanan.length}`);
    if (msj.length) alert(msj.join('\n\n'));
    return;
  }

  const toplam = hazir.length;
  const hatalar = [];
  let ok = 0;
  let sira = 0;
  let kotaDurdu = false;

  const durum = extra => {
    $('sartStatus').textContent = `${Math.min(sira, toplam)}/${toplam}` + (extra ? ' · ' + extra : '');
  };
  durum('başladı');

  // Aynı anda en fazla 3 dosya: 400+ dosyalık klasörlerde ~3 kat hızlı,
  // kota yine kontrollü. Kota dolarsa kalan dosyalar denenmez.
  const isci = async () => {
    while (sira < toplam && !kotaDurdu) {
      const i = sira++;
      const { file, code } = hazir[i];
      durum(code);
      try {
        const res = await api.uploadSartname(code, file, (done, total) => {
          if (total > 1) durum(`${code} · ${done}/${total}`);
        }, { skipIfSame: atlaAyni });
        if (res && res.skipped) ayni.push(code);
        else ok++;
      } catch (err) {
        const mesaj = api.firebaseHata(err);
        hatalar.push(`${code} (${file.name}): ${mesaj}`);
        // Kota veya yetki hatası: kalan yüzlerce dosyayı denemek anlamsız
        if (/kota|quota|yetki|permission-denied/i.test(mesaj)) kotaDurdu = true;
      }
      durum(code);
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, toplam) }, isci));

  if (tekDosya && manual) $('sartKod').value = '';

  await renderSartList(); // durum satırını (dosya/boyut/kota) tazeler

  const ozetParcalari = [];
  if (ok) ozetParcalari.push(`${ok} yüklendi`);
  if (ayni.length) ozetParcalari.push(`${ayni.length} değişmedi (atlandı)`);
  $('sartStatus').textContent = `${sartCache.length} dosya · ${fmtBytes(api.tahminiDepolama(sartCache).ham)} · ${ozetParcalari.join(' · ')}`;

  if (ok) toast(`${ok} yeni/güncel şartname yazıldı` + (ayni.length ? `, ${ayni.length} değişmedi` : ''));

  const ozet = [];
  const yetkiVar = hatalar.some(h => /yetki|permission-denied/i.test(h));

  if (kotaDurdu && yetkiVar) {
    ozet.push('Yükleme durduruldu — Firestore yazma izni yok.\n\n' + hatalar[0] +
      `\n\n(${toplam} dosyadan ${ok} tanesi yüklendi, kalanı denenmedi.)`);
  } else if (kotaDurdu) {
    ozet.push('Günlük ücretsiz kota doldu — kalan dosyalar yüklenmedi.\n' +
      'Kota yarın (Pasifik saati 00:00) sıfırlanır; daha önce yüklenen dosyalar silinmedi.');
  } else if (hatalar.length) {
    ozet.push(`Yüklenemeyen (${hatalar.length}):\n` + hatalar.slice(0, 5).join('\n') +
      (hatalar.length > 5 ? `\n… +${hatalar.length - 5}` : ''));
  }
  if (kodsuz.length) ozet.push(`Kod bulunamadı (${kodsuz.length}):\n` + kodsuz.slice(0, 10).join('\n'));
  if (cakisan.length) ozet.push(`Aynı kod, yalnızca ilki yüklendi (${cakisan.length}):\n` + cakisan.slice(0, 10).join('\n'));
  if (atlanan.length) ozet.push(`Desteklenmeyen dosya atlandı: ${atlanan.length}`);
  if (ozet.length) alert(ozet.join('\n\n'));
}

$('sartFileInput').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  await sartlariYukle(files);
});

$('sartFolderInput').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  await sartlariYukle(files);
});

/* ---- Sürükle-bırak (klasörler dahil) ---- */
// Sürükle-bırakta tarayıcı webkitRelativePath vermez; klasör yolunu
// dosyaya __yol olarak yazıyoruz ki "SMT1044/derin cerrahi.docx" düzeni çalışsın.
function dosyaGezin(entry, out, depth, ustYol) {
  if (!entry || depth > 12) return Promise.resolve();
  const yol = ustYol ? ustYol + '/' + entry.name : entry.name;

  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(f => {
        try { f.__yol = yol; } catch (e) { /* dondurulmuş File nesnesi */ }
        out.push(f);
        resolve();
      }, () => resolve());
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const hepsi = [];
    const oku = () => new Promise(resolve => {
      reader.readEntries(batch => {
        if (!batch.length) return resolve();
        hepsi.push(...batch);
        resolve(oku());
      }, () => resolve());
    });
    return oku().then(() => Promise.all(hepsi.map(e => dosyaGezin(e, out, depth + 1, yol))));
  }
  return Promise.resolve();
}

async function birakilanDosyalar(dt) {
  const out = [];
  const items = Array.from((dt && dt.items) || []);

  const entries = items
    .map(it => (it.kind === 'file' && typeof it.webkitGetAsEntry === 'function') ? it.webkitGetAsEntry() : null)
    .filter(Boolean);

  if (entries.length) {
    await Promise.all(entries.map(en => dosyaGezin(en, out, 0)));
    return out;
  }
  return Array.from((dt && dt.files) || []);
}

function dropHazirla() {
  const zone = $('sartDrop');
  if (!zone) return;

  let sayac = 0;
  const gir = e => {
    if (!e.dataTransfer || Array.from(e.dataTransfer.types || []).indexOf('Files') === -1) return;
    e.preventDefault();
    sayac++;
    zone.classList.add('drag-over');
  };
  const cik = e => {
    if (e) e.preventDefault();
    sayac = Math.max(0, sayac - 1);
    if (!sayac) zone.classList.remove('drag-over');
  };

  zone.addEventListener('dragenter', gir);
  zone.addEventListener('dragover', e => { if (Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault(); });
  zone.addEventListener('dragleave', cik);
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    sayac = 0;
    zone.classList.remove('drag-over');
    if (!STATE.activeDonemId) return toast('Önce soldan bir dönem açın');
    $('sartStatus').textContent = 'Dosyalar okunuyor…';
    const files = await birakilanDosyalar(e.dataTransfer);
    await sartlariYukle(files);
  });

  // Sayfanın başka yerine bırakılınca tarayıcı dosyayı açmasın
  window.addEventListener('dragover', e => {
    if (Array.from(e.dataTransfer && e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault();
  });
  window.addEventListener('drop', e => {
    if (Array.from(e.dataTransfer && e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault();
  });
}

dropHazirla();

async function sartnameAc(smtKodu) {
  if (!smtKodu) return;

  let res = null;
  try { res = await api.readSartname(smtKodu); } catch (e) { res = null; }
  if (!res) {
    alert('Şartname bulunamadı: ' + smtKodu + '\n(4 · Şartnameler bölümünden yükleyin.)');
    return;
  }

  const type = String(res.meta.contentType || '').toLowerCase();
  const name = String(res.meta.fileName || '').toLowerCase();
  const gorunur = type === 'application/pdf' || type.indexOf('image/') === 0 ||
    /\.(pdf|png|jpe?g|gif|webp)$/.test(name);

  if (gorunur) {
    const w = window.open(res.url, '_blank', 'noopener');
    if (!w) downloadObjectUrl(res.url, res.meta.fileName);
    setTimeout(() => URL.revokeObjectURL(res.url), 120000);
  } else {
    downloadObjectUrl(res.url, res.meta.fileName || (smtKodu + '.docx'));
    toast('Dosya indirildi: ' + (res.meta.fileName || smtKodu));
  }
}

// Tek veya toplu silme. tumu=true ise onay metni farklı olur.
// Tek veya toplu silme. tumu=true ise onay metni farklı olur.
async function sartlariSil(kodlar, tumu) {
  const liste = Array.from(new Set((kodlar || []).filter(Boolean)));
  if (!liste.length) return toast('Silinecek dosya seçilmedi');

  const onay = tumu
    ? `Bu dönemdeki ${liste.length} şartname dosyasının TAMAMI silinecek. Emin misiniz?`
    : `${liste.length} şartname silinecek:` + String.fromCharCode(10) +
      liste.slice(0, 8).join(', ') + (liste.length > 8 ? ` … +${liste.length - 8}` : '');
  if (!confirm(onay)) return;

  let ok = 0;
  const hatalar = [];
  const toplam = liste.length;

  for (let i = 0; i < toplam; i++) {
    $('sartStatus').textContent = `Siliniyor ${i + 1}/${toplam}…`;
    try {
      await api.deleteSartname(liste[i]);
      ok++;
    } catch (e) {
      hatalar.push(`${liste[i]}: ${api.firebaseHata(e)}`);
      if (/yetki|permission-denied|kota/i.test(hatalar[hatalar.length - 1])) break;
    }
  }

  await renderSartList();
  toast(`${ok}/${toplam} şartname silindi`);
  if (hatalar.length) {
    alert(`Silinemeyen (${hatalar.length}):` + String.fromCharCode(10) + hatalar.slice(0, 6).join(String.fromCharCode(10)));
  }
}

async function sartnameSil(smtKodu) {
  if (!confirm(smtKodu + ' şartnamesi silinsin mi?')) return;
  try {
    await api.deleteSartname(smtKodu);
    toast('Şartname silindi');
    await renderSartList();
  } catch (e) {
    alert('Silinemedi: ' + (e.message || e));
  }
}

/* ---------------- Sol menü ---------------- */

const SIDEBAR_KEY = 'dmo.sidebar.collapsed';

function setSidebarCollapsed(v, save) {
  const collapsed = !!v;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const btn = $('sidebarToggle');
  if (btn) {
    btn.textContent = collapsed ? '»' : '«';
    btn.title = collapsed ? 'Sol menüyü göster' : 'Sol menüyü gizle';
  }
  if (save) {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) { /* yoksay */ }
  }
  if (STATE.donem) {
    applyColWidths(STATE.donem.services.length);
    setTimeout(() => applyColWidths(STATE.donem.services.length), 220);
  }
}

function initSidebar() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch (e) { /* yoksay */ }
  setSidebarCollapsed(collapsed, false);
}

$('sidebarToggle').onclick = () => {
  setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'), true);
};

initSidebar();

// Ctrl/Cmd + B ile sol menüyü aç/kapat
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'b') {
    e.preventDefault();
    setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'), true);
  }
});

/* Başlangıç */
if (configured && !auth.currentUser) {
  showOnly('loginPanel');
}
