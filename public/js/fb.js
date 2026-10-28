// Firebase SDK'yı başlatır ve servisleri (auth / db) dışa açar.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

export const configured = isFirebaseConfigured();

let app = null;
let auth = null;
let db = null;

if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  // Yerel önbellek: ikinci açılışlar neredeyse anında yüklenir.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (e) {
    db = getFirestore(app);
  }
}

export { app, auth, db };
