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

const RIG_ICON = "FIREBASE_TIMON_ICON"

const state = {
  user: null,
  type: "standard",
  price: 200,
  date: "",
  time: "",
  rig: "Rig#1",
  rigs: []
}

const typeCards = document.querySelectorAll(".type-card")
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
    { id: "rig7", name: "Rig#4", type: "standard", active: true },
        { id: "rig8", name: "Rig#4", type: "standard", active: true },


  { id: "premium1", name: "Premium 1", type: "premium", active: true },
  { id: "premium2", name: "Premium 2", type: "premium", active: true }
]

function updateSummary() {
  const label = state.type === "premium" ? "Premium" : "Standard"

  summaryTitle.textContent = `${label} - ${state.rig}`
  summaryDate.textContent = `${state.date || "Fecha"} · ${state.time || "Hora"}`
  summaryPrice.textContent = `L ${state.price}.00`
  reserveBtn.textContent = `Reservar L ${state.price}.00`
}

async function loadRigs() {
  const snapshot = await get(ref(db, "admin/simulators"))

  if (snapshot.exists()) {
    state.rigs = Object.values(snapshot.val())
  } else {
    state.rigs = defaultRigs
  }

  renderRigs()
}

function renderRigs() {
  rigGrid.innerHTML = ""

  const filtered = state.rigs.filter((rig) => rig.type === state.type)

  filtered.forEach((rig) => {
    const card = document.createElement("button")

    card.className = "rig-card"

    if (!rig.active) {
      card.classList.add("disabled")
    }

    if (state.rig === rig.name) {
      card.classList.add("active")
    }

    card.innerHTML = `
      <img src="${RIG_ICON}" alt="">
      <span>${rig.name}</span>
    `

    card.addEventListener("click", () => {
      state.rig = rig.name
      renderRigs()
      updateSummary()
    })

    rigGrid.appendChild(card)
  })

  const firstActive = filtered.find((rig) => rig.active)

  if (firstActive && !filtered.some((rig) => rig.name === state.rig)) {
    state.rig = firstActive.name
    updateSummary()
  }
}

typeCards.forEach((card) => {
  card.addEventListener("click", () => {
    typeCards.forEach((item) => item.classList.remove("active"))
    card.classList.add("active")

    state.type = card.dataset.type
    state.price = Number(card.dataset.price)

    renderRigs()
    updateSummary()
  })
})

dateInput.addEventListener("change", () => {
  state.date = dateInput.value
  updateSummary()
})

timeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    timeButtons.forEach((btn) => btn.classList.remove("active"))
    button.classList.add("active")

    state.time = button.textContent.trim()
    updateSummary()
  })
})

reserveBtn.addEventListener("click", async () => {
  if (!state.user) {
    alert("Inicia sesión para reservar.")
    return
  }

  if (!state.date || !state.time || !state.rig) {
    alert("Selecciona fecha, hora y simulador.")
    return
  }

  const bookingRef = push(ref(db, "bookings"))

  await set(bookingRef, {
    uid: state.user.uid,
    name: state.user.displayName || "Piloto",
    email: state.user.email,
    type: state.type,
    price: state.price,
    date: state.date,
    time: state.time,
    rig: state.rig,
    status: "pending",
    createdAt: Date.now()
  })

  alert("Reserva creada.")
})

onAuthStateChanged(auth, (user) => {
  state.user = user
})

loadRigs()
updateSummary()