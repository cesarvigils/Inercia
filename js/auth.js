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

function showMessage(message, type = 'error') {

    if (!authMessage) return;

    authMessage.textContent = message;

    authMessage.classList.remove(
        'error',
        'success'
    );

    authMessage.classList.add(
        'show',
        type
    );
}


function hideMessage() {

    if (!authMessage) return;

    authMessage.textContent = '';

    authMessage.classList.remove(
        'show',
        'error',
        'success'
    );
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

        case 'permission-denied':
            return 'No hay permisos para guardar los datos de la cuenta.';

        default:

            console.error(
                '[AUTH] Error:',
                error
            );

            return 'Ocurrió un error. Intenta de nuevo.';
    }

}


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(auth, (user) => {

    if (user) {

        const photo =
            user.photoURL ||
            DEFAULT_PFP;


        if (authPfp) {
            authPfp.src = photo;
        }


        if (profileMenuPfp) {
            profileMenuPfp.src = photo;
        }


        if (profileMenuName) {

            profileMenuName.textContent =
                user.displayName ||
                'USUARIO';
        }


        if (profileMenuEmail) {

            profileMenuEmail.textContent =
                user.email ||
                '';
        }


        authBtn?.classList.add(
            'logged-in'
        );


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


        authBtn?.classList.remove(
            'logged-in'
        );


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

        showMessage(
            'Completa todos los campos.'
        );

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

        console.error(
            '[LOGIN] Error:',
            error
        );


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


    /* ---------------------------------------------------------
       READ FORM
       --------------------------------------------------------- */

    const name =
        document
            .getElementById('registerName')
            .value
            .trim();


    const email =
        document
            .getElementById('registerEmail')
            .value
            .trim();


    const phone =
        document
            .getElementById('registerPhone')
            .value
            .trim();


    const password =
        document
            .getElementById('registerPassword')
            .value;


    const passwordConfirm =
        document
            .getElementById('registerPasswordConfirm')
            .value;


    /* ---------------------------------------------------------
       VALIDATION
       --------------------------------------------------------- */

    if (
        !name ||
        !email ||
        !phone ||
        !password ||
        !passwordConfirm
    ) {

        showMessage(
            'Completa todos los campos.'
        );

        return;
    }


    if (password.length < 6) {

        showMessage(
            'La contraseña debe tener al menos 6 caracteres.'
        );

        return;
    }


    if (
        password !==
        passwordConfirm
    ) {

        showMessage(
            'Las contraseñas no coinciden.'
        );

        return;
    }


    /* ---------------------------------------------------------
       BUTTON
       --------------------------------------------------------- */

    const submitBtn =
        registerForm.querySelector(
            'button[type="submit"]'
        );


    const originalButtonText =
        submitBtn?.textContent ||
        'CREAR CUENTA';


    if (submitBtn) {

        submitBtn.disabled = true;

        submitBtn.textContent =
            'CREANDO CUENTA...';
    }


    try {

        console.log(
            '[REGISTER] Configurando persistencia...'
        );


        await setPersistence(
            auth,
            browserLocalPersistence
        );


        /* -----------------------------------------------------
           CREATE AUTH ACCOUNT
           ----------------------------------------------------- */

        console.log(
            '[REGISTER] Creando usuario...'
        );


        const result =
            await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );


        console.log(
            '[REGISTER] Usuario creado:',
            result.user.uid
        );


        /* -----------------------------------------------------
           FIREBASE AUTH PROFILE
           ----------------------------------------------------- */

        console.log(
            '[REGISTER] Guardando nombre...'
        );


        await updateProfile(
            result.user,
            {
                displayName: name
            }
        );


        console.log(
            '[REGISTER] Nombre guardado.'
        );


        /* -----------------------------------------------------
           FIRESTORE PROFILE

           IMPORTANTE:
           phone + phoneNumber se guardan ambos.
           ----------------------------------------------------- */

        console.log(
            '[REGISTER] Guardando datos en Firestore...'
        );


        await setDoc(
            doc(
                db,
                'users',
                result.user.uid
            ),
            {
                name: name,

                email: email,

                /*
                 * Campo principal que usaremos
                 * para reservas.
                 */
                phone: phone,

                /*
                 * Compatibilidad con código viejo.
                 */
                phoneNumber: phone,

                provider: 'password',

                createdAt:
                    serverTimestamp(),

                updatedAt:
                    serverTimestamp()
            },
            {
                /*
                 * No destruimos otros campos si
                 * el documento ya existe.
                 */
                merge: true
            }
        );


        console.log(
            '[REGISTER] Firestore guardado:',
            {
                uid:
                    result.user.uid,

                name,

                email,

                phone
            }
        );


        /* -----------------------------------------------------
           SUCCESS
           ----------------------------------------------------- */

        showMessage(
            '¡CUENTA CREADA EXITOSAMENTE!',
            'success'
        );


        registerForm.reset();


        /*
         * Firebase ya deja autenticado al usuario
         * después de createUserWithEmailAndPassword().
         */

        setTimeout(
            () => {

                closeAuthModal();

            },
            1500
        );


    } catch (error) {

        console.error(
            '[REGISTER] Error creando cuenta:',
            error
        );


        showMessage(
            friendlyAuthError(error),
            'error'
        );


    } finally {

        if (submitBtn) {

            submitBtn.disabled = false;

            submitBtn.textContent =
                originalButtonText;
        }

    }

});


/* =========================================================
   GOOGLE AUTH
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
         * IMPORTANTE:
         *
         * Google normalmente NO nos entrega el número.
         *
         * Por eso NO ponemos:
         *
         * phone: ''
         * phoneNumber: ''
         *
         * porque podríamos borrar el teléfono de un
         * usuario que ya lo tenga guardado.
         */


        await setDoc(
            doc(
                db,
                'users',
                result.user.uid
            ),
            {
                name:
                    result.user.displayName ||
                    '',

                email:
                    result.user.email ||
                    '',

                photoURL:
                    result.user.photoURL ||
                    '',

                provider:
                    'google',

                updatedAt:
                    serverTimestamp()
            },
            {
                merge: true
            }
        );


        console.log(
            '[GOOGLE AUTH] Usuario sincronizado con Firestore:',
            result.user.uid
        );


        closeAuthModal();


    } catch (error) {

        console.error(
            '[GOOGLE AUTH] Error:',
            error
        );


        showMessage(
            friendlyAuthError(error)
        );

    }

}


/* =========================================================
   GOOGLE BUTTONS
   ========================================================= */

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