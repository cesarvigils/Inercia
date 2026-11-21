/*
 * js/profile/avatar.js
 *
 * Changing the profile picture. Used by the PERFIL overlay (click the
 * avatar) and the account menu (click the small avatar), both in
 * js/profile/profile-view.js / js/auth.js.
 *
 *   pickImage()                     opens the file picker -> File | null
 *   uploadAvatar(user, file, opts)  crop + compress + upload -> photoURL
 *
 * The picture is center-cropped to a 512×512 square and re-encoded in the
 * browser (WebP, JPEG where WebP isn't supported), so a 10 MB phone photo
 * uploads as ~50 KB. It goes to Storage at avatars/{uid}/{timestamp}.webp
 * (storage.rules: only the owner can write there, max 2 MB, images only),
 * then becomes the account's photoURL (Firebase Auth) and users/{uid}.photoURL.
 * The previous uploaded avatar is deleted afterwards (best effort).
 *
 * When it's done, window gets an 'inercia:avatar' event with
 * { detail: { photoURL } } so every avatar on the page can update.
 */

import { auth } from '../../firebase-config.js';

const SIZE = 512;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

export const AVATAR_EVENT = 'inercia:avatar';

export class AvatarError extends Error {}

/* Opens the system file picker. Resolves with the File, or null if cancelled. */
export function pickImage() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';

        let settled = false;
        const done = (file) => {
            if (settled) return;
            settled = true;
            input.remove();
            resolve(file || null);
        };

        input.addEventListener('change', () => done(input.files?.[0]));
        input.addEventListener('cancel', () => done(null));

        document.body.append(input);
        input.click();
    });
}

async function decode(file) {
    if ('createImageBitmap' in window) {
        try {
            return await createImageBitmap(file);
        } catch {
            // Fall through to <img> (e.g. formats createImageBitmap can't read).
        }
    }

    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/* Center-cropped SIZE×SIZE square, WebP (or JPEG). */
async function squareImage(file) {
    let image;
    try {
        image = await decode(file);
    } catch {
        throw new AvatarError('No pudimos leer esa imagen. Probá con otra (JPG o PNG).');
    }

    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    const side = Math.min(width, height);

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    image.close?.();

    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') {
        blob = await toBlob(canvas, 'image/jpeg', 0.88);
    }
    if (!blob) throw new AvatarError('No pudimos procesar esa imagen.');

    return blob;
}

/*
 * Crops, compresses and uploads `file` as the user's new picture.
 *   opts.onPreview(objectUrl)  called right away with the cropped image
 *   opts.onProgress(0..1)      upload progress
 * Resolves with the new photoURL.
 */
export async function uploadAvatar(user, file, { onPreview, onProgress } = {}) {
    if (!user) throw new AvatarError('Iniciá sesión para cambiar tu foto.');
    if (!file || !file.type.startsWith('image/')) {
        throw new AvatarError('Elegí una imagen (JPG, PNG o WebP).');
    }
    if (file.size > MAX_INPUT_BYTES) {
        throw new AvatarError('La imagen es muy pesada (máximo 15 MB).');
    }

    const blob = await squareImage(file);
    onPreview?.(URL.createObjectURL(blob));

    const [{ getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject }, { updateProfile }] =
        await Promise.all([import('firebase/storage'), import('firebase/auth')]);

    const storage = getStorage(auth.app);
    const extension = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `avatars/${user.uid}/${Date.now()}.${extension}`;
    const previousURL = user.photoURL || '';

    const task = uploadBytesResumable(ref(storage, path), blob, {
        contentType: blob.type,
        cacheControl: 'public, max-age=31536000'
    });

    await new Promise((resolve, reject) => {
        task.on(
            'state_changed',
            (snapshot) => onProgress?.(snapshot.bytesTransferred / (snapshot.totalBytes || 1)),
            (error) => reject(new AvatarError(
                error?.code === 'storage/unauthorized'
                    ? 'No tenés permiso para subir esta imagen.'
                    : 'No se pudo subir la foto. Revisá tu conexión y probá de nuevo.'
            )),
            resolve
        );
    });

    const photoURL = await getDownloadURL(task.snapshot.ref);

    await updateProfile(user, { photoURL });

    // Keep users/{uid} in sync (best effort; the account photo is what's shown).
    try {
        const { db, doc, setDoc } = await import('../../firebase-db.js');
        await setDoc(doc(db, 'users', user.uid), { photoURL }, { merge: true });
    } catch (error) {
        console.warn('[PERFIL] No se pudo guardar la foto en users/{uid}:', error.message);
    }

    // Remove the previous uploaded avatar (never a Google photo or the default).
    if (previousURL.includes(`avatars%2F${user.uid}%2F`)) {
        deleteObject(ref(storage, previousURL)).catch(() => {});
    }

    window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { photoURL } }));

    return photoURL;
}
