import { auth, db } from '../firebase-config.js';

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    updateProfile,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    signOut
} from 'firebase/auth';

import {
    doc,
    setDoc,
    serverTimestamp
} from 'firebase/firestore';


/* =========================================================
   ELEMENTS
   ========================================================= */

const authBtn = document.getElementById('authBtn');
const authPfp = document.getElementById('authPfp');

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

const profileMenu = document.getElementById('profileMenu');
const profileMenuPfp = document.getElementById('profileMenuPfp');
const profileMenuName = document.getElementById('profileMenuName');
const profileMenuEmail = document.getElementById('profileMenuEmail');

const logoutBtn = document.getElementById('logoutBtn');


const DEFAULT_PFP =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FDefault_pfp__1_-removebg-preview.png?alt=media&token=cb4d4f86-712f-4ab9-b948-a30554913344';


/* =========================================================
   AUTH PERSISTENCE
   ========================================================= */

/*
 * Keeps the Firebase login stored locally.
 *
 * Firebase restores the session when:
 * - page refreshes
 * - user changes pages
 * - browser closes/reopens
 *
 * The session remains until signOut() is called.
 */

setPersistence(auth, browserLocalPersistence)
    .catch((error) => {
        console.error('Error configurando persistencia:', error);
    });


/* =========================================================
   MODAL
   ========================================================= */

function openAuthModal() {
    closeProfileMenu();

    authModal?.classList.add('open');
    authModal?.setAttribute('aria-hidden', 'false');

    document.body.classList.add('auth-modal-open');
}


function closeAuthModal() {
    authModal?.classList.remove('open');
    authModal?.setAttribute('aria-hidden', 'true');

    document.body.classList.remove('auth-modal-open');

    hideMessage();
}


/* =========================================================
   PROFILE MENU
   ========================================================= */

function openProfileMenu() {
    profileMenu?.classList.add('open');
    profileMenu?.setAttribute('aria-hidden', 'false');
}


function closeProfileMenu() {
    profileMenu?.classList.remove('open');
    profileMenu?.setAttribute('aria-hidden', 'true');
}


function toggleProfileMenu() {

    if (!profileMenu) return;

    if (profileMenu.classList.contains('open')) {
        closeProfileMenu();
    } else {
        openProfileMenu();
    }
}


/* =========================================================
   PROFILE BUTTON
   ========================================================= */

authBtn?.addEventListener('click', (event) => {

    event.stopPropagation();

    /*
     * If Firebase has a logged-in user:
     * show account menu.
     *
     * Otherwise:
     * show login/register modal.
     */

    if (auth.currentUser) {
        toggleProfileMenu();
    } else {
        openAuthModal();
    }

});


authModalClose?.addEventListener('click', closeAuthModal);

authModalBackdrop?.addEventListener('click', closeAuthModal);


document.addEventListener('click', (event) => {

    if (
        profileMenu?.classList.contains('open') &&
        !profileMenu.contains(event.target) &&
        !authBtn?.contains(event.target)
    ) {
        closeProfileMenu();
    }

});


document.addEventListener('keydown', (event) => {

    if (event.key !== 'Escape') return;

    if (authModal?.classList.contains('open')) {
        closeAuthModal();
    }

    closeProfileMenu();

});


/* =========================================================
   LOGIN / REGISTER TABS
   ========================================================= */

function setAuthTab(tab) {

    authTabs.forEach((button) => {

        button.classList.toggle(
            'active',
            button.dataset.authTab === tab
        );

    });


    loginForm?.classList.toggle(
        'active',
        tab === 'login'
    );


    registerForm?.classList.toggle(
        'active',
        tab === 'register'
    );


    hideMessage();
}


authTabs.forEach((button) => {

    button.addEventListener('click', () => {
        setAuthTab(button.dataset.authTab);
    });

});


authSwitchButtons.forEach((button) => {

    button.addEventListener('click', () => {
        setAuthTab(button.dataset.switchAuth);
    });

});


/* =========================================================
   MESSAGES
   ========================================================= */

function showMessage(message) {

    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.classList.add('show');

}


function hideMessage() {

    if (!authMessage) return;

    authMessage.textContent = '';
    authMessage.classList.remove('show');

}


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

        case 'auth/popup-closed-by-user':
            return 'Se cerró la ventana de Google.';

        case 'auth/popup-blocked':
            return 'El navegador bloqueó la ventana de Google.';

        default:
            console.error(error);
            return 'Ocurrió un error. Intenta de nuevo.';
    }

}


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(auth, (user) => {

    if (user) {

        const photo = user.photoURL || DEFAULT_PFP;

        if (authPfp) {
            authPfp.src = photo;
        }

        if (profileMenuPfp) {
            profileMenuPfp.src = photo;
        }

        if (profileMenuName) {
            profileMenuName.textContent =
                user.displayName || 'USUARIO';
        }

        if (profileMenuEmail) {
            profileMenuEmail.textContent =
                user.email || '';
        }

        authBtn?.classList.add('logged-in');

    } else {

        if (authPfp) {
            authPfp.src = DEFAULT_PFP;
        }

        if (profileMenuPfp) {
            profileMenuPfp.src = DEFAULT_PFP;
        }

        if (profileMenuName) {
            profileMenuName.textContent = 'USUARIO';
        }

        if (profileMenuEmail) {
            profileMenuEmail.textContent = '';
        }

        authBtn?.classList.remove('logged-in');

        closeProfileMenu();

    }

});


