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
        console.error(
            'Error configurando persistencia:',
            error
        );
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


authModalClose?.addEventListener(
    'click',
    closeAuthModal
);


authModalBackdrop?.addEventListener(
    'click',
    closeAuthModal
);


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


/* =========================================================
   FRIENDLY FIREBASE ERRORS
   ========================================================= */

function friendlyAuthError(error) {
    switch (error?.code) {

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

        case 'auth/network-request-failed':
            return 'Error de conexión. Revisa tu internet e intenta nuevamente.';

        default:
            console.error(
                'Firebase Auth error:',
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
            user.photoURL || DEFAULT_PFP;

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
            profileMenuName.textContent =
                'USUARIO';
        }

        if (profileMenuEmail) {
            profileMenuEmail.textContent =
                '';
        }

        authBtn?.classList.remove('logged-in');

        closeProfileMenu();
    }
});


/* =========================================================
   LOGIN
   ========================================================= */

loginForm?.addEventListener(
    'submit',
    async (event) => {

        event.preventDefault();

        hideMessage();

        const email =
            document
                .getElementById('loginEmail')
                ?.value
                .trim();

        const password =
            document
                .getElementById('loginPassword')
                ?.value;

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

        const originalText =
            submitBtn?.textContent ||
            'INICIAR SESIÓN';

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent =
                'INICIANDO SESIÓN...';
        }

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

            loginForm.reset();

            closeAuthModal();

        } catch (error) {

            console.error(
                '[LOGIN]',
                error
            );

            showMessage(
                friendlyAuthError(error)
            );

        } finally {

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent =
                    originalText;
            }
        }
    }
);


/* =========================================================
   REGISTER
   ========================================================= */

registerForm?.addEventListener(
    'submit',
    async (event) => {

        event.preventDefault();

        hideMessage();


        /* =========================
           GET INPUTS
           ========================= */

        const nameInput =
            document.getElementById(
                'registerName'
            );

        const emailInput =
            document.getElementById(
                'registerEmail'
            );

        const phoneInput =
            document.getElementById(
                'registerPhone'
            );

        const passwordInput =
            document.getElementById(
                'registerPassword'
            );

        const passwordConfirmInput =
            document.getElementById(
                'registerPasswordConfirm'
            );


        if (
            !nameInput ||
            !emailInput ||
            !phoneInput ||
            !passwordInput ||
            !passwordConfirmInput
        ) {
            console.error(
                '[REGISTER] Faltan inputs en el HTML.'
            );

            showMessage(
                'Error interno del formulario.'
            );

            return;
        }


        const name =
            nameInput.value.trim();

        const email =
            emailInput.value.trim();

        const phone =
            phoneInput.value.trim();

        const password =
            passwordInput.value;

        const passwordConfirm =
            passwordConfirmInput.value;


        /* =========================
           VALIDATION
           ========================= */

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


        if (password !== passwordConfirm) {
            showMessage(
                'Las contraseñas no coinciden.'
            );

            return;
        }


        /* =========================
           BUTTON
           ========================= */

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

            /* =========================
               PERSISTENCE
               ========================= */

            console.log(
                '[REGISTER] Configurando persistencia...'
            );

            await setPersistence(
                auth,
                browserLocalPersistence
            );


            /* =========================
               CREATE AUTH USER
               ========================= */

            

            const result =
                await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password
                );


  

            /* =========================
               UPDATE AUTH PROFILE
               ========================= */

            try {



                await updateProfile(
                    result.user,
                    {
                        displayName: name
                    }
                );

   
            } catch (profileError) {

                /*
                 * The account already exists at this point.
                 * A profile error should not make the UI
                 * pretend account creation failed.
                 */


            }


            /* =========================
               FIRESTORE USER PROFILE
               ========================= */



            /*
             * IMPORTANT:
             *
             * We intentionally do NOT block successful
             * account creation forever waiting for Firestore.
             *
             * If Firestore works, the profile is saved.
             * If it errors, we log the error.
             * If it hangs, the UI continues after timeout.
             */

            const firestoreSave =
                setDoc(
                    doc(
                        db,
                        'users',
                        result.user.uid
                    ),
                    {
                        name,
                        email,
                        phoneNumber: phone,
                        provider: 'password',
                        createdAt:
                            serverTimestamp()
                    },
                    {
                        merge: true
                    }
                );


            const firestoreTimeout =
                new Promise((resolve) => {

                    setTimeout(() => {
                        resolve('timeout');
                    }, 5000);

                });


            try {

                const firestoreResult =
                    await Promise.race([
                        firestoreSave,
                        firestoreTimeout
                    ]);


                if (
                    firestoreResult ===
                    'timeout'
                ) {


                } else {

                    console.log(
                        'Saved.'
                    );
                }

            } catch (firestoreError) {

                /*
                 * Don't tell the user account creation
                 * failed — Firebase Auth already created it.
                 */

                console.error(
                    '[REGISTER] Error de Firestore:',
                    firestoreError
                );
            }


            /* =========================
               SUCCESS
               ========================= */

            console.log(
                '[REGISTER] Registro completado.'
            );

            showMessage(
                '¡CUENTA CREADA EXITOSAMENTE!',
                'success'
            );


            registerForm.reset();


            /*
             * updateProfile() doesn't always cause another
             * onAuthStateChanged event by itself, so update
             * the visible account information immediately.
             */

            if (profileMenuName) {
                profileMenuName.textContent =
                    name;
            }

            if (profileMenuEmail) {
                profileMenuEmail.textContent =
                    email;
            }

            if (profileMenuPfp) {
                profileMenuPfp.src =
                    result.user.photoURL ||
                    DEFAULT_PFP;
            }

            if (authPfp) {
                authPfp.src =
                    result.user.photoURL ||
                    DEFAULT_PFP;
            }


            /*
             * Leave success visible briefly.
             */

            setTimeout(() => {
                closeAuthModal();
            }, 1500);


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
    }
);


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
         * Google login itself succeeded at this point.
         *
         * Firestore profile saving is secondary and should
         * not prevent the user from being logged in.
         */

        try {

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
                        'google'
                },
                {
                    merge: true
                }
            );

        } catch (firestoreError) {

            console.error(
                '[GOOGLE] Error guardando usuario en Firestore:',
                firestoreError
            );
        }


        closeAuthModal();


    } catch (error) {

        console.error(
            '[GOOGLE AUTH]',
            error
        );


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

logoutBtn?.addEventListener(
    'click',
    async () => {

        if (!logoutBtn) return;

        const originalText =
            logoutBtn.textContent;

        logoutBtn.disabled = true;
        logoutBtn.textContent =
            'CERRANDO SESIÓN...';


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
            logoutBtn.textContent =
                originalText;
        }
    }
);