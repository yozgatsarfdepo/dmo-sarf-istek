// ============================================================
// SERVİS PORTALI
// ============================================================
import { configured } from './fb.js';
import * as api from './data.js';
import {
  $, toast, esc, fmt, fmtTs, extractToken, cleanToken, tokenFromLocation, downloadObjectUrl
} from './util.js';
import { sayfaliYazdir } from './print.js';

const STATE = {
  token: '',
  donem: null,
  service: null,
  materials: [],
  branslar: [],
  requests: {},
  requestInfo: {},
  selectedServiceId: null
};

let unsubscribe = null;

/* ---------------- Ekranlar ---------------- */

function hideAll() {
  ['setupPanel', 'tokenPanel', 'errorPanel', 'loginPanel', 'app'].forEach(id => {
    $(id).classList.add('hidden');
  });
}

function showSetup() {
  hideAll();
  $('setupPanel').classList.remove('hidden');
}

function showTokenPanel() {
  hideAll();
  $('tokenPanel').classList.remove('hidden');
}

function showError(msg) {
  hideAll();
  $('errorPanel').classList.remove('hidden');
  $('errorText').textContent = 'Hata: ' + msg;
  $('errorToken').textContent = STATE.token ? 'Kullanılan link kodu: ' + STATE.token : '';
}

/* ---------------- Sekmeler ---------------- */

function activateTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.add('hidden'));
  const pane = $('pane-' + name);
  if (pane) pane.classList.remove('hidden');
  if (name === 'my') renderMy();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => activateTab(btn.dataset.tab);
});

/* ---------------- Veri ---------------- */

function applyPublicData(pub) {
  const istekler = (pub && pub.istekler) || {};
  const requests = {}, requestInfo = {};
  const sid = pub.serviceId;

  Object.keys(istekler).forEach(key => {
    const rec = istekler[key] || {};
    const miktar = Number(rec.miktar) || 0;
    if (!miktar) return;
    if (!requests[key]) requests[key] = {};
    requests[key][sid] = miktar;
    if (!requestInfo[key]) requestInfo[key] = {};
    requestInfo[key][sid] = { miktar, tarih: rec.tarih || '' };
  });

  STATE.requests = requests;
  STATE.requestInfo = requestInfo;
}

function subscribe(token) {
  if (unsubscribe) unsubscribe();
  unsubscribe = api.watchPublicData(token, (pub, err) => {
    if (err) return;
    if (!pub) { showError('Bu link kaldırılmış veya geçersiz.'); return; }

    applyPublicData(pub);
    if (pub.donemAd) {
      STATE.donem = { id: pub.donemId, ad: pub.donemAd, aySure: Number(pub.aySure) || 0 };
      $('donemAd').textContent = '📅 ' + pub.donemAd + (STATE.donem.aySure ? ` · ${STATE.donem.aySure} aylık ihale` : '');
    }
    if (!$('app').classList.contains('hidden')) {
      renderList();
      renderMy();
    }
  });
}

