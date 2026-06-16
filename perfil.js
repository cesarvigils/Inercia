import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"

import {
  getAuth,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"

import {
  getDatabase,
  ref,
  set,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
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
const db = getDatabase(app)
const storage = getStorage(app)

const ICONO_T =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia.png?alt=media&token=d899b11c-1a91-42fc-9ded-58977ff60a6f"

const ICONO_S =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia.png?alt=media&token=d899b11c-1a91-42fc-9ded-58977ff60a6f"

const profilePhoto = document.getElementById("profile-photo")
const profileName = document.getElementById("profile-name")
const profileEmail = document.getElementById("profile-email")
const phoneInput = document.getElementById("phone-input")
const saveProfile = document.getElementById("save-profile")
const recordsContainer = document.getElementById("profile-records")
const photoUpload = document.getElementById("photo-upload")
const avatarBox = document.querySelector(".profile-avatar-box")

const COLUMNAS = {
  nombre: 2,
  genero: 5,
  tiempo: 7
}

let selectedFile = null
let currentPhoto = "/assets/default-user.png"
let saveHandlerAttached = false

function cleanDriverName(value) {
  return String(value || "")
    .replace(/\(T\)/gi, "")
    .replace(/\(S\)/gi, "")
    .trim()
}

function normalizeName(value) {
  return cleanDriverName(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function getCategoryIcon(nombre) {
  const clean =
    String(nombre || "").toUpperCase()

  if (clean.includes("(T)")) {
    return `
      <img
        src="${ICONO_T}"
        class="record-category-icon"
        alt="Team Inercia">
    `
  }

  if (clean.includes("(S)")) {
    return `
      <img
        src="${ICONO_S}"
        class="record-category-icon"
        alt="Special">
    `
  }

  return "-"
}

function parseTime(time) {
  if (!time) return Infinity

  const parts =
    String(time).trim().split(":")

  if (parts.length !== 2) return Infinity

  const minutes =
    Number(parts[0])

  const seconds =
    Number(parts[1])

  if (
    Number.isNaN(minutes) ||
    Number.isNaN(seconds)
  ) {
    return Infinity
  }

  return minutes * 60 + seconds
}

async function loadRecordsForUser(displayName) {
  if (!recordsContainer) return

  const response =
    await fetch("/api/standings")

  const data =
    await response.json()

  if (!data.values) return

  const targetName =
    normalizeName(displayName)

  const records =
    data.values
      .filter((row) => {
        const sheetName =
          normalizeName(row[COLUMNAS.nombre])

        return sheetName === targetName
      })
      .map((row) => ({
        nombre: row[COLUMNAS.nombre],
        categoria: getCategoryIcon(row[COLUMNAS.nombre]),
        tiempo: row[COLUMNAS.tiempo] || "-",
        parsedTime: parseTime(row[COLUMNAS.tiempo])
      }))
      .sort((a, b) => a.parsedTime - b.parsedTime)

  recordsContainer.innerHTML = ""

  if (!records.length) {
    recordsContainer.innerHTML = `
      <div class="empty-records">
        No hay records todavía para este perfil.
      </div>
    `
    return
  }

  records.forEach((record, index) => {
    const row =
      document.createElement("div")

    row.classList.add("record-row")

    row.innerHTML = `
      <span>#${index + 1}</span>
      <span>Circuit Gilles Villeneuve</span>
      <span class="record-time">${record.tiempo}</span>
      <span class="record-category">${record.categoria}</span>
    `

    recordsContainer.appendChild(row)
  })
}

function setupPhotoPicker() {
  if (!avatarBox || !photoUpload) return

  avatarBox.addEventListener("click", () => {
    photoUpload.click()
  })

  photoUpload.addEventListener("change", (event) => {
    const file =
      event.target.files[0]

    if (!file) return

    if (!file.type.startsWith("image/")) {
      alert("Selecciona una imagen válida.")
      return
    }

    selectedFile = file

    const reader =
      new FileReader()

    reader.onload = () => {
      if (profilePhoto) {
        profilePhoto.src = reader.result
      }
    }

    reader.readAsDataURL(file)
  })
}

async function uploadProfilePhoto(user) {
  if (!selectedFile) return currentPhoto

  const extension =
    selectedFile.name.split(".").pop() || "jpg"

  const imageRef =
    storageRef(
      storage,
      `profile-pictures/${user.uid}/profile.${extension}`
    )

  await uploadBytes(imageRef, selectedFile)

  return await getDownloadURL(imageRef)
}

setupPhotoPicker()

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/"
    return
  }

  const userRef =
    ref(db, `users/${user.uid}`)

  const snapshot =
    await get(userRef)

  const savedData =
    snapshot.exists()
      ? snapshot.val()
      : {}

  const displayName =
    savedData.name || user.displayName || "Piloto"

  currentPhoto =
    savedData.photoURL || user.photoURL || "/assets/default-user.png"

  const phone =
    savedData.phone || ""

  if (profileName) {
    profileName.textContent = displayName
  }

  if (profileEmail) {
    profileEmail.textContent = user.email || "Sin correo"
  }

  if (profilePhoto) {
    profilePhoto.src = currentPhoto
  }

  if (phoneInput) {
    phoneInput.value = phone
  }

  await loadRecordsForUser(displayName)

  if (!saveHandlerAttached && saveProfile) {
    saveHandlerAttached = true

    saveProfile.addEventListener("click", async () => {
      try {
        saveProfile.disabled = true
        saveProfile.textContent = "Guardando..."

        const newPhone =
          phoneInput ? phoneInput.value.trim() : ""

        const newPhoto =
          await uploadProfilePhoto(user)

        await set(userRef, {
          uid: user.uid,
          name: displayName,
          email: user.email,
          phone: newPhone,
          photoURL: newPhoto
        })

        await updateProfile(user, {
          photoURL: newPhoto
        })

        currentPhoto = newPhoto
        selectedFile = null

        if (profilePhoto) {
          profilePhoto.src =
            newPhoto || "/assets/default-user.png"
        }

        alert("Perfil actualizado.")
      } catch (error) {
        console.error(error)
        alert("No se pudo actualizar el perfil.")
      } finally {
        saveProfile.disabled = false
        saveProfile.textContent = "Guardar Perfil"
      }
    })
  }
})