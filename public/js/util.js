// Küçük yardımcı fonksiyonlar (Firebase bağımlılığı yok)

export const $ = id => document.getElementById(id);

export function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

export function esc(s) {
  return (s === undefined || s === null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmt(n) {
  return (n === undefined || n === null || isNaN(n)) ? '' : Number(n).toLocaleString('tr-TR');
}

export function fmtTs(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export function nowIso() {
  return new Date().toISOString();
}

// Servis linki kodu: sadece a-z / 0-9 / - / _ ve en az 6 karakter
export function cleanToken(v) {
  const s = String(v === undefined || v === null ? '' : v)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9_-]{6,}$/.test(s) ? s : '';
}

// Kullanıcı tam link de yapıştırabilir, sadece kod da
export function extractToken(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  const m = s.match(/[?&#](?:token|s)=([A-Za-z0-9_-]+)/i) || s.match(/\/s\/([A-Za-z0-9_-]{6,})/);
  if (m) return cleanToken(m[1]);
  if (/^(?:https?:\/\/)/i.test(s)) return '';
  return cleanToken(s);
}

export function tokenFromLocation() {
  // 1) /s/<token> biçimindeki adres (sunucu yönlendirmesi)
  try {
    const m = String(location.pathname || '').match(/\/s\/([A-Za-z0-9_-]{6,})\/?$/);
    if (m) return cleanToken(m[1]);
  } catch (e) { /* yoksay */ }

  // 2) ?token=... veya ?s=...
  try {
    const q = new URLSearchParams(location.search || '');
    const t = cleanToken(q.get('token')) || cleanToken(q.get('s'));
    if (t) return t;
  } catch (e) { /* yoksay */ }

  // 3) #token=...
  try {
    const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    return cleanToken(h.get('token')) || cleanToken(h.get('s'));
  } catch (e) { /* yoksay */ }

  return '';
}

export function randomToken(len = 24) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newId() {
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// Şartname dosya adından SMT kodunu bulur: "SMT123-Şartname.pdf" -> "SMT123"
// Karşılaştırma Türkçe'ye duyarlı biçimde büyük/küçük harf gözetmez.
export function matchSartCode(fileName, codes) {
  const n = trLower(String(fileName || ''));
  const sorted = (codes || []).slice().sort((a, b) => String(b).length - String(a).length);

  for (const c of sorted) {
    const code = String(c || '').trim();
    if (!code) continue;
    const lc = trLower(code);
    if (n === lc) return code;
    if (n.startsWith(lc + '-') || n.startsWith(lc + '_') ||
        n.startsWith(lc + ' ') || n.startsWith(lc + '.')) return code;
  }

  // Dosya adı bir alt klasör yolu içeriyorsa yalnızca dosya adını da dene
  const base = trLower(String(fileName || '').replace(/^.*[\\/]/, ''));
  if (base !== n) {
    for (const c of sorted) {
      const code = String(c || '').trim();
      if (!code) continue;
      const lc = trLower(code);
      if (base === lc || base.startsWith(lc + '-') || base.startsWith(lc + '_') ||
          base.startsWith(lc + ' ') || base.startsWith(lc + '.')) return code;
    }
  }

  return '';
}

// Dosya adından kod tahmini (Excel'de olmayan / farklı yazılmış kodlar için).
// "Steril Eldiven.docx" -> '' (rakam yok), "SMT001-A.docx" -> "SMT001"
export function guessSartCode(fileName) {
  let base = String(fileName || '').replace(/^.*[\\/]/, '');
  base = base.replace(/\.[^.]+$/, '').trim();
  if (!base) return '';

  // "SMT-001 Sartname" -> "SMT-001"
  const birlesik = base.match(/^([A-Za-zÇĞİÖŞÜçğıöşü]{1,6})[-_ ](\d{1,6})(?![0-9])/);
  if (birlesik) return (birlesik[1] + '-' + birlesik[2]).replace(/\s+/g, '');

  // "SMT001-A" -> "SMT001"  (yalnızca harf içeren adlar; "2026" gibi klasör adları kod değildir)
  const ilk = base.match(/^([A-Za-z0-9]{2,40})(?=[-_ .]|$)/);
  if (ilk) {
    const kod = ilk[1];
    if (/\d/.test(kod) && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(kod)) return kod;
  }
  return '';
}

// Dosyanın klasör yolunu döndürür.
// - <input webkitdirectory> -> file.webkitRelativePath ("SMT1044/derin cerrahi.docx")
// - sürükle-bırak           -> tarayıcı bu alanı vermez; admin.js file.__yol olarak yazar
export function dosyaYolu(file) {
  if (!file) return '';
  const yol = file.webkitRelativePath || file.__yol || file.relativePath || '';
  return String(yol || file.name || '');
}

export function yolParcalari(yol) {
  return String(yol || '').split(/[\\/]/).map(s => s.trim()).filter(Boolean);
}

// Kod bulma sırası:
//   1) Dosya adı dönemdeki bir kodla eşleşiyor mu?
//   2) En yakın üst klasörden yukarı doğru klasör adları eşleşiyor mu?
//      (SMT1044/derin cerrahi.docx  ->  SMT1044)
//   3) Aynı sırayla tahmin (SMT1044 / SMT-1044 / SMT1044-aciklama)
// "Her şartname kendi kod klasöründe" düzeni böylece desteklenir.
export function sartKodunuBul(file, codes) {
  const ad = String((file && file.name) || '');
  const parcalar = yolParcalari(dosyaYolu(file));
  if (!parcalar.length && ad) parcalar.push(ad);

  // Dosya adı en sonda kalır; en yakın klasörden yukarı doğru denenir
  const adaylar = parcalar.slice().reverse();

  for (const a of adaylar) {
    const m = matchSartCode(a, codes);
    if (m) return m;
  }
  for (const a of adaylar) {
    const g = guessSartCode(a);
    if (g) return g;
  }

  // 4) Klasör yalnızca rakamsa ("1044"), dönemde "SMT1044" var mı?
  //    Yalnızca bilinen kodlarla eşleşir; olmayan kod uydurulmaz.
  const kodAnahtar = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const a of adaylar) {
    const sadece = String(a || '').replace(/\.[^.]+$/, '').trim();
    if (!/^\d{3,6}$/.test(sadece)) continue;
    const hedef = 'smt' + sadece;
    const bulunan = (codes || []).find(c => kodAnahtar(c) === hedef);
    if (bulunan) return bulunan;
  }

  return '';
}

function trLower(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[İI]/g, 'i')
    .toLowerCase();
}

// Blob adresini yeni sekmede açamazsak indirme bağlantısı olarak kullan
export function downloadObjectUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'dosya';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
