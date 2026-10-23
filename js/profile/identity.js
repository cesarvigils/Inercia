/*
 * js/profile/identity.js
 *
 * Who the profile belongs to, from the signed-in Firebase account plus the
 * user's own users/{uid} document (firestore.rules lets a user read only
 * their own). Nothing is asked of the user; missing fields stay null.
 *
 * Identity: { uid, name, email, photoURL, memberSince: Date | null }
 */

import { db } from '../../firebase-config.js';
import { doc, getDoc } from 'firebase/firestore';

const PROFILE_TIMEOUT_MS = 6_000;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

export function identityFromUser(user) {
    return {
        uid: user.uid,
        name: user.displayName || null,
        email: user.email || null,
        photoURL: user.photoURL || null,
        memberSince: null
    };
}

export async function loadIdentity(user) {
    const identity = identityFromUser(user);

    try {
        const snapshot = await withTimeout(getDoc(doc(db, 'users', user.uid)), PROFILE_TIMEOUT_MS);
        const profile = snapshot.exists() ? snapshot.data() : null;

        if (profile) {
            identity.name = profile.name || identity.name;
            identity.email = profile.email || identity.email;
            identity.memberSince =
                typeof profile.createdAt?.toDate === 'function' ? profile.createdAt.toDate() : null;
        }
    } catch (error) {
        // The account itself still has a name and email to show.
        console.warn('[PERFIL] No se pudo leer users/{uid}:', error.message);
    }

    return identity;
}
