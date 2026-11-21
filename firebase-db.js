/*
 * firebase-db.js
 *
 * Firestore, split out of firebase-config.js so the ~300 kB Firestore SDK
 * isn't part of the bundle every page loads. Import it lazily, only where
 * it's actually needed:
 *
 *   const { db, doc, getDoc } = await import('../firebase-db.js');
 *
 * Vite turns that into a separate chunk the browser fetches on first use
 * (sign-up, reading users/{uid}, ...).
 */

import { getFirestore } from 'firebase/firestore';
import { app } from './firebase-config.js';

export { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export const db = getFirestore(app);
