# A Grubu Tıbbi Sarf Malzeme İstek Sistemi — Firebase + Cloudflare Pages

Google Apps Script + Google Sheets sürümünün (yavaş kalan) yerine geçen, **Firebase (Firestore + Auth)** üzerinde çalışan ve **Cloudflare Pages**'te statik olarak yayınlanan sürüm
(yayın adresi: **https://dmo-sarf-istek.pages.dev**).

- Sayfalar anında açılır (statik HTML/CSS/JS, CDN üzerinden dağıtım).
- Veriler Firestore'da tutulur; Google Sheets'in satır satır okuma yavaşlığı yoktur.
- Servis portalı **gerçek zamanlı** çalışır: yönetici bir miktarı değiştirdiğinde portal kendini günceller.
- Yönetici girişi Firebase Authentication (e-posta/şifre) ile korunur.
- Şartname PDF'leri **Firestore**'da parçalı olarak saklanır (ücretli Blaze planı / Storage gerekmez).
- Sol menü gizlenebilir; gizlenince malzeme adı sütunu genişler.

---

## 1. Dosya yapısı

```
public/                     → Cloudflare Pages'in yayınlayacağı klasör
  index.html                → Admin paneli
  service.html              → Servis portalı
  _redirects                → kısa yollar (/admin, /servis)
  _headers                  → güvenlik + önbellek başlıkları
  css/admin.css
  css/service.css
  js/firebase-config.js     → ⚠️ Firebase ayarlarınızı + PORTAL_BASE_URL'i buraya yazacaksınız
  js/fb.js                  → SDK başlatma
  js/data.js                → Firestore veri katmanı (şartnameler dahil)
  js/util.js                → yardımcılar
  js/print.js               → sayfalı yazdırma (yinelenen başlık + n/N sayfa numarası)
  js/admin.js               → Admin paneli mantığı
  js/service.js             → Servis portalı mantığı
functions/s/[[token]].js    → /s/<token> kısa linkini service.html'e yönlendirir (URL değişmez)
firestore.rules             → ⚠️ Yönetici e-postanızı buraya yazacaksınız
firebase.json / .firebaserc → Kural dağıtımı için
netlify.toml                → (eski) Netlify yapılandırması, arşiv
legacy-apps-script/         → Eski Google Apps Script sürümü (arşiv)
  Yonlendirme.gs            → Eski ?token= linklerini portala yönlendirir
```

---

## 2. Firebase kurulumu (tek seferlik)

1. <https://console.firebase.google.com> → **Proje ekle**.
2. Proje içinde **Web uygulaması ekle** (`</>` simgesi) → uygulama adı verin.
3. Ekranda görünen `firebaseConfig` nesnesini kopyalayıp
   [`public/js/firebase-config.js`](public/js/firebase-config.js) içine yapıştırın.
4. **Authentication → Başlarken → Sign-in method → E-posta/Şifre**'yi etkinleştirin.
5. **Authentication → Kullanıcılar → Kullanıcı ekle** ile yönetici hesabını oluşturun
   (ör. `admin@kurum.com` + güçlü bir şifre).
6. **Firestore Database → Veritabanı oluştur** (Production mode).
8. Kural dosyalarındaki e-posta listesini kendi yönetici adresinizle değiştirin:

   - [`firestore.rules`](firestore.rules) → `'admin@ornek.com'` satırı

9. Kuralları dağıtın. `.firebaserc` içinde proje kimliği hazır (**dmo-sarf-ist**):

   ```powershell
   npm i -g firebase-tools
   firebase login
   npm run deploy:rules    # firestore.rules + indexes (storage hedefi kaldırıldı)
   ```

   > ⚠️ **ÖNEMLİ:** `firestore.rules` içindeki `'admin@ornek.com'` satırını **kendi yönetici
   > e-posta adresinizle değiştirmeden** deploy etmeyin — aksi hâlde kendi hesabınız kilitlenir.
   > Mevcut kurallarınız çalışıyorsa e-posta listeniz zaten doğrudur; o durumda yalnızca
   > `sartnameler` bloğunu eklemeniz yeterlidir.

   **Kuralları CLI olmadan eklemek (en hızlı yol):**
   <https://console.firebase.google.com/project/dmo-sarf-ist/firestore/rules> adresini açın,
   mevcut kural metninin **en altına** (son kapanış parantezinden önce) şu bloğu ekleyip
   **Yayınla**'ya basın:

   ```
   match /sartnameler/{smtKodu} {
     allow get: if true;
     allow list: if isAdmin();
     allow write: if isAdmin();

     match /parcalar/{parca} {
       allow read: if true;
       allow write: if isAdmin();
     }
   }
   ```

   > Panel bunu sizin yerinize de yapar: şartname bölümünde yetki hatası görürseniz
   > **📋 Kural metnini kopyala** düğmesine basın, konsolda yapıştırıp Yayınla deyin.

    `cors.json`:
    ```json
    [{ "origin": ["*"], "method": ["GET", "HEAD", "PUT", "POST"], "maxAgeSeconds": 3600 }]
    ```

---

## 3. Cloudflare Pages'e yayınlama

Site **https://dmo-sarf-istek.pages.dev** adresinde yayınlanır (statik site, build adımı yok).
`public/` klasörü doğrudan yayınlanır; `functions/` klasörü varsa `/s/<token>` kısa linkleri için
otomatik olarak dahil edilir.

### A) Git üzerinden (önerilen)

1. Bu klasörü bir Git deposuna gönderin (GitHub/GitLab).
2. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → depoyu seçin.
3. Ayarlar:
   - **Framework preset:** None
   - **Build command:** (boş bırakın)
   - **Build output directory:** `public`
4. **Save and Deploy**.

### B) Komut satırından (hızlı)

```powershell
npx --yes wrangler login
npm run deploy:cf        # wrangler pages deploy public --project-name dmo-sarf-istek
```

Yayın adresi: **https://dmo-sarf-istek.pages.dev**

> **Servis linkleri her zaman yayın adresini gösterir.** Adres
> `public/js/firebase-config.js` içindeki **`PORTAL_BASE_URL`** değerinde sabitlidir
> (`https://dmo-sarf-istek.pages.dev/service?token={token}`). Bu sayede admin paneli
> `localhost`'tan veya bir önizleme adresinden açılsa bile üretilen/kopyalanan linkler
> canlı siteyi gösterir.

### 3.1 Servis linkleri (`PORTAL_BASE_URL`)

Servis linklerinin adresi `public/js/firebase-config.js` içindeki **`PORTAL_BASE_URL`**
değerinde sabitlidir:

```js
export const PORTAL_BASE_URL = 'https://dmo-sarf-istek.pages.dev/service?token={token}';
```

Üretilen link:

```
https://dmo-sarf-istek.pages.dev/service?token=<token>
```

> **Neden `?token=`?** Cloudflare Pages, `/s/<token>` gibi yolları `.html` hedefine yeniden
> yazarken 308 yönlendirmesi üretip token'ı düşürebiliyor. Sorgu biçimi her sunucuda
> (Cloudflare, Netlify, yerel önizleme) sorunsuz çalışır.

Kısa `/s/<token>` biçimini de kullanabilirsiniz; bunun için [functions/s/[[token]].js](functions/s/[[token]].js)
fonksiyonu dağıtılmalı (`npm run deploy:cf` bunu dahil eder) ve `PORTAL_BASE_URL` şöyle olmalıdır:

```js
export const PORTAL_BASE_URL = 'https://dmo-sarf-istek.pages.dev/s/{token}';
```

Fonksiyon, URL'yi değiştirmeden `service.html` içeriğini döndürür; `service.js` kodu
`/s/<token>` yolundan okur. `_redirects` bu yolu **tanımlamaz** (aksine 308'e dönüşür).

Site adresiniz değişirse yalnızca bu satırı güncelleyip yeniden yayınlayın. Boş bırakılırsa
linkler sayfanın açıldığı adresten üretilir.

> Not: Servis kartında link adresini değiştiren bir arayüz **yoktur**; tek kaynak bu satırdır.
>
> Daha önce dağıtılmış eski Apps Script linkleri (`…/exec?token=…`) gerekiyorsa
> [legacy-apps-script/Yonlendirme.gs](legacy-apps-script/Yonlendirme.gs) dosyasını eski Apps Script
> projesine ekleyip mevcut dağıtımı yeni sürümle güncelleyebilirsiniz; `?token=` kodunu okuyup
> portala yönlendirir.

### Yerel önizleme

```powershell
npm run dev      # http://localhost:5173
```

Firebase Authentication, `localhost` alan adına izin verir; ek ayar gerekmez.

---

## 4. Kullanım

### Admin paneli (`/`)

1. Yönetici e-posta/şifre ile giriş yapın.
2. **Dönem oluştur** (ör. "2026 Ağustos") ve **ihale süresini ay olarak** girin (2, 4, 6 … 24).
   Süre; dönem listesinde, başlıkta, servis portalındaki taahhüt metninde ve tüm çıktılarda görünür.
   - **Mevcut dönemi değiştirme:** dönem listesindeki her satırın sağındaki **✏️** düğmesi
     (veya açık dönemde üstteki **✏️ Dönem**) → ad + süre düzenlenir → **💾 Kaydet** (Enter de olur).
     Aktif olmayan bir dönemin ✏️'sine basarsanız önce o dönem açılır, sonra pencere gelir.
   - **İhale süresi isteğe bağlıdır.** Alanı boş bırakıp kaydederseniz yalnızca ad değişir ve süre
     "tanımsız" kalır (panelde `⚠️ ihale süresi tanımsız` yazar, portal metni "ihale süresi boyunca" der).
     1–24 dışında bir değer girilirse `İhale süresi 1-24 ay arasında olmalı` uyarısı çıkar.
   - Kaydedince değişiklik **bütün servis linklerine** (`publicData`) tek seferde yayılır.
   - Eski dönemlerde süre yoktur; bir kez ✏️ → süre → Kaydet yapmanız yeterli.
3. **Excel Yükle** — dosyada şu sütunlar aranır:
   `Malzeme Tanımı`, `Taşınır Kodu`, `SutKodu`, `SMT Kodu`, `Branş (Kategori Adı)`.
   (Sütun adları esnek eşlenir; `Taşınır Kodu` boşsa `SutKodu` anahtar olur.)
4. **Servis Ekle** — her servis için bir link üretilir, 📋 ile kopyalanır.
   Linkler `https://dmo-sarf-istek.pages.dev/service?token=<token>` biçimindedir ve adres
   [firebase-config.js](public/js/firebase-config.js) içindeki `PORTAL_BASE_URL` ile sabittir.
5. **Şartname Yükle** — üç yol var:
   - **📄 Dosya Seç:** birden fazla dosya seçilebilir (Word `.docx`/`.doc` veya PDF).
   - **📁 Klasör Seç:** tüm klasör (alt klasörler dahil) taranır, uygun dosyalar tek tek yüklenir.
   - **Sürükle-bırak:** dosya veya klasörü "Dosya veya klasörü buraya bırakın" alanına bırakın.

   **Kod, dosya adından veya klasör adından bulunur.** İki düzen de desteklenir:

   ```
   SMT1044/derin cerrahi.docx        → SMT1044     (klasör adı koddur)
   Sartnameler/SMT1077/arter.docx    → SMT1077     (üst klasörler de taranır)
   SMT123-Şartname.docx              → SMT123      (dosya adı koddur)
   ```

   Kod bulma sırası:
   1. **Dosya adı** dönemdeki bir SMT koduyla eşleşiyor mu? (büyük/küçük harf duyarsız)
   2. Eşleşmiyorsa **en yakın klasörden yukarı doğru** klasör adları denenir (iç içe klasörler dahil).
   3. Hiçbiri eşleşmiyorsa adlardan tahmin edilir: `SMT001-A.docx` → `SMT001`,
      `SMT-001 Şartname.docx` → `SMT-001`; klasör yalnızca rakamsa (`1044`) dönemdeki `SMT1044` ile eşleştirilir.
   4. Bulunan kod dönemde farklı yazılmışsa (`SMT001` ↔ `SMT1` ↔ `SMT-1`) **Excel'deki yazım** kullanılır;
      böylece portal (malzemenin koduyla arar) dosyayı bulur ve "kod eksik" uyarısı yanlış çıkmaz.
   5. Kod hiç bulunamazsa dosya atlanır; hangi **yol** olduğu sonunda listelenir
      (ör. `Sartnameler/arsiv/genel metin.docx`).
   6. `~` ile başlayan Word kilit dosyaları, `Thumbs.db`, `desktop.ini`, `.DS_Store` ve
      desteklenmeyen uzantılar sessizce atlanır.
   Aynı kod iki dosyada varsa **yalnızca ilki** yüklenir ve uyarı verilir.
   Kod alanı yalnızca **tek dosya** seçildiğinde dosya adını geçersiz kılar.
   Yüklenen dosyalar sol panelde listelenir; 📄 ile açılır, 🗑 ile silinir.
   Panel ayrıca **hangi SMT kodlarının şartnamesi eksik** olduğunu gösterir (koda tıklayınca kutuya yazılır).

   **Değişmeyen dosyaları atla** (varsayılan **açık**, `sartAyniAtla` onay kutusu):
   aynı klasörü tekrar yüklediğinizde yalnızca **yeni veya değişmiş** dosyalar yazılır.
   Karşılaştırma üç bilgiyle yapılır: dosya adı + boyut + son değişiklik zamanı
   (`lastModified`). Sonuç özette `N yüklendi · M değişmedi (atlandı)` olarak görünür;
   hiçbiri değişmemişse `6 dosya zaten güncel — yüklenecek yenisi yok` yazar.
   - Dosyayı Word'de açıp **kaydetseniz bile** son değişiklik zamanı yenilenir → yeniden yazılır.
   - Kutuyu **kapatırsanız** tüm dosyalar baştan yazılır (içerik bozulduğundan şüpheleniyorsanız kullanın).
   - `lastModified` bilgisi olmayan eski kayıtlar bir kez yeniden yazılır, sonra normal atlanır.

   **Toplu silme:** her satırın başındaki onay kutusuyla seçim yapılır →
   **🗑 Seçilenleri Sil (N)** yalnızca seçilenleri, **Tümünü Sil** listeyi boşaltır.
   **Tümü** kutusu üç durumludur (hiçbiri / bir kısmı / hepsi). Silme öncesi onay istenir ve
   dosyanın Firestore'daki tüm parçaları tek batch'te temizlenir; silinen dosyaların kotası geri döner.
6. **Ana İstek Tablosu** — hücreye miktar yazınca anında kaydedilir (🕒 saat bilgisi hücre altında görünür).
   Sütun başlığına tıkla → sırala, başlık altındaki kutudan → Dolu/Boş filtrele.
7. **Excel İndir** — "İstek Tablosu" + "İstek Listesi" sekmeleriyle .xlsx çıktısı.
8. **🖨 Çıktı** — hem yazdırma hem Excel için tek pencere:

   | Seçenek | Ne yapar |
   |---|---|
   | **Servisler hariç** | Her malzeme **tek satır**: branş + malzeme toplam miktarı (servis sütunu yok) |
   | **Servisler dahil** | Her servis **ayrı sütun**, satır sonunda malzeme toplamı |
   | Kapsam | Sadece talebi olanlar (varsayılan) · ekrandaki sıralama/filtre · tüm malzemeler |
   | Ek açıklama | Çıktının altına serbest metin (ör. "İhale komisyonuna sunulmak üzere…") |
   | İmza alanları | Hazırlayan / Kontrol Eden / Onaylayan kutuları |

   Çıktının başında **hastane adı, dönem, ihale süresi (aylık), kalem sayısı ve tarih** ile
   moda göre değişen bir açıklama bulunur (dönem adı zaten "A Grubu" içeriyorsa tekrar yazılmaz):

   | Mod | Açıklama |
   |---|---|
   | **Servisler hariç** | *"Yozgat Şehir Hastanesi'nin 2026 Ağustos 4 aylık döneminde A Grubu tıbbi sarf malzeme ihtiyacı için hazırlanan talep listesidir. Listede toplam **N kalem malzeme hastanemiz tarafından** talep edilmiştir."* — servis sayısı **hiç geçmez** |
   | **Servisler dahil** | *"… Listede toplam N kalem malzeme **hastanemiz sarf depo, Ameliyathane ve Yoğun Bakım servisleri tarafından** talep edilmiştir."* |

   "Servisler dahil" modunda adlar 6 servise kadar tek tek yazılır; daha fazlaysa
   *"hastanemiz sarf depo ve 22 servis tarafından"* şeklinde kısalır. Hiç servis talebi yoksa
   *"hastanemiz sarf depo tarafından"* denir. Tabloda **sıra numarası** ilk sütundadır.
   Aynı seçeneklerle **⬇️ Excel** alınabilir; dosya adı `talep-<dönem>-servisli|servissiz-<tarih>.xlsx`
   olur ve aynı açıklama satırları sayfaya yazılır (kapsam satırında servis sayısı yalnızca dahil modda).

   > Farklı malzemelerin miktarları **toplanmaz** (anlamsız olur). Bu yüzden çıktılarda
   > "genel miktar toplamı" yerine **kalem sayısı** (her iki modda) ve **servis sayısı**
   > (yalnızca "servisler dahil" modunda) gösterilir.

   **Yazdırma davranışı (ortak):** içerik A4 ölçüsüne göre ölçülüp sayfalara bölünür
   ([`public/js/print.js`](public/js/print.js)). Bu sayede üst başlık **her sayfada** yinelenir,
   sağ altta **`2 / 10`** biçiminde sayfa numarası yazılır. İmza kutuları ve taahhüt metni tek
   parça sayılır: biri sayfaya sığmazsa **ikisi birlikte** sonraki sayfaya geçer, böylece
   imzalanan metin her zaman imza kutularıyla aynı sayfada kalır.
   Sayfa numarasını kendimiz bastığımız için tarayıcının yazdırma penceresinde
   **"Üst bilgi ve alt bilgi"** seçeneğini kapatmanız önerilir (yoksa numara iki kez görünür).

### Servis portalı (`/s/<token>`)

1. Link açılır → servis adı ve dönem görünür → **Giriş Yap**.
2. Branş filtresi + arama ile malzeme bulun → **➕ Ekle** → miktarı girin.
3. **İsteklerim** tablosunda tarih/saat ile listelenir; 🗑 ile silinir.
4. Listenin altında **📌 Taahhüt** kutusu otomatik oluşur (kalem sayısı ve ay sayısı canlı güncellenir):
   *"Yukarıda listelenen N kalem malzeme, Ameliyathane servisinin 4 aylık ihtiyacı için tarafımızdan
   talep edilmiştir. Söz konusu malzemeleri 4 ay boyunca kullanacağımızı ve miktarların servisimizin
   gerçek ihtiyacına uygun olduğunu beyan ve taahhüt ederiz."* Altında İstekte Bulunan / Servis
   Sorumlusu / Tarih imza alanları vardır.
5. **Yazdır** → A4 yatay; başlıkta dönem + **aylık ihale**, tabloda **sıra numarası**, tablo altında
   *"Toplam N kalem malzeme · 4 aylık ihtiyaç"* satırı ve **taahhüt metni** + imza kutuları bulunur.
   Birden fazla sayfa gerekiyorsa üst başlık her sayfada yinelenir, sağ altta **`2 / 10`** biçiminde
   sayfa numarası çıkar; taahhüt metni ile imza kutuları **tek parça** sayılır — imza kutuları
   sonraki sayfaya geçerse taahhüt metni de onlarla birlikte gider.
6. **İmza kutuları** (`İmza:` alanı, 0–10) iki satıra bölünür ve kutular **esnemez**; hepsi aynı
   genişliktedir, alt satır üstteki satıra göre ortalanır. Etiket **yalnızca ilk kutuda**
   (*Servis Sorumlusu*) yazar; diğer kartlar boş imza alanıdır.

   | İmza sayısı | Yerleşim |
   |---|---|
   | 1 | tek kutu (tam genişlik) |
   | 2 | 2 |
   | 3 | 2 + 1 (alt ortalı) |
   | 4 | 2 + 2 |
   | 5 | 3 + 2 (alt ortalı) |
   | 6 | 3 + 3 |
   | 7 | 4 + 3 |
   | 8 | 4 + 4 |
   | 9 | 5 + 4 |
   | 10 | 5 + 5 |

7. 📄 butonu şartnameyi açar: **Word (.docx)** dosyaları biçimlendirmesiyle birlikte pencere içinde
   görüntülenir (tablo/başlıklar korunur), PDF'ler yeni sekmede açılır, eski `.doc` dosyaları indirilir.
   Önizleme penceresindeki **⬇ İndir** ile orijinal dosya alınabilir.

---

## 5. Arayüz yerleşimi

**Admin paneli** iki sütunlu tam ekran düzendir; sayfa kaymaz, yalnızca tablo kendi içinde kayar.

- Sol panel: dönemler, Excel, servisler, şartnameler. Üstteki **«** düğmesi veya **Ctrl+B** ile
  gizlenip gösterilir; tercih tarayıcıda hatırlanır (`localStorage`).
- **Menü gizlenince** kazanılan genişlik doğrudan **Malzeme Tanımı sütununa** eklenir
  (ör. 1440 px ekranda 220 px → 437 px) ve gerekirse yatay kaydırma tamamen kalkar.
- Sağ panel: seçili dönemin istek tablosu (başlık + filtre satırı yapışkan).
- **TOPLAM sütunu 96 px sabittir ve sağ kenara yapışıktır.** Servis eklendikçe servis sütunları
  önce daralır (en az 64 px), yer bitince tablo yatay kayar; TOPLAM her zaman sağda görünür.
  Sol taraftaki **SutKodu** sütunu da sola yapışıktır.
- Servis adına tıklayınca o servisin linki görünür; 📋 ile kopyalanır.

**Servis portalı** tek ekranda sekmelidir: “Malzeme Listesi” ve “İsteklerim”.
Sekme sayesinde iki tablo üst üste uzamaz; her tablo kendi içinde kayar.

## 6. Veri modeli

```
donemler/{donemId}
  ad, aySure, createdAt, file, materialCount, serviceCount, branslar[]
  ├─ malzemeler/{materialKey}
  │    key, sutKodu, tasinirKodu, tanim, smtKodu, branslar[], order
  └─ servisler/{serviceId}
       id, name, token, createdAt

publicData/{token}          ← portalın okuduğu/yazdığı tek doküman
  donemId, donemAd, aySure, serviceId, name, branslar[],
  istekler: { "<materialKey>": { miktar, tarih } }

sartnameler/{smtKodu}                 (dosya bilgisi: ad, tür, boyut, parça sayısı)
  └─ parcalar/{i}                    (base64 parçaları, ~384 KB)
```

`aySure` = ihale süresi (ay). Dönem oluşturulurken girilir, **✏️ Dönem** ile değiştirilir ve
`syncPublicData` ile tüm servis dokümanlarına yazılır (portaldaki taahhüt metni buradan okur).

> **Eski dönemler:** bu alan eklenmeden önce oluşturulmuş dönemlerde `aySure` yoktur; panel
> "⚠️ ihale süresi tanımsız" gösterir. Dönem satırındaki **✏️** (veya **✏️ Dönem**) → süre → Kaydet
> yapın; tüm servis linkleri otomatik güncellenir. O zamana kadar portal metni "ihale süresi boyunca" der.

`publicData` doküman kimliği servis linkindeki gizli koddur. Kural gereği portal bu dokümanın
**yalnızca `istekler` alanını** değiştirebilir; servis adı, dönem gibi alanlara dokunamaz.

---

## 7. Şartnameler nerede saklanır

Firebase Storage yeni projelerde **Blaze (kredi kartlı) plan** istediği için şartname dosyaları
Firestore'da saklanır — tamamen ücretsiz kotaya dahildir:

- Her dosya ~384 KB'lık base64 parçalara bölünür → `sartnameler/{kod}/parcalar/{i}`
- Dosya bilgisi `sartnameler/{kod}` dokümanında tutulur (ad, tür, boyut, parça sayısı).
- Portal veya admin bir şartname açtığında parçalar indirilip tarayıcıda birleştirilir (blob).
- Kural: herkes okur, yalnızca yönetici yükler/siler.

**Kotayı aşmamak için:** tek dosya sınırı **20 MB**'dir (uygulama engeller).
Ücretsiz Firestore kotası 1 GiB toplam veri + günde 20.000 yazma / 50.000 okuma.
Base64 kodlama ~%33 fazla yer kaplar, bütçe hesabında bunu hesaba katın.

### Gerçek ölçüm (14 MB / 50 dosyalık klasör)

| Ölçüm | Sonuç |
|---|---|
| Klasör | 50 Word dosyası, 14,0 MB (ortalama 287 KB) |
| Firestore'a yazılan | 71 parça, ~18,7 MB (base64 dahil) |
| Panelde görünen | `50 dosya · 14.0 MB · %1.8 kota` |
| Kalan alan | 1005 MB (1 GB üzerinden) |
| Toplu yükleme | 50 dosya sıralı olarak yüklendi, uyarı/hata yok |
| Tek dosya önizleme | 287 KB Word → 257 ms'de biçimli görüntü |

25 MB'lık tam arşiv ≈ 33 MB yer kaplar → 1 GB kotanın **%3'ü**. Yani bu boyutlar için
Firebase yeterli; Neon/Supabase'e geçmenin bir faydası yok.

### Klasör yükleme nasıl çalışır?

- Tarayıcının `webkitdirectory` desteği kullanılır; klasör seçildiğinde alt klasörler de dahil olmak üzere
  tüm dosyalar listelenir. Sürükle-bırakta klasörler `webkitGetAsEntry` ile özyinelemeli taranır.
- Tarama **istemcide** yapılır: sunucuya yalnızca eşleşen dosyalar gider, klasör yapısı saklanmaz.
- Yükleme **3 paralel** akışla yapılır (400+ dosyada sıralıya göre ~3 kat hızlı), ilerleme canlı görünür.
- Sürükle-bırakta da **klasör yolu korunur**: `SMT1044/derin cerrahi.docx` bırakıldığında kod klasörden
  okunur (`webkitGetAsEntry` ile özyinelemeli tarama, 12 seviyeye kadar).
- Dosya başına **1 okuma** yapılır (meta okunur, parça listesi sorgulanmaz) ve bilgi dokümanı
  son parçayla **aynı batch'te** yazılır → 400 dosyalık klasörde ~800 işlem tasarrufu.
- **Kota koruması:** günlük kota dolarsa kalan dosyalar denenmez; özet "kota doldu, yarın sıfırlanır" der.
- Liste alınamazsa (kota/yetki/ağ) panel boş kalmaz: son başarılı liste tarayıcıdan gösterilir,
  hata koduyla birlikte uyarı bandı ve **↻ Tekrar Dene** düğmesi çıkar.
- 12'den fazla dosyada liste içinde **arama** kutusu görünür.

### Tekrar yüklemede atlama (skip) mantığı

Aynı arşivi her seferinde 548 dosyayla yeniden yazmak hem 20.000/gün yazma kotasını yer hem de
birkaç dakika sürer. Bu yüzden yükleme öncesinde her dosya mevcut kayıtla karşılaştırılır:

| Karşılaştırma | Kaynak |
|---|---|
| Dosya adı | `File.name` (bilgi dokümanındaki `name`) |
| Boyut | `File.size` |
| Son değişiklik zamanı | `File.lastModified` (bilgi dokümanındaki `lastModified`) |

Üçü de aynıysa dosya **hiç okunmaz/yazılmaz** (0 okuma, 0 yazma). Farklıysa yeni parçalar yazılır,
artan eski parçalar silinir. Böylece `Dosya Seç` / `Klasör Seç` / sürükle-bırak üçünde de
aynı davranış geçerlidir. 548 dosyalık arşivde yalnızca 3 dosya değiştiyse o 3 dosya yazılır.

Toplu silme dosyaları sırayla işler: her dosya için parçaları + meta tek `writeBatch` içinde
gönderilir (Firestore sınırı 500 işlem; kod 400'lük gruplara böler). İlerleme `Siliniyor 3/10…`
olarak görünür; yetki/kota hatasında döngü durur ve tek özet gösterilir
(`9/10 şartname silindi` + silinemeyenlerin listesi).

### Word (.docx) şartnameleri nasıl görüntülenir?

- Yükleme tarafı biçimden bağımsızdır: `.docx` dosyası da aynı şekilde parçalanıp saklanır.
- Portal 📄 düğmesine basınca dosya indirilip tarayıcıda **mammoth.js** ile HTML'e çevrilir ve
  pencere içinde gösterilir (başlık, paragraf, tablolar korunur). Ek sunucu/kota gerekmez.
- Kütüphane yalnızca ilk görüntülemede CDN'den (`cdn.jsdelivr.net`) yüklenir (~640 KB).
  Kurum ağı CDN'i engelliyorsa pencere "görüntülenemedi" der ve **⬇ İndir** ile dosya alınır.
- Eski ikili biçim (`.doc`) tarayıcıda çevrilemez; doğrudan indirilir.
  Bu dosyaları Word'de "Farklı Kaydet → .docx" yapmanız önerilir.
- Karmaşık Word yerleşimleri (metin kutuları, üstbilgi/altbilgi, alan kodları) birebir çıkmayabilir;
  asıl belge her zaman ⬇ İndir ile alınabilir.

> Daha büyük arşiv gerekiyorsa dosyaları Cloudflare R2 / Workers KV gibi bir depoya
> veya Google Drive'a taşıyabilirsiniz; mevcut kod `data.js` içindeki
> `uploadSartname / readSartname / deleteSartname` fonksiyonları değiştirilerek uyarlanır.

## 8. Güvenlik notları

- Yönetici yetkisi `firestore.rules` içindeki **e-posta listesiyle** verilir.
  Listeye eklenmeyen hesaplar, Authentication'da hesap açmış olsa bile veri okuyamaz/yazamaz.
- Servis portalı kimlik doğrulaması kullanmaz; erişim **24 karakterlik tahmin edilemez token** iledir.
  Bu yüzden token'ları halka açık yerlerde paylaşmayın.
- Malzeme listesi (katalog) herkese okunabilir; miktar/fiyat gibi hassas veriler token altındadır.
- Şifre sıfırlama e-postası Firebase üzerinden gönderilir (varsayılan şablon ile).

---

## 9. Eski Google Apps Script sürümünden geçiş

- Eski dosyalar [`legacy-apps-script/`](legacy-apps-script) klasöründe duruyor; ihtiyaç olursa referans olarak kullanılabilir.
- Google Sheets'teki malzemeler **Excel olarak indirilip** yeni panelde "Excel Yükle" ile içe aktarılabilir.
- Servisler yeniden tanımlanır (her servis için yeni ve daha güvenli token üretilir) → **linkler değişir**,
  servislere yeni linkler gönderilmelidir.
- Süreç tamamlandığında eski Apps Script dağıtımını arşivleyebilirsiniz.

---

## 10. Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Firebase Kurulumu Gerekli" ekranı | `public/js/firebase-config.js` doldurulmamış. |
| Giriş sonrası "yönetici yetkisi yok" | `firestore.rules` içindeki e-posta listesine hesabı ekleyip kuralları dağıtın. |
| Servis linki "geçersiz" diyor | Link yanlış kopyalanmış olabilir; Admin → Servis Tanımları'ndan yeni linki kopyalayın. |
| Şartname bulunamıyor | Dosya adının SMT kodu ile başladığını ve yüklendiğini kontrol edin; sol panelde "N kod eksik" uyarısı eksik kodları listeler. |
| Word önizlemesi açılmıyor | CDN engelli olabilir; **⬇ İndir** ile açın veya dosyayı PDF'e çevirip yükleyin. |
| Excel yüklenmiyor | Sütun adlarını kontrol edin; çok büyük dosyalarda birkaç saniye sürebilir. |
| Dosya yüklenmiyor | Tek dosya 20 MB'dan küçük olmalı; günlük Firestore yazma kotası (20.000) dolmuş olabilir. Paneldeki "%X kota" göstergesine bakın. |
| "Yetki hatası (permission-denied)" / "Şartnameler listelenemedi" | Yayınlanan Firestore kurallarında `sartnameler` bloğu yok. Paneldeki **📋 Kural metnini kopyala** → konsolda yapıştır → **Yayınla**. Yükleme ilk hatada durur, 548 ayrı hata gösterilmez. |
| Yükleme "3/548"de takıldı | Yetki veya kota hatasında yükleme **bilinçli olarak durur** ve tek özet verir; kalan dosyalar denenmez. Sorunu giderdikten sonra klasörü yeniden seçin. |
| "N kod eksik" ama dosyalar yüklü | Dosya/klasör adındaki kod Excel'dekinden farklı olabilir (`SMT001` vs `SMT1`). Aynı sayılır; uyarı sürerse klasör adını Excel'deki kodla birebir yazın. |
| Klasördeki dosya "kod bulunamadı" diyor | Kod ne dosya adında ne klasör adında var. Klasörü kodla adlandırın (`SMT1044`) veya tek dosya seçip üstteki kutuya kodu yazın. |
