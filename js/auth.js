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

function injectAuthMarkup() {

    if (!document.getElementById('authModal')) {
        document.body.insertAdjacentHTML('beforeend', `
<div class="auth-modal" id="authModal" aria-hidden="true">
  <div class="auth-modal-backdrop" id="authModalBackdrop"></div>
  <div class="auth-modal-panel" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
    <button class="auth-modal-close" id="authModalClose" type="button" aria-label="Cerrar">&times;</button>
    <div class="auth-modal-brand">
      <img src="https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Fsimuladoresinercia.png?alt=media&token=cc07fe5e-c3a0-449c-a474-8ba1ceb0a0be" alt="Simuladores Inercia">
    </div>
    <div class="auth-tabs">
      <button class="auth-tab active" type="button" data-auth-tab="login">INICIAR SESIÓN</button>
      <button class="auth-tab" type="button" data-auth-tab="register">REGISTRARSE</button>
    </div>
    <form class="auth-form active" id="loginForm">
      <div class="auth-heading">
        <h2 id="authModalTitle">BIENVENIDO</h2>
        <p>Inicia sesión en tu cuenta de Simuladores Inercia.</p>
      </div>
      <label class="auth-field">
        <span>CORREO ELECTRÓNICO</span>
        <input type="email" id="loginEmail" placeholder="correo@ejemplo.com" autocomplete="email" required>
      </label>
      <label class="auth-field">
        <span>CONTRASEÑA</span>
        <input type="password" id="loginPassword" placeholder="Tu contraseña" autocomplete="current-password" required>
      </label>
      <button class="auth-submit" type="submit">INICIAR SESIÓN</button>
      <div class="auth-divider"><span>O</span></div>
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41z"/>
          <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.54c-.9.6-2.05.96-3.4.96-2.6 0-4.81-1.76-5.6-4.13H3.05v2.62A10 10 0 0 0 12 22z"/>
          <path fill="#FBBC05" d="M6.4 13.86A6 6 0 0 1 6.08 12c0-.65.11-1.28.32-1.86V7.52H3.05A10 10 0 0 0 2 12c0 1.61.38 3.14 1.05 4.48l3.35-2.62z"/>
          <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.95 5.52l3.35 2.62C7.19 7.77 9.4 6.01 12 6.01z"/>
        </svg>
        CONTINUAR CON GOOGLE
      </button>
      <p class="auth-switch">¿No tienes una cuenta? <button type="button" data-switch-auth="register">REGÍSTRATE</button></p>
    </form>
    <form class="auth-form" id="registerForm">
      <div class="auth-heading">
        <h2>CREAR CUENTA</h2>
        <p>Regístrate para acceder a Simuladores Inercia.</p>
      </div>
      <label class="auth-field">
        <span>NOMBRE</span>
        <input type="text" id="registerName" placeholder="Tu nombre" autocomplete="name" required>
      </label>
      <label class="auth-field">
        <span>NÚMERO DE TELÉFONO</span>
        <input type="tel" id="registerPhone" placeholder="+504 9999-9999" autocomplete="tel" required>
      </label>
      <label class="auth-field">
        <span>CORREO ELECTRÓNICO</span>
        <input type="email" id="registerEmail" placeholder="correo@ejemplo.com" autocomplete="email" required>
      </label>
      <label class="auth-field">
        <span>CONTRASEÑA</span>
        <input type="password" id="registerPassword" placeholder="Mínimo 6 caracteres" autocomplete="new-password" minlength="6" required>
      </label>
      <label class="auth-field">
        <span>CONFIRMAR CONTRASEÑA</span>
        <input type="password" id="registerPasswordConfirm" placeholder="Repite tu contraseña" autocomplete="new-password" minlength="6" required>
      </label>
      <button class="auth-submit" type="submit">CREAR CUENTA</button>
      <p class="auth-switch">¿Ya tienes una cuenta? <button type="button" data-switch-auth="login">INICIA SESIÓN</button></p>
    </form>
    <p class="auth-message" id="authMessage"></p>
  </div>
</div>`);
    }

    if (!document.getElementById('profileMenu')) {
        document.body.insertAdjacentHTML('beforeend', `
<div class="profile-menu" id="profileMenu" aria-hidden="true">
  <div class="profile-menu-user">
    <img id="profileMenuPfp" src="" alt="Perfil">
    <div>
      <strong id="profileMenuName">USUARIO</strong>
      <span id="profileMenuEmail"></span>
    </div>
  </div>
  <button id="logoutBtn" type="button">CERRAR SESIÓN</button>
</div>`);
    }
}

injectAuthMarkup();


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
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Fdefaultpfp3.jpg?alt=media&token=a0435be5-f789-41ec-9d50-ab24fed4b9ec';

setPersistence(auth, browserLocalPersistence)
    .catch((error) => {
        console.error('Error configurando persistencia:', error);
    });


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




        await setPersistence(
            auth,
            browserLocalPersistence
        );


        /* -----------------------------------------------------
           CREATE AUTH ACCOUNT
           ----------------------------------------------------- */





        const result =
            await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );









        await updateProfile(
            result.user,
            {
                displayName: name
            }
        );


 


        /* -----------------------------------------------------
           FIRESTORE PROFILE

           IMPORTANTE:
           phone + phoneNumber se guardan ambos.
           ----------------------------------------------------- */



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