async function loadService() {
  hideAll();
  $('loginPanel').classList.remove('hidden');
  $('loginBtn').disabled = true;
  $('loginService').innerHTML = '<option value="">— Yükleniyor... —</option>';

  try {
    const pub = await api.getPublicData(STATE.token);
    if (!pub) {
      showError('Bu link geçersiz veya kaldırılmış.');
      return;
    }

    const materials = await api.listMaterials(pub.donemId);

    STATE.donem = { id: pub.donemId, ad: pub.donemAd || '', aySure: Number(pub.aySure) || 0 };
    STATE.service = { id: pub.serviceId, name: String(pub.name || '').trim() };
    STATE.materials = materials;
    STATE.branslar = Array.isArray(pub.branslar) ? pub.branslar : [];
    STATE.selectedServiceId = pub.serviceId;
    applyPublicData(pub);

    const svcLabel = STATE.service.name || 'Servis (ad tanımsız)';

    $('donemInfo').textContent = '📅 ' + (STATE.donem.ad || '-');
    $('donemInfo').classList.remove('hidden');
    $('loginService').innerHTML = `<option value="${esc(STATE.service.id)}">${esc(svcLabel)}</option>`;
    $('loginMsg').textContent = STATE.service.name
      ? ''
      : '⚠️ Bu servisin adı tanımsız. Admin panelinden "✏️" ile ad verebilirsiniz.';

    $('loginBtn').disabled = false;
    $('loginBtn').onclick = () => {
      STATE.selectedServiceId = $('loginService').value || pub.serviceId;
      $('svcName').textContent = svcLabel;
      $('donemAd').textContent = '📅 ' + (STATE.donem.ad || '-') +
        (STATE.donem.aySure ? ` · ${STATE.donem.aySure} aylık ihale` : '');

      $('bransSelect').innerHTML = '<option value="">Tümü</option>' +
        STATE.branslar.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');

      hideAll();
      $('app').classList.remove('hidden');
      activateTab('list');
      renderList();
      renderMy();
    };

    subscribe(STATE.token);
  } catch (e) {
    showError('Bağlantı hatası: ' + (e && e.message ? e.message : e));
  }
}

/* ---------------- Listeler ---------------- */

function renderList() {
  const brans = $('bransSelect').value;
  const filter = ($('matFilter').value || '').toLowerCase();
  const body = $('listBody');
  let html = '', i = 0;

  for (const m of STATE.materials) {
    if (brans && !(m.branslar || []).includes(brans)) continue;
    const searchStr = `${m.tanim || ''} ${m.sutKodu || ''} ${m.tasinirKodu || ''} ${m.smtKodu || ''}`.toLowerCase();
    if (filter && !searchStr.includes(filter)) continue;

    i++;
    const mevcut = STATE.requests[m.key] ? STATE.requests[m.key][STATE.selectedServiceId] : undefined;
    const sartBtn = m.smtKodu
      ? `<button class="btn btn-sm btn-orange" data-sart="${esc(m.smtKodu)}" title="Şartnameyi aç">📄</button>`
      : '<span class="hint">—</span>';

    html += `<tr>
      <td>${i}</td>
      <td title="${esc(m.sutKodu)}">${esc(m.sutKodu)}</td>
      <td title="${esc(m.tasinirKodu)}">${esc(m.tasinirKodu)}</td>
      <td title="${esc(m.tanim)}">${esc(m.tanim)}</td>
      <td>${esc(m.smtKodu)}</td>
      <td title="${esc((m.branslar || []).join(', '))}">${esc((m.branslar || []).join(', '))}</td>
      <td style="text-align:center;">${sartBtn}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm ${mevcut ? 'btn-gray' : 'btn-green'}" data-add="${esc(m.key)}">
          ${mevcut ? '✏️ Güncelle' : '➕ Ekle'}
        </button>
      </td>
    </tr>`;
  }

  body.innerHTML = html || '<tr><td colspan="8" style="text-align:center;">Kayıt yok</td></tr>';
  $('countBadge').textContent = i + ' malzeme';
  if (i > 0) $('countBadge').textContent += ' · ' + Object.keys(STATE.requests).length + ' istek';

  body.querySelectorAll('[data-sart]').forEach(b => {
    b.onclick = () => sartnameIndir(b.dataset.sart);
  });
  body.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = () => openAmountModal(b.dataset.add);
  });
}

