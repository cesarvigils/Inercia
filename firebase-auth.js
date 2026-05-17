import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

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

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const provider = new GoogleAuthProvider()

const overlay = document.getElementById("auth-overlay")
const openAuth = document.getElementById("open-auth")
const closeAuth = document.getElementById("close-auth")
const loginTab = document.getElementById("login-tab")
const registerTab = document.getElementById("register-tab")
const loginForm = document.getElementById("login-form")
const registerForm = document.getElementById("register-form")
const googleLogin = document.getElementById("google-login")
const registerBtn = document.getElementById("register-btn")
const loginBtn = document.getElementById("login-btn")

if (openAuth && overlay) {
  openAuth.addEventListener("click", () => {
    overlay.classList.remove("hidden-auth")
  })
}

if (closeAuth && overlay) {
  closeAuth.addEventListener("click", () => {
    overlay.classList.add("hidden-auth")
  })
}

if (loginTab && registerTab && loginForm && registerForm) {
  loginTab.addEventListener("click", () => {
    loginTab.classList.add("active-tab")
    registerTab.classList.remove("active-tab")
    loginForm.classList.remove("hidden-auth")
    registerForm.classList.add("hidden-auth")
  })

  registerTab.addEventListener("click", () => {
    registerTab.classList.add("active-tab")
    loginTab.classList.remove("active-tab")
    registerForm.classList.remove("hidden-auth")
    loginForm.classList.add("hidden-auth")
  })
}

if (googleLogin && overlay) {
  googleLogin.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider)
      overlay.classList.add("hidden-auth")
    } catch (error) {
      console.error(error)
      alert("No se pudo iniciar sesión con Google.")
    }
  })
}

if (registerBtn) {
  registerBtn.addEventListener("click", async () => {
    try {
      const name = document.getElementById("register-name").value
      const email = document.getElementById("register-email").value
      const password = document.getElementById("register-password").value

      const cred = await createUserWithEmailAndPassword(auth, email, password)

      await updateProfile(cred.user, {
        displayName: name
      })

      await sendEmailVerification(cred.user)

      alert("Verificación enviada al correo.")
    } catch (error) {
      console.error(error)
      alert("No se pudo crear la cuenta.")
    }
  })
}

if (loginBtn && overlay) {
  loginBtn.addEventListener("click", async () => {
    try {
      const email = document.getElementById("login-email").value
      const password = document.getElementById("login-password").value

      const cred = await signInWithEmailAndPassword(auth, email, password)

      if (!cred.user.emailVerified) {
        alert("Verifica tu correo primero.")
        return
      }

      overlay.classList.add("hidden-auth")
    } catch (error) {
      console.error(error)
      alert("No se pudo iniciar sesión.")
    }
  })
}

const profileTrigger = document.getElementById("profile-trigger")
const profileMenu = document.getElementById("profile-menu")
const logoutBtn = document.getElementById("logout-btn")

const navbarPfp = document.getElementById("navbar-pfp")
const profileMenuPfp = document.getElementById("profile-menu-pfp")
const profileMenuName = document.getElementById("profile-menu-name")
const profileMenuEmail = document.getElementById("profile-menu-email")
const profileMenuPhone = document.getElementById("profile-menu-phone")

if (profileTrigger && profileMenu) {
  profileTrigger.addEventListener("click", () => {
    profileMenu.classList.toggle("hidden-auth")
  })
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth)
    window.location.reload()
  })
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    openAuth?.classList.add("hidden-auth")
    profileTrigger?.classList.remove("hidden-auth")

    const photo = user.photoURL || "/assets/default-user.png"

    if (navbarPfp) navbarPfp.src = photo
    if (profileMenuPfp) profileMenuPfp.src = photo

    if (profileMenuName) {
      profileMenuName.textContent = user.displayName || "Piloto"
    }

    if (profileMenuEmail) {
      profileMenuEmail.textContent = user.email || "Sin correo"
    }

    if (profileMenuPhone) {
      profileMenuPhone.textContent = user.phoneNumber || "Sin teléfono"
    }
  } else {
    openAuth?.classList.remove("hidden-auth")
    profileTrigger?.classList.add("hidden-auth")
    profileMenu?.classList.add("hidden-auth")
  }
})