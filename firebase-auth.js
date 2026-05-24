import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  GoogleAuthProvider,
  signOut,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

const app =
  getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)

const auth = getAuth(app)
const provider = new GoogleAuthProvider()

function getAuthEls() {
  return {
    overlay: document.getElementById("auth-overlay"),
    openAuth: document.getElementById("open-auth"),
    closeAuth: document.getElementById("close-auth"),
    loginTab: document.getElementById("login-tab"),
    registerTab: document.getElementById("register-tab"),
    loginForm: document.getElementById("login-form"),
    registerForm: document.getElementById("register-form"),
    googleLogin: document.getElementById("google-login"),
    registerBtn: document.getElementById("register-btn"),
    loginBtn: document.getElementById("login-btn"),
    profileTrigger: document.getElementById("profile-trigger"),
    profileMenu: document.getElementById("profile-menu"),
    logoutBtn: document.getElementById("logout-btn"),
    navbarPfp: document.getElementById("navbar-pfp"),
    profileMenuPfp: document.getElementById("profile-menu-pfp"),
    profileMenuName: document.getElementById("profile-menu-name"),
    profileMenuEmail: document.getElementById("profile-menu-email"),
    profileMenuPhone: document.getElementById("profile-menu-phone")
  }
}

function initAuthUI() {
  const el = getAuthEls()

  if (el.openAuth && el.overlay) {
    el.openAuth.onclick = () => {
      el.overlay.classList.remove("hidden-auth")
    }
  }

  if (el.closeAuth && el.overlay) {
    el.closeAuth.onclick = () => {
      el.overlay.classList.add("hidden-auth")
    }
  }

  if (el.loginTab && el.registerTab && el.loginForm && el.registerForm) {
    el.loginTab.onclick = () => {
      el.loginTab.classList.add("active-tab")
      el.registerTab.classList.remove("active-tab")
      el.loginForm.classList.remove("hidden-auth")
      el.registerForm.classList.add("hidden-auth")
    }

    el.registerTab.onclick = () => {
      el.registerTab.classList.add("active-tab")
      el.loginTab.classList.remove("active-tab")
      el.registerForm.classList.remove("hidden-auth")
      el.loginForm.classList.add("hidden-auth")
    }
  }

  if (el.googleLogin && el.overlay) {
    el.googleLogin.onclick = async () => {
      try {
        await signInWithPopup(auth, provider)
        el.overlay.classList.add("hidden-auth")
      } catch (error) {
        console.error(error)
        alert("No se pudo iniciar sesión con Google.")
      }
    }
  }

  if (el.registerBtn) {
    el.registerBtn.onclick = async () => {
      try {
        const name = document.getElementById("register-name").value
        const email = document.getElementById("register-email").value
        const password = document.getElementById("register-password").value

        const cred =
          await createUserWithEmailAndPassword(auth, email, password)

        await updateProfile(cred.user, {
          displayName: name
        })

        await sendEmailVerification(cred.user)

        alert("Verificación enviada al correo.")
      } catch (error) {
        console.error(error)
        alert("No se pudo crear la cuenta.")
      }
    }
  }

  if (el.loginBtn && el.overlay) {
    el.loginBtn.onclick = async () => {
      try {
        const email = document.getElementById("login-email").value
        const password = document.getElementById("login-password").value

        const cred =
          await signInWithEmailAndPassword(auth, email, password)

        if (!cred.user.emailVerified) {
          alert("Verifica tu correo primero.")
          return
        }

        el.overlay.classList.add("hidden-auth")
      } catch (error) {
        console.error(error)
        alert("No se pudo iniciar sesión.")
      }
    }
  }

  if (el.profileTrigger && el.profileMenu) {
    el.profileTrigger.onclick = () => {
      el.profileMenu.classList.toggle("hidden-auth")
    }
  }

  if (el.logoutBtn) {
    el.logoutBtn.onclick = async () => {
      await signOut(auth)
      window.location.reload()
    }
  }

  onAuthStateChanged(auth, (user) => {
    const fresh = getAuthEls()

    if (user) {
      fresh.openAuth?.classList.add("hidden-auth")
      fresh.profileTrigger?.classList.remove("hidden-auth")

      const photo =
        user.photoURL || "/assets/default-user.png"

      if (fresh.navbarPfp) fresh.navbarPfp.src = photo
      if (fresh.profileMenuPfp) fresh.profileMenuPfp.src = photo
      if (fresh.profileMenuName) fresh.profileMenuName.textContent = user.displayName || "Piloto"
      if (fresh.profileMenuEmail) fresh.profileMenuEmail.textContent = user.email || "Sin correo"
      if (fresh.profileMenuPhone) fresh.profileMenuPhone.textContent = user.phoneNumber || "Sin teléfono"
    } else {
      fresh.openAuth?.classList.remove("hidden-auth")
      fresh.profileTrigger?.classList.add("hidden-auth")
      fresh.profileMenu?.classList.add("hidden-auth")
    }
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthUI)
} else {
  initAuthUI()
}