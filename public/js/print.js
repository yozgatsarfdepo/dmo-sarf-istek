// Sayfalı yazdırma yardımcısı.
//
// Chrome, @page kenar kutularını (counter(page) / counter(pages)) desteklemediği için
// gerçek "2 / 10" sayfa numarası CSS ile üretilemez. Bu yüzden içerik A4 ölçülerine
// göre önce ölçülür, sonra elle sayfalara bölünür. Böylece:
//   - üst başlık her sayfada yinelenir,
//   - sayfa numarası n / N biçiminde yazılır,
//   - taahhüt metni ve imza kutuları sayfa arasında bölünmez.

import { esc } from './util.js';

const MM_PX = 96 / 25.4; // 1 mm = 3.7795 CSS px
const EMNIYET = 6;       // sayfa taşmasına karşı px boşluk
const EMNIYET_MM = 9;    // tarayıcı/yazıcı yuvarlamalarına karşı mm boşluk

export function mmToPx(v) {
  return v * MM_PX;
}

// Yükseklikleri sırayı bozmadan kapasiteye göre sayfalara dağıtır.
// Sayfada hiç öğe yokken kapasite aşılsa bile öğe yine de o sayfaya konur
// (tek başına sayfaya sığmayan öğe sonsuz döngü yaratmasın).
//
// gruplar: her öğe için grup kimliği (veya null). Aynı kimliği taşıyan ardışık
// öğeler tek parça sayılır; böylece taahhüt metni ile imza kutuları birbirinden
// ayrılmaz. Grup tek başına bir sayfaya sığmıyorsa öğelerine ayrılır.
// Dönen değer: sayfalar → [{ bas, son, y }] (bas..son arası öğe indeksleri).
export function dagit(yukseklikler, kapasite, gruplar) {
  const parcalar = [];
  yukseklikler.forEach((h, i) => {
    const g = gruplar ? gruplar[i] : null;
    const onceki = parcalar[parcalar.length - 1];
    if (g !== null && g !== undefined && onceki && onceki.grup === g && onceki.son === i) {
      onceki.y += h;
      onceki.son = i + 1;
    } else {
      parcalar.push({ y: h, bas: i, son: i + 1, grup: g === undefined ? null : g });
    }
  });

  const ogeler = [];
  for (const p of parcalar) {
    if (p.grup !== null && p.y > kapasite) {
      // Grup tek başına sayfaya sığmıyor: parçalanır. İlk iki öğe (taahhüt metni +
      // ilk imza satırı) yine birlikte tutulur ki metin imzasız kalmasın.
      let i = p.bas;
      if (p.son - p.bas >= 2) {
        ogeler.push({ y: yukseklikler[p.bas] + yukseklikler[p.bas + 1], bas: p.bas, son: p.bas + 2 });
        i = p.bas + 2;
      }
      for (; i < p.son; i++) ogeler.push({ y: yukseklikler[i], bas: i, son: i + 1 });
    } else {
      ogeler.push(p);
    }
  }

  const sayfalar = [];
  let mevcut = [];
  let kalan = kapasite;

  for (const oge of ogeler) {
    if (mevcut.length && oge.y > kalan) {
      sayfalar.push(mevcut);
      mevcut = [];
      kalan = kapasite;
    }
    mevcut.push(oge);
    kalan -= oge.y;
  }
  sayfalar.push(mevcut);
  return sayfalar;
}

/**
 * İçeriği ölçüp sayfalara bölerek yazdırma penceresi açar.
 *
 * @param {object} o
 * @param {string} [o.baslik]     pencere başlığı
 * @param {string} [o.css]        ek CSS (tablo, imza vb.)
 * @param {string} [o.header]     her sayfada yinelenen üst başlık HTML'i
 * @param {string} [o.tableHead]  <thead> içine konacak <tr> HTML'i (yinelenir)
 * @param {string[]} [o.rows]     tablo gövdesi <tr> HTML'leri (sırayla)
 * @param {string[]} [o.blocks]   tablodan sonra gelen, bölünmeyen bloklar.
 *                                Öğe `{ html, grup }` ise aynı `grup` değerini taşıyan
 *                                bloklar birbirinden ayrılmaz (taahhüt + imza).
 * @param {string} [o.altBilgi]   sol alt bilgi metni
 * @param {string} [o.yon]        'yatay' (varsayılan) | 'dikey'
 * @param {object} [o.margin]     mm cinsinden {top,right,bottom,left}
 * @returns {'ok'|'blocked'}
 */
