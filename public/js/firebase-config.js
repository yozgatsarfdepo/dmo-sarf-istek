// ============================================================
// FIREBASE AYARLARI
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCQH8ak0UCJI0HZuVlD_NTVZbK-xbveeX0",
  authDomain: "dmo-sarf-ist.firebaseapp.com",
  projectId: "dmo-sarf-ist",
  storageBucket: "dmo-sarf-ist.firebasestorage.app",
  messagingSenderId: "495327514102",
  appId: "1:495327514102:web:9c424ae7b8ccc018ce4bd7"
};

// Ayar yapılmış mı? (apiKey ve projectId boşsa uygulama kurulum ekranı gösterir)
export function isFirebaseConfigured() {
  const c = firebaseConfig;
  return !!(String(c.apiKey || '').trim() && String(c.projectId || '').trim());
}

// Yönetici panelinde gösterilecek başlık (isteğe bağlı)
export const APP_TITLE = 'A Grubu Tıbbi Sarf Malzeme İstek Sistemi';

// Servis portalı linklerinin adresi.
// Netlify'da yayınlanan site:  https://dmo-sarf-istek.netlify.app
// Böylece admin paneli localhost'tan veya bir önizleme (deploy preview) adresinden
// açılsa bile üretilen servis linkleri her zaman gerçek siteyi gösterir.
// Boş bırakılırsa: <sayfanın açıldığı adres>/s/<token>
export const PORTAL_BASE_URL = 'https://dmo-sarf-istek.netlify.app';