function renderMy() {
  const body = $('myBody');
  let html = '', i = 0;
  const rows = [];

  for (const m of STATE.materials) {
    const v = STATE.requests[m.key] ? STATE.requests[m.key][STATE.selectedServiceId] : undefined;
    if (!v) continue;
    const rec = STATE.requestInfo[m.key] ? STATE.requestInfo[m.key][STATE.selectedServiceId] : null;
    rows.push({ ...m, miktar: Number(v), tarih: rec ? rec.tarih : '' });
  }

  rows.forEach(r => {
    i++;
    html += `<tr>
      <td>${i}</td>
      <td title="${esc(r.sutKodu)}">${esc(r.sutKodu)}</td>
      <td title="${esc(r.tasinirKodu)}">${esc(r.tasinirKodu)}</td>
      <td title="${esc(r.tanim)}">${esc(r.tanim)}</td>
      <td style="text-align:right; font-variant-numeric:tabular-nums; font-weight:600;">${fmt(r.miktar)}</td>
      <td style="font-size:11px; white-space:nowrap;">${esc(fmtTs(r.tarih))}</td>
      <td style="text-align:center;" class="no-print"><button class="btn btn-sm btn-red" data-del="${esc(r.key)}" title="Sil">🗑</button></td>
    </tr>`;
  });

  body.innerHTML = html || '<tr><td colspan="7" style="text-align:center; padding:24px;">Henüz istek yok</td></tr>';

  const pill = $('myCount');
  if (pill) pill.textContent = rows.length;

  renderTaahhut(rows.length);

  body.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => istekSil(b.dataset.del);
  });
}

/* ---------------- Taahhüt metni ---------------- */

// İstenen kalem sayısı = miktarı girilmiş malzeme sayısı (farklı malzemeler olduğu için
// miktarların toplanması anlamsızdır).
function taahhutBilgi(kalem) {
  const d = STATE.donem || {};
  const ay = Number(d.aySure) || 0;
  const svc = String((STATE.service && STATE.service.name) || '').trim() || 'Servisimiz';
  const sure = ay ? `${ay} aylık` : 'ihale süresi boyunca';
  const ayTxt = ay ? `${ay} ay` : 'ihale süresi';
  return {
    ay, svc, kalem,
    metin: `Yukarıda listelenen ${kalem} kalem malzeme, ${svc} servisinin ${sure} ihtiyacı için tarafımızdan ` +
      `talep edilmiştir. Söz konusu malzemeleri ${ayTxt} boyunca kullanacağımızı ve miktarların servisimizin ` +
      `gerçek ihtiyacına uygun olduğunu beyan ve taahhüt ederiz.`
  };
}

function renderTaahhut(kalem) {
  const box = $('taahhutBox');
  if (!box) return;
  const n = Number(kalem) || 0;
  if (!n) { box.innerHTML = ''; return; }

  const t = taahhutBilgi(n);
  const ad = (STATE.donem && STATE.donem.ad) || '';
  box.innerHTML = `<div class="taahhut no-print">
    <div class="taahhut-h">📌 Taahhüt</div>
    <div class="taahhut-meta">${esc(ad)}${ad ? ' · ' : ''}${
      t.ay ? esc(t.ay + ' aylık ihale') : '<span style="color:#b45309;">ihale süresi tanımsız</span>'
    }</div>
    <p class="taahhut-txt">${esc(t.metin)}</p>
    <div class="taahhut-sign">
      <div><b>İstekte Bulunan</b><span>Ad Soyad / İmza</span></div>
      <div><b>Servis Sorumlusu</b><span>Ad Soyad / İmza</span></div>
      <div><b>Tarih</b><span>${esc(new Date().toLocaleDateString('tr-TR'))}</span></div>
    </div>
  </div>`;
}

/* ---------------- Miktar girişi ---------------- */

function openAmountModal(key) {
  const m = STATE.materials.find(x => x.key === key);
  if (!m) return;
  const mevcut = (STATE.requests[m.key] && STATE.requests[m.key][STATE.selectedServiceId]) || '';
  const root = $('modalRoot');

  root.innerHTML = `<div class="modal-backdrop">
    <div class="modal">
      <h3>Miktar Gir</h3>
      <div class="mat-info"><div>${esc(m.tanim)}</div></div>
      <label>İstenen Miktar (ADET):</label>
      <input type="number" id="modalAmt" min="1" step="1" value="${mevcut || ''}">
      <div class="actions">
        <button class="btn btn-gray" id="modalCancel">İptal</button>
        <button class="btn btn-green" id="modalSave">✅ Onayla</button>
      </div>
    </div>
  </div>`;

  $('modalCancel').onclick = () => { root.innerHTML = ''; };
  $('modalSave').onclick = () => kaydetModal(key);
  $('modalAmt').addEventListener('keydown', e => {
    if (e.key === 'Enter') kaydetModal(key);
  });
  setTimeout(() => { const el = $('modalAmt'); if (el) el.focus(); }, 50);
}

