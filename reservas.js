import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"

import {
  getDatabase,
  ref,
  get,
  push,
  set
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

const RIG_ICON =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49"

const MAX_RIGS = 10

const state = {
  user: null,
  userProfile: null,
  date: "",
  time: "",
  rigsSelected: [],
  rigs: []
}

const dateInput = document.getElementById("booking-date")
const timeButtons = document.querySelectorAll("#time-slots button")
const rigGrid = document.getElementById("rig-grid")
const reserveBtn = document.getElementById("reserve-btn")
const summaryTitle = document.getElementById("summary-title")
const summaryDate = document.getElementById("summary-date")
const summaryPrice = document.getElementById("summary-price")

const defaultRigs = [
  { id: "rig1", name: "Rig#1", type: "standard", active: true },
  { id: "rig2", name: "Rig#2", type: "standard", active: true },
  { id: "rig3", name: "Rig#3", type: "standard", active: true },
  { id: "rig4", name: "Rig#4", type: "standard", active: true },
  { id: "rig5", name: "Rig#5", type: "standard", active: true },
  { id: "rig6", name: "Rig#6", type: "standard", active: true },
  { id: "rig7", name: "Rig#7", type: "standard", active: true },
  { id: "rig8", name: "Rig#8", type: "standard", active: true },
  { id: "premium1", name: "Premium 1", type: "premium", active: true },
  { id: "premium2", name: "Premium 2", type: "premium", active: true }
]

function getUserName() {
  return (
    state.userProfile?.name ||
    state.user?.displayName ||
    "Piloto"
  )
}

function getRigPrice(rig) {
  return rig.type === "premium" ? 350 : 200
}

function getTotal() {
  return state.rigsSelected.reduce((total, rigName) => {
    const rig = state.rigs.find((item) => item.name === rigName)

    if (!rig) {
      return total
    }

    return total + getRigPrice(rig)
  }, 0)
}

function formatPrice(price) {
  return `L ${Number(price).toFixed(2)}`
}

function updateSummary() {
  const rigsText =
    state.rigsSelected.length
      ? state.rigsSelected.join(", ")
      : "Seleccioná simuladores"

  const total =
    getTotal()

  if (summaryTitle) {
    summaryTitle.textContent = rigsText
  }

  if (summaryDate) {
    summaryDate.textContent =
      `${getUserName()} · ${state.date || "Fecha"} · ${state.time || "Hora"}`
  }

  if (summaryPrice) {
    summaryPrice.textContent =
      formatPrice(total)
  }

  if (reserveBtn) {
    reserveBtn.textContent =
      `Reservar ${formatPrice(total)}`
  }
}

async function loadUserProfile(user) {
  const snapshot =
    await get(ref(db, `users/${user.uid}`))

  const profile =
    snapshot.exists()
      ? snapshot.val()
      : {}

  state.userProfile = profile

  if (!profile.phone) {
    alert("Antes de reservar, agrega tu número de teléfono en tu perfil.")
    window.location.href = "/perfil"
    return
  }

  updateSummary()
}

async function loadRigs() {
  try {
    const snapshot =
      await get(ref(db, "admin/simulators"))

    state.rigs =
      snapshot.exists()
        ? Object.values(snapshot.val())
        : defaultRigs
  } catch (error) {
    console.error(error)
    state.rigs = defaultRigs
  }

  renderRigs()
}

function toggleRig(rigName) {
  if (state.rigsSelected.includes(rigName)) {
    state.rigsSelected =
      state.rigsSelected.filter((name) => name !== rigName)

    return
  }

  if (state.rigsSelected.length >= MAX_RIGS) {
    alert(`Máximo ${MAX_RIGS} simuladores por reserva.`)
    return
  }

  state.rigsSelected.push(rigName)
}

function renderRigs() {
  if (!rigGrid) return

  rigGrid.innerHTML = ""

  state.rigs.forEach((rig) => {
    const card =
      document.createElement("button")

    card.className =
      "rig-card"

    if (!rig.active) {
      card.classList.add("disabled")
    }

    if (state.rigsSelected.includes(rig.name)) {
      card.classList.add("active")
    }

    const price =
      getRigPrice(rig)

    card.innerHTML = `
      <img src="${RIG_ICON}" alt="">
      <span>${rig.name}</span>
      <small>${formatPrice(price)}</small>
    `

    card.addEventListener("click", () => {
      if (!rig.active) return

      toggleRig(rig.name)
      renderRigs()
      updateSummary()
    })

    rigGrid.appendChild(card)
  })

  updateSummary()
}

if (dateInput) {
  dateInput.addEventListener("change", () => {
    state.date =
      dateInput.value

    updateSummary()
  })
}

timeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    timeButtons.forEach((btn) =>
      btn.classList.remove("active")
    )

    button.classList.add("active")

    state.time =
      button.textContent.trim()

    updateSummary()
  })
})

if (reserveBtn) {
  reserveBtn.addEventListener("click", async () => {
    if (!state.user) {
      alert("Inicia sesión para reservar.")
      return
    }

    if (!state.userProfile?.phone) {
      alert("Tu número de teléfono es obligatorio para reservar.")
      window.location.href = "/perfil"
      return
    }

    if (!state.date || !state.time || !state.rigsSelected.length) {
      alert("Selecciona fecha, hora y al menos un simulador.")
      return
    }

    try {
      reserveBtn.disabled = true
      reserveBtn.textContent = "Reservando..."

      const selectedRigDetails =
        state.rigs
          .filter((rig) => state.rigsSelected.includes(rig.name))
          .map((rig) => ({
            id: rig.id,
            name: rig.name,
            type: rig.type,
            price: getRigPrice(rig)
          }))

      const bookingRef =
        push(ref(db, "bookings"))

      await set(bookingRef, {
        uid: state.user.uid,
        name: getUserName(),
        email: state.user.email,
        phone: state.userProfile.phone,
        rigs: state.rigsSelected,
        rigDetails: selectedRigDetails,
        rigsCount: state.rigsSelected.length,
        total: getTotal(),
        date: state.date,
        time: state.time,
        status: "pending",
        createdAt: Date.now()
      })

      alert(`Reserva creada para ${getUserName()}.`)
    } catch (error) {
      console.error(error)
      alert("No se pudo crear la reserva.")
    } finally {
      reserveBtn.disabled = false
      updateSummary()
    }
  })
}

onAuthStateChanged(auth, async (user) => {
  state.user = user

  if (!user) {
    updateSummary()
    return
  }

  await loadUserProfile(user)
})

loadRigs()
updateSummary()