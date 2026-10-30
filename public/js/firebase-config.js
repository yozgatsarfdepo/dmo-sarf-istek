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
// Cloudflare Pages'te yayınlanan site:  https://dmo-sarf-istek.pages.dev
// (Eski Netlify adresi: https://dmo-sarf-istek.netlify.app)
//
// Cloudflare Pages ".html" hedefli yeniden yazımları 308'e çevirip token'ı düşürdüğü
// için varsayılan olarak sorgu biçimi kullanılır; bu adres her sunucuda çalışır.
//   https://dmo-sarf-istek.pages.dev/service?token=<token>
//
// Daha kısa "/s/<token>" biçimini istiyorsanız functions/s/[[token]].js fonksiyonunu
// dağıtıp burayı şöyle değiştirin: 'https://dmo-sarf-istek.pages.dev/s/{token}'
//
// Boş bırakılırsa: <sayfanın açıldığı adres>/s/<token>
export const PORTAL_BASE_URL = '';