export function sayfaliYazdir(o = {}) {
  const w = window.open('', '_blank');
  if (!w) return 'blocked';

  const yatay = o.yon !== 'dikey';
  const W = o.widthMM || (yatay ? 297 : 210);
  const H = o.heightMM || (yatay ? 210 : 297);
  const mg = Object.assign({ top: 5, right: 7, bottom: 7, left: 7 }, o.margin || {});

  const icGen = mmToPx(W - mg.left - mg.right);
  // Her sayfa kutusu, yazdırılabilir alandan EMNIYET_MM kadar kısa tutulur; böylece
  // tarayıcı/yazıcı yuvarlaması yüzünden bir kutu iki sayfaya bölünmez.
  const icYuk = mmToPx(H - mg.top - mg.bottom) - mmToPx(EMNIYET_MM);
  const altBilgi = o.altBilgi || '';
  const baslik = o.baslik || 'Yazdır';

  const temelCss = `
    @page { size: ${W}mm ${H}mm; margin: ${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #0f172a;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .py { position: relative; page-break-after: always; break-after: page; overflow: hidden; }
    .py:last-child { page-break-after: auto; break-after: auto; }
    .pfoot { position: absolute; left: 0; right: 0; bottom: 0; display: flex;
             justify-content: space-between; gap: 10px; font-size: 8.5px; color: #475569;
             border-top: .5px solid #cbd5e1; padding-top: 2px; }
    .pfoot .no { font-weight: 700; white-space: nowrap; }
    .pblok { display: flow-root; break-inside: avoid; page-break-inside: avoid; }
    table.pd { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
  `;

  // ---- 1) Ölçüm belgesi -------------------------------------------------
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(baslik)}</title>
    <style>${temelCss}${o.css || ''}</style></head><body>
    <div id="__olc" style="width:${icGen}px;height:${icYuk}px;position:relative;">
      <div id="__hdr">${o.header || ''}</div>
      ${o.tableHead ? `<table class="pd" id="__tbl"><thead>${o.tableHead}</thead><tbody id="__tb"></tbody></table>` : ''}
      <div id="__blk"></div>
      <div class="pfoot" id="__alt"><span>${altBilgi}</span><span class="no">1 / 1</span></div>
    </div></body></html>`);
  w.document.close();

  const d = w.document;
  const yuk = el => {
    if (!el) return 0;
    const cs = w.getComputedStyle(el);
    return el.getBoundingClientRect().height +
      (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  };

  const hdr = d.getElementById('__hdr');
  const alt = d.getElementById('__alt');
  const tbl = d.getElementById('__tbl');
  const tb = d.getElementById('__tb');
  const blk = d.getElementById('__blk');

  // Bloklar string ya da { html, grup } olabilir; aynı grup değerini taşıyan
  // bloklar (taahhüt metni + imza kutuları) tek parça olarak taşınır.
  const bloklar = (o.blocks || []).map(b =>
    (b && typeof b === 'object') ? { html: b.html || '', grup: b.grup || null } : { html: String(b), grup: null });

  // Satır ve blokları tek seferde yerleştirip sonra ölçüyoruz; böylece sütun
  // genişlikleri her satır eklendiğinde yeniden hesaplanmaz.
  if (tb) tb.innerHTML = (o.rows || []).join('');
  if (blk) blk.innerHTML = bloklar.map(b => `<div class="pblok">${b.html}</div>`).join('');

  const satirHtml = tb ? Array.from(tb.rows).map(r => r.outerHTML) : [];
  const satirY = tb ? Array.from(tb.rows).map(r => r.getBoundingClientRect().height) : [];
  const blokHtml = blk ? Array.from(blk.children).map(el => el.outerHTML) : [];
  const blokY = blk ? Array.from(blk.children).map(el => yuk(el)) : [];

  // Sütun genişlikleri: sayfalar bölündüğünde hizalar kaymasın diye sabitlenir.
  let colgroup = '';
  if (tbl && tbl.tHead && tbl.tHead.rows[0]) {
    const genis = Array.from(tbl.tHead.rows[0].cells).map(c => c.getBoundingClientRect().width);
    const toplam = genis.reduce((a, b) => a + b, 0) || 1;
    colgroup = '<colgroup>' + genis
      .map(g => `<col style="width:${(g / toplam * 100).toFixed(3)}%">`).join('') + '</colgroup>';
  }

  const hdrY = yuk(hdr);
  const altY = yuk(alt) + 4;
  const theadY = tbl ? yuk(tbl.tHead) : 0;
  const kapasite = Math.max(40, icYuk - altY - hdrY - theadY - EMNIYET);

  const ogeler = satirHtml.map(h => ({ html: h, blok: false }))
    .concat(blokHtml.map(h => ({ html: h, blok: true })));
  const gruplar = satirHtml.map(() => null).concat(bloklar.map(b => b.grup));
  const sayfalar = dagit(satirY.concat(blokY), kapasite, gruplar);

  // ---- 2) Sayfalanmış belge --------------------------------------------
  const N = sayfalar.length;
  const govde = sayfalar.map((sayfa, i) => {
    const satirlar = [];
    const bloklar = [];
    for (const parca of sayfa) {
      for (let j = parca.bas; j < parca.son; j++) {
        const it = ogeler[j];
        if (!it) continue;
        (it.blok ? bloklar : satirlar).push(it.html);
      }
    }
    const tablo = o.tableHead && satirlar.length
      ? `<table class="pd" style="table-layout:fixed;">${colgroup}<thead>${o.tableHead}</thead>` +
        `<tbody>${satirlar.join('')}</tbody></table>`
      : '';
    return `<div class="py" style="height:${icYuk}px;">
      ${o.header || ''}
      ${tablo}
      ${bloklar.join('')}
      <div class="pfoot"><span>${altBilgi}</span><span class="no">${i + 1} / ${N}</span></div>
    </div>`;
  }).join('');

  d.body.innerHTML = govde;
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* yoksay */ } }, 350);
  return 'ok';
}
