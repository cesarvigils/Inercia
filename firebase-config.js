
import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore';
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

/*
 * La sesión se guarda en localStorage, no en IndexedDB. getAuth() elige
 * IndexedDB por defecto, y el SDK cierra esa base cuando la pestaña se
 * oculta (pagehide / visibilitychange); cualquier lectura o escritura de
 * la sesión en ese momento falla con "Database is closing/hidden" y deja
 * la inicialización de Auth rota. Antes esto se "arreglaba" llamando a
 * setPersistence() en js/admin.js, que en cada carga movía la sesión de
 * IndexedDB a localStorage justo en esa ventana. IndexedDB queda de segundo
 * en la lista sólo para rescatar sesiones viejas guardadas ahí: si la
 * encuentra, el SDK la pasa a localStorage.
 */
export const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, indexedDBLocalPersistence],
});
/*
 * Caché local de Firestore en IndexedDB. Sin esto, cada recarga del panel
 * vuelve a descargar (y cobrar) cada documento que escuchan los
 * onSnapshot de js/admin.js. Con la caché, si el panel se reabre dentro de
 * ~30 minutos Firestore sólo cobra los documentos que cambiaron. Varias
 * pestañas abiertas comparten la misma caché.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});