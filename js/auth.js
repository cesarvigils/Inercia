import { auth } from './firebase-config.js';

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    updateProfile
} from "firebase/auth";


const authBtn = document.getElementById('authBtn');

const authModal = document.getElementById('authModal');
const authModalBackdrop = document.getElementById('authModalBackdrop');
const authModalClose = document.getElementById('authModalClose');

const authTabs = document.querySelectorAll('[data-auth-tab]');
const authSwitchButtons = document.querySelectorAll('[data-switch-auth]');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

const googleLoginBtn = document.getElementById('googleLoginBtn');
const googleRegisterBtn = document.getElementById('googleRegisterBtn');

const authMessage = document.getElementById('authMessage');


/* =========================================================
   MODAL
   ========================================================= */

function openAuthModal() {
    authModal.classList.add('open');
    authModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-modal-open');
}

function closeAuthModal() {
    authModal.classList.remove('open');
    authModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('auth-modal-open');
    hideMessage();
}

authBtn?.addEventListener('click', openAuthModal);
authModalClose?.addEventListener('click', closeAuthModal);
authModalBackdrop?.addEventListener('click', closeAuthModal);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && authModal.classList.contains('open')) {
        closeAuthModal();
    }
});


/* =========================================================
   LOGIN / REGISTER TABS
   ========================================================= */

function setAuthTab(tab) {
    authTabs.forEach(button => {
        button.classList.toggle('active', button.dataset.authTab === tab);
    });

    loginForm.classList.toggle('active', tab === 'login');
    registerForm.classList.toggle('active', tab === 'register');

    hideMessage();
}

authTabs.forEach(button => {
    button.addEventListener('click', () => setAuthTab(button.dataset.authTab));
});

authSwitchButtons.forEach(button => {
    button.addEventListener('click', () => setAuthTab(button.dataset.switchAuth));
});


/* =========================================================
   MESSAGES
   ========================================================= */

function showMessage(message) {
    authMessage.textContent = message;
    authMessage.classList.add('show');
}

function hideMessage() {
    authMessage.textContent = '';
    authMessage.classList.remove('show');
}

// Maps Firebase's error codes to friendlier Spanish messages.
// Never show raw error.message to users — it can leak internal details.
function friendlyAuthError(error) {
    switch (error.code) {
        case 'auth/email-already-in-use':
            return 'Ese correo ya está registrado.';
        case 'auth/invalid-email':
            return 'Correo electrónico inválido.';
        case 'auth/weak-password':
            return 'La contraseña es demasiado débil.';
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return 'Correo o contraseña incorrectos.';
        case 'auth/too-many-requests':
            return 'Demasiados intentos. Intenta más tarde.';
        default:
            return 'Ocurrió un error. Intenta de nuevo.';
    }
}


/* =========================================================
   LOGIN
   ========================================================= */

loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showMessage('Completa todos los campos.');
        return;
    }

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn?.setAttribute('disabled', 'true');

    try {
        await signInWithEmailAndPassword(auth, email, password);
        closeAuthModal();
        loginForm.reset();
    } catch (error) {
        showMessage(friendlyAuthError(error));
    } finally {
        submitBtn?.removeAttribute('disabled');
    }
});


/* =========================================================
   REGISTER
   ========================================================= */

registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

    if (!name || !email || !password || !passwordConfirm) {
        showMessage('Completa todos los campos.');
        return;
    }

    if (password.length < 6) {
        showMessage('La contraseña debe tener al menos 6 caracteres.');
        return;
    }

    if (password !== passwordConfirm) {
        showMessage('Las contraseñas no coinciden.');
        return;
    }

    const submitBtn = registerForm.querySelector('button[type="submit"]');
    submitBtn?.setAttribute('disabled', 'true');

    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);

        await updateProfile(result.user, {
            displayName: name
        });

        closeAuthModal();
        registerForm.reset();
    } catch (error) {
        showMessage(friendlyAuthError(error));
    } finally {
        submitBtn?.removeAttribute('disabled');
    }
});


/* =========================================================
   GOOGLE
   ========================================================= */

async function continueWithGoogle() {
    const provider = new GoogleAuthProvider();

    try {
        await signInWithPopup(auth, provider);
        closeAuthModal();
    } catch (error) {
        showMessage(friendlyAuthError(error));
    }
}

googleLoginBtn?.addEventListener('click', continueWithGoogle);
googleRegisterBtn?.addEventListener('click', continueWithGoogle);