// ============================================================
// ESKİ APPS SCRIPT LİNKLERİNİ YENİ PORTALA YÖNLENDİRME
// ============================================================
//
// Amaç: servislere daha önce gönderilmiş
//   https://script.google.com/macros/s/AKfy.../exec?token=XXXX
// biçimindeki linkler çalışmaya devam etsin.
//
// KURULUM
// 1) Apps Script projesini açın (eski Google Sheets sürümü).
// 2) Bu dosyayı "Yonlendirme.gs" adıyla ekleyin, PORTAL_ORIGIN'i kendi
//    site adresinizle değiştirin (Cloudflare Pages).
// 3) Aynı projede eski code.gs dosyasındaki doGet fonksiyonunu silin
//    (aynı isimde iki fonksiyon olamaz) veya içeriğini bu dosyadakiyle değiştirin.
// 4) Dağıt → Dağıtımları yönet → mevcut dağıtımı düzenle →
//    Sürüm: "Yeni sürüm" → Dağıt.
//    (Adresin DEĞİŞMEMESİ için yeni dağıtım değil, mevcut dağıtımı güncelleyin.)
//
// NOT: Bu dosya veri okumaz/yazmaz. Google Sheets artık kullanılmaz;
//      tüm veriler Firebase'de tutulur.

var PORTAL_ORIGIN = 'https://dmo-sarf-istek.pages.dev';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var token = String(p.token || p.s || '').trim();

  var taban = String(PORTAL_ORIGIN).replace(/\/+$/, '');

  if (!token) {
    return _sayfa(
      'Bağlantı eksik',
      'Bu adres bir servis kodu içermiyor. Size gönderilen linki kullanın ' +
      'veya yöneticiden güncel linki isteyin.',
      taban
    );
  }

  var hedef = taban + '/service?token=' + encodeURIComponent(token);
  return _sayfa('Yönlendiriliyor…', 'Servis portalına yönlendiriliyorsunuz.', hedef);
}

// Basit, mobil uyumlu yönlendirme sayfası (meta refresh + JS + elle link)
function _sayfa(baslik, mesaj, hedef) {
  var html = '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + baslik + '</title>' +
    (hedef ? '<meta http-equiv="refresh" content="0; url=' + hedef + '">' : '') +
    '<style>' +
    'body{font-family:-apple-system,"Segoe UI",Tahoma,sans-serif;background:#eef2f7;color:#0f172a;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}' +
    '.k{background:#fff;border-radius:14px;padding:26px 22px;max-width:460px;width:100%;' +
    'box-shadow:0 10px 30px -16px rgba(15,23,42,.45);text-align:center}' +
    'h1{font-size:16px;margin:0 0 8px}p{font-size:13px;color:#475569;margin:0 0 14px;line-height:1.5}' +
    'a{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;' +
    'padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600}' +
    '</style></head><body><div class="k">' +
    '<h1>' + baslik + '</h1><p>' + mesaj + '</p>' +
    (hedef ? '<a href="' + hedef + '">Devam et</a>' : '') +
    '</div>' +
    (hedef ? '<script>window.location.replace(' + JSON.stringify(hedef) + ');</script>' : '') +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