/* =========================================================
   LOGIN
   ========================================================= */

loginForm?.addEventListener('submit', async (event) => {

    event.preventDefault();

    hideMessage();


    const email =
        document
            .getElementById('loginEmail')
            .value
            .trim();


    const password =
        document
            .getElementById('loginPassword')
            .value;


    if (!email || !password) {

        showMessage('Completa todos los campos.');
        return;

    }


    const submitBtn =
        loginForm.querySelector(
            'button[type="submit"]'
        );


    submitBtn?.setAttribute(
        'disabled',
        'true'
    );


    try {

        await setPersistence(
            auth,
            browserLocalPersistence
        );


        await signInWithEmailAndPassword(
            auth,
            email,
            password
        );


        closeAuthModal();

        loginForm.reset();


    } catch (error) {

        showMessage(
            friendlyAuthError(error)
        );


    } finally {

        submitBtn?.removeAttribute(
            'disabled'
        );

    }

});


/* =========================================================
   REGISTER
   ========================================================= */

registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    hideMessage();

    console.log('Register form submitted');

    const nameInput = document.getElementById('registerName');
    const emailInput = document.getElementById('registerEmail');
    const phoneInput = document.getElementById('registerPhone');
    const passwordInput = document.getElementById('registerPassword');
    const passwordConfirmInput = document.getElementById('registerPasswordConfirm');

    if (
        !nameInput ||
        !emailInput ||
        !phoneInput ||
        !passwordInput ||
        !passwordConfirmInput
    ) {
        console.error('Faltan elementos del formulario:', {
            nameInput,
            emailInput,
            phoneInput,
            passwordInput,
            passwordConfirmInput
        });

        showMessage('Error interno del formulario.');
        return;
    }

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const phone = phoneInput.value.trim();
    const password = passwordInput.value;
    const passwordConfirm = passwordConfirmInput.value;

    if (!name || !email || !phone || !password || !passwordConfirm) {
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

    const submitBtn =
        registerForm.querySelector('button[type="submit"]');

    submitBtn?.setAttribute('disabled', 'true');

    try {
        console.log('Creating Firebase user...');

        await setPersistence(
            auth,
            browserLocalPersistence
        );

        const result =
            await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

        console.log('Firebase user created:', result.user.uid);

        await updateProfile(result.user, {
            displayName: name
        });

        console.log('Firebase profile updated');

        await setDoc(
            doc(db, 'users', result.user.uid),
            {
                name: name,
                email: email,
                phoneNumber: phone,
                provider: 'password',
                createdAt: serverTimestamp()
            }
        );

        console.log('Firestore profile saved');

        registerForm.reset();
        closeAuthModal();

    } catch (error) {
        console.error('REGISTER ERROR:', error);

        showMessage(
            friendlyAuthError(error)
        );

    } finally {
        submitBtn?.removeAttribute('disabled');
    }
});


/* =========================================================
   GOOGLE
   ========================================================= */

async function continueWithGoogle() {

    hideMessage();


    const provider =
        new GoogleAuthProvider();


    try {

        await setPersistence(
            auth,
            browserLocalPersistence
        );


        const result =
            await signInWithPopup(
                auth,
                provider
            );


        /*
         * Save/update the Google account in Firestore.
         *
         * merge:true prevents us from deleting fields
         * such as phoneNumber if they already exist.
         */

        await setDoc(
            doc(
                db,
                'users',
                result.user.uid
            ),
            {
                name:
                    result.user.displayName || '',

                email:
                    result.user.email || '',

                photoURL:
                    result.user.photoURL || '',

                provider: 'google'
            },
            {
                merge: true
            }
        );


        closeAuthModal();


    } catch (error) {

        showMessage(
            friendlyAuthError(error)
        );

    }

}


googleLoginBtn?.addEventListener(
    'click',
    continueWithGoogle
);


googleRegisterBtn?.addEventListener(
    'click',
    continueWithGoogle
);


/* =========================================================
   LOGOUT
   ========================================================= */

logoutBtn?.addEventListener('click', async () => {

    logoutBtn.disabled = true;


    try {

        await signOut(auth);

        closeProfileMenu();


    } catch (error) {

        console.error(
            'Error cerrando sesión:',
            error
        );


    } finally {

        logoutBtn.disabled = false;

    }

});