async function kaydetModal(key) {
  const v = Number($('modalAmt').value);
  if (!v || v <= 0) { toast('Geçerli bir miktar girin'); return; }

  const btn = $('modalSave');
  if (btn) btn.disabled = true;

  try {
    const res = await api.saveRequestByToken(STATE.token, key, v);
    STATE.requests[key] = STATE.requests[key] || {};
    STATE.requests[key][STATE.selectedServiceId] = v;
    STATE.requestInfo[key] = STATE.requestInfo[key] || {};
    STATE.requestInfo[key][STATE.selectedServiceId] = {
      miktar: v, tarih: (res && res.tarih) || new Date().toISOString()
    };
    $('modalRoot').innerHTML = '';
    toast('İstek kaydedildi');
    renderList();
    renderMy();
  } catch (e) {
    if (btn) btn.disabled = false;
    toast('Kaydedilemedi: ' + (e && e.message ? e.message : e));
  }
}

async function istekSil(key) {
  if (!confirm('Bu istek silinsin mi?')) return;
  try {
    await api.deleteRequestByToken(STATE.token, key);
    if (STATE.requests[key]) delete STATE.requests[key][STATE.selectedServiceId];
    if (STATE.requestInfo[key]) delete STATE.requestInfo[key][STATE.selectedServiceId];
    toast('Silindi');
    renderList();
    renderMy();
  } catch (e) {
    toast('Silinemedi: ' + (e && e.message ? e.message : e));
  }
}

/* ---------------- Şartname ---------------- */

// Word önizleyici (mammoth.js) yalnızca ilk kullanımda CDN'den yüklenir
let mammothPromise = null;

function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
      s.onload = () => (window.mammoth ? resolve(window.mammoth) : reject(new Error('kütüphane yüklenemedi')));
      s.onerror = () => reject(new Error('Önizleme kütüphanesi yüklenemedi'));
      document.head.appendChild(s);
    });
  }
  return mammothPromise;
}

