import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {

  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup


} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
const provider =
  new GoogleAuthProvider()

document
  .getElementById("google-login")
  .onclick = async () => {

    await signInWithPopup(
      auth,
      provider
    )

    overlay.classList.add(
      "hidden-auth"
    )

}
const firebaseConfig = {

  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY,

  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,

  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID,

  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,

  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,

  appId:
    import.meta.env.VITE_FIREBASE_APP_ID

}

const app =
  initializeApp(firebaseConfig)

const auth =
  getAuth(app)

const overlay =
  document.getElementById("auth-overlay")

const openAuth =
  document.getElementById("open-auth")

const closeAuth =
  document.getElementById("close-auth")

const loginTab =
  document.getElementById("login-tab")

const registerTab =
  document.getElementById("register-tab")

const loginForm =
  document.getElementById("login-form")

const registerForm =
  document.getElementById("register-form")

openAuth.onclick = () => {

  overlay.classList.remove("hidden-auth")
}

closeAuth.onclick = () => {

  overlay.classList.add("hidden-auth")
}

loginTab.onclick = () => {

  loginTab.classList.add("active-tab")

  registerTab.classList.remove("active-tab")

  loginForm.classList.remove("hidden-auth")

  registerForm.classList.add("hidden-auth")
}

registerTab.onclick = () => {

  registerTab.classList.add("active-tab")

  loginTab.classList.remove("active-tab")

  registerForm.classList.remove("hidden-auth")

  loginForm.classList.add("hidden-auth")
}

document
  .getElementById("register-btn")
  .onclick = async () => {

    const name =
      document.getElementById("register-name").value

    const email =
      document.getElementById("register-email").value

    const password =
      document.getElementById("register-password").value

    const cred =
      await createUserWithEmailAndPassword(
        auth,
        email,
        password
      )

    await updateProfile(
      cred.user,
      {
        displayName: name
      }
    )

    await sendEmailVerification(
      cred.user
    )

    alert(
      "Verificación enviada al correo."
    )

}

document
  .getElementById("login-btn")
  .onclick = async () => {

    const email =
      document.getElementById("login-email").value

    const password =
      document.getElementById("login-password").value

    const cred =
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      )

    if (!cred.user.emailVerified) {

      alert(
        "Verifica tu correo primero."
      )

      return
    }

    overlay.classList.add("hidden-auth")
}

onAuthStateChanged(auth, (user) => {

  if (user) {

    document
      .getElementById("open-auth")
      .style.display = "none"
  }

})