import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

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

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getDatabase(app)

const profilePhoto = document.getElementById("profile-photo")
const profileName = document.getElementById("profile-name")
const profileEmail = document.getElementById("profile-email")
const photoInput = document.getElementById("photo-input")
const phoneInput = document.getElementById("phone-input")
const saveProfile = document.getElementById("save-profile")
const recordsContainer = document.getElementById("profile-records")

const COLUMNAS = {
  nombre: 2,
  genero: 5,
  tiempo: 7
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function parseTime(time) {
  if (!time) return Infinity

  const parts = String(time).trim().split(":")
  if (parts.length !== 2) return Infinity

  const minutes = Number(parts[0])
  const seconds = Number(parts[1])

  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return Infinity

  return minutes * 60 + seconds
}

async function loadRecordsForUser(displayName) {
  const response = await fetch("/api/standings")
  const data = await response.json()

  if (!data.values) return

  const targetName = normalizeName(displayName)

  const records = data.values
    .filter((row) => {
      const sheetName = normalizeName(row[COLUMNAS.nombre])
      return sheetName === targetName
    })
    .map((row) => ({
      nombre: row[COLUMNAS.nombre],
      genero: row[COLUMNAS.genero] || "-",
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
    const row = document.createElement("div")

    row.classList.add("record-row")

    row.innerHTML = `
      <span>#${index + 1}</span>
      <span>Formula 1 Canadá</span>
      <span class="record-time">${record.tiempo}</span>
      <span>${record.genero}</span>
    `

    recordsContainer.appendChild(row)
  })
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/"
    return
  }

  const userRef = ref(db, `users/${user.uid}`)
  const snapshot = await get(userRef)

  const savedData = snapshot.exists()
    ? snapshot.val()
    : {}

  const displayName =
    savedData.name || user.displayName || "Piloto"

  const photo =
    savedData.photoURL || user.photoURL || "/assets/default-user.png"

  const phone =
    savedData.phone || ""

  profileName.textContent = displayName
  profileEmail.textContent = user.email || "Sin correo"
  profilePhoto.src = photo
  photoInput.value = photo
  phoneInput.value = phone

  await loadRecordsForUser(displayName)

  saveProfile.addEventListener("click", async () => {
    const newPhoto = photoInput.value.trim()
    const newPhone = phoneInput.value.trim()

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

    profilePhoto.src = newPhoto || "/assets/default-user.png"

    alert("Perfil actualizado.")
  })
})