function sartTuru(meta) {
  const name = String((meta && meta.fileName) || '').toLowerCase();
  const type = String((meta && meta.contentType) || '').toLowerCase();
  if (type === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf';
  if (type.indexOf('wordprocessingml') !== -1 || /\.docx$/.test(name)) return 'docx';
  if (type === 'application/msword' || /\.doc$/.test(name)) return 'doc';
  if (type.indexOf('image/') === 0 || /\.(png|jpe?g|gif|webp)$/.test(name)) return 'resim';
  return 'diger';
}

async function sartnameIndir(smtKodu) {
  if (!smtKodu) return;

  let res = null;
  try { res = await api.readSartname(smtKodu); } catch (e) { res = null; }
  if (!res) { alert('Şartname bulunamadı: ' + smtKodu); return; }

  const tur = sartTuru(res.meta);

  if (tur === 'pdf' || tur === 'resim') {
    window.open(res.url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(res.url), 120000);
    return;
  }

  if (tur === 'docx') { docxOnizle(smtKodu, res); return; }

  downloadObjectUrl(res.url, res.meta.fileName || (smtKodu + '.doc'));
  toast('Dosya indirildi');
}

function docxOnizle(smtKodu, res) {
  const root = $('modalRoot');
  const dosyaAdi = res.meta.fileName || (smtKodu + '.docx');

  root.innerHTML = `<div class="modal-backdrop">
    <div class="modal modal-doc">
      <div class="doc-head">
        <div class="doc-title"><b>${esc(smtKodu)}</b><span class="hint"> · ${esc(dosyaAdi)}</span></div>
        <div class="doc-acts">
          <button class="btn btn-sm btn-gray" id="docDownload">⬇ İndir</button>
          <button class="btn btn-sm" id="docClose">Kapat</button>
        </div>
      </div>
      <div class="doc-body" id="docBody"><div class="hint">Word belgesi hazırlanıyor…</div></div>
    </div>
  </div>`;

  const kapat = () => { root.innerHTML = ''; };
  $('docClose').onclick = () => { kapat(); setTimeout(() => URL.revokeObjectURL(res.url), 1500); };
  $('docDownload').onclick = () => downloadObjectUrl(res.url, dosyaAdi);

  const body = $('docBody');
  loadMammoth()
    .then(mammoth => res.blob.arrayBuffer().then(ab => mammoth.convertToHtml({ arrayBuffer: ab })))
    .then(out => {
      const html = (out && out.value ? out.value : '').trim();
      body.innerHTML = html || '<div class="hint">Belge boş görünüyor.</div>';
    })
    .catch(() => {
      body.innerHTML = '<div class="hint">Word belgesi tarayıcıda görüntülenemedi. ' +
        'Yukarıdaki <b>⬇ İndir</b> düğmesiyle bilgisayarınıza indirebilirsiniz.</div>';
    });
}

/* ---------------- Yazdırma ---------------- */

$('printBtn').onclick = () => {
  const sigN = Math.max(0, Math.min(10, parseInt($('sigCount').value, 10) || 0));
  const rows = [];

  for (const m of STATE.materials) {
    const v = STATE.requests[m.key] ? STATE.requests[m.key][STATE.selectedServiceId] : undefined;
    if (!v) continue;
    rows.push({ ...m, miktar: Number(v) });
  }
  if (!rows.length) return toast('İstek yok');
  rows.sort((a, b) => (a.tanim || '').localeCompare(b.tanim || '', 'tr'));

  const labels = ['SERVİS SORUMLUSU', 'DOKTOR'];
  let sigs = '';
  for (let i = 0; i < sigN; i++) {
    sigs += `<div class="signature-box"><span class="lbl">${esc(labels[i] || ('İMZA ' + (i + 1)))}</span><div class="sub">İmza / Kaşe</div></div>`;
  }

  const rowsHtml = rows.map((r, i) => `<tr>
    <td style="text-align:center;">${i + 1}</td><td>${esc(r.sutKodu)}</td><td>${esc(r.tasinirKodu)}</td><td>${esc(r.tanim)}</td>
    <td style="text-align:center;">ADET</td><td style="text-align:right;">${fmt(r.miktar)}</td>
  </tr>`);

  const printSvcName = String((STATE.service && STATE.service.name) || '').trim() || 'Servis';
  const t = taahhutBilgi(rows.length);
  const donemAd = (STATE.donem && STATE.donem.ad) || '';
  const kalemSatiri = `Toplam ${rows.length} kalem malzeme` + (t.ay ? ` · ${t.ay} aylık ihtiyaç` : '') +
    (donemAd ? ` · ${donemAd}` : '');

  // Toplam satırı tablonun son satırı olarak verilir; böylece yalnızca bir kez,
  // tablonun bittiği sayfada görünür.
  rowsHtml.push(`<tr class="sum-row"><td colspan="6" style="text-align:center;">${esc(kalemSatiri)}</td></tr>`);

  const sonuc = sayfaliYazdir({
    baslik: `${printSvcName} — Talep Listesi`,
    header: `<div class="print-header">
      <h3>T.C. SAĞLIK BAKANLIĞI — YOZGAT ŞEHİR HASTANESİ</h3>
      <p><b>${esc(printSvcName)}</b> — A Grubu Tıbbi Sarf Malzeme İsteği</p>
      <p>${esc(donemAd)}${t.ay ? ` · ${esc(t.ay + ' aylık ihale')}` : ''} · Tarih: ${new Date().toLocaleDateString('tr-TR')}</p>
      <div class="hr"></div>
    </div>`,
    tableHead: '<tr><th>#</th><th>SutKodu</th><th>Taşınır Kodu</th><th>Malzeme Tanımı</th><th>Birim</th><th>Miktar</th></tr>',
    rows: rowsHtml,
    // Taahhüt metni ve imza kutuları tek parçadır: biri sayfaya sığmıyorsa
    // ikisi birlikte sonraki sayfaya geçer (neye taahhüt verildiği görünsün).
    blocks: [
      { grup: 'imza', html: `<div class="taahhut-print">
        <div class="taahhut-print-h">TAAHHÜT</div>
        <p>${esc(t.metin)}</p>
      </div>` },
      sigN ? { grup: 'imza', html: `<div class="sig-container">${sigs}</div>` } : null
    ].filter(Boolean),
    altBilgi: `${esc(printSvcName)} · ${esc(donemAd)} · ${rows.length} kalem`,
    css: `
      body { font-size: 12px; }
      table.pd { font-size: 12px; }
      table.pd th, table.pd td { border: 1px solid #333; padding: 4px 6px; text-align: left; vertical-align: top; }
      table.pd th { background: #1e40af; color: #fff; }
      table.pd .sum-row td { background: #fef3c7; font-weight: 700; }
      .signature-box { border: 1.5px solid #334155; border-radius: 6px; height: 110px;
        flex: 1; min-width: 180px; padding: 8px; position: relative; background: #fff; }
      .signature-box .lbl { position: absolute; top: 4px; left: 8px; font-size: 10px; font-weight: 700; color: #475569; }
      .signature-box .sub { position: absolute; bottom: 6px; left: 8px; right: 8px; font-size: 10px;
        color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 3px; }
      .sig-container { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 10px;
        break-inside: avoid; page-break-inside: avoid; }
      .print-header { text-align: center; padding-bottom: 5px; }
      .print-header h3 { margin: 0; font-size: 15px; }
      .print-header p { margin: 2px 0; font-size: 12px; }
      .hr { border-top: 2px solid #0f172a; margin-top: 4px; }
      .taahhut-print { padding: 9px 11px; border: 1.2px solid #94a3b8; border-radius: 6px;
        background: #f8fafc; margin-bottom: 2px; }
      .taahhut-print-h { font-size: 10px; font-weight: 700; letter-spacing: .6px; color: #475569; margin-bottom: 3px; }
      .taahhut-print p { margin: 0; font-size: 11.5px; line-height: 1.55; text-align: justify; }
    `
  });

  if (sonuc === 'blocked') toast('Yazdırma penceresi engellendi');
};

/* ---------------- Olaylar ---------------- */

$('bransSelect').addEventListener('change', renderList);
$('matFilter').addEventListener('input', renderList);

$('changeSvcBtn').onclick = () => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  try { history.replaceState(null, '', '/service.html'); } catch (e) { /* yoksay */ }
  STATE.token = '';
  showTokenPanel();
};

$('manualTokenBtn').onclick = () => {
  const t = extractToken($('manualToken').value);
  if (!t) { $('manualTokenMsg').textContent = 'Geçerli bir link veya kod girin.'; return; }
  $('manualToken').value = '';
  $('manualTokenMsg').textContent = '';
  STATE.token = t;
  try { history.replaceState(null, '', '/service.html?token=' + encodeURIComponent(t)); } catch (e) { /* yoksay */ }
  loadService();
};

$('manualToken').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('manualTokenBtn').click();
});

$('errorRetryBtn').onclick = () => {
  STATE.token = '';
  try { history.replaceState(null, '', '/service.html'); } catch (e) { /* yoksay */ }
  showTokenPanel();
};

/* ---------------- Başlangıç ---------------- */

function boot() {
  if (!configured) { showSetup(); return; }

  const token = cleanToken(tokenFromLocation());
  STATE.token = token;
  if (!token) { showTokenPanel(); return; }
  loadService();
}

boot();
