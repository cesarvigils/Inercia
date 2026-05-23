import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
import { getDatabase, ref, get, push, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"

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

const RIG_ICON =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49"

const MAX_RIGS = 10
const HNL_TO_USD_RATE = 26

const state = {
  user: null,
  userProfile: null,
  date: "",
  timesSelected: [],
  rigsSelected: [],
  rigs: [],
  paymentMethod: "cash",
  paypalPaid: false,
  paypalOrderId: null,
  paypalDetails: null
}

let bankProofFile = null

const dateInput =
  document.getElementById("booking-date")

const timeButtons =
  document.querySelectorAll(
    "#time-slots button"
  )

const rigGrid =
  document.getElementById("rig-grid")

const reserveBtn =
  document.getElementById("reserve-btn")

const summaryTitle =
  document.getElementById("summary-title")

const summaryDate =
  document.getElementById("summary-date")

const summaryPrice =
  document.getElementById("summary-price")

const paymentCards =
  document.querySelectorAll(".payment-card")

const paymentExtra =
  document.getElementById("payment-extra")

const defaultRigs = [
  {
    id: "rig1",
    name: "Rig#1",
    type: "standard",
    active: true
  },
  {
    id: "rig2",
    name: "Rig#2",
    type: "standard",
    active: true
  },
  {
    id: "rig3",
    name: "Rig#3",
    type: "standard",
    active: true
  },
  {
    id: "rig4",
    name: "Rig#4",
    type: "standard",
    active: true
  },
  {
    id: "rig5",
    name: "Rig#5",
    type: "standard",
    active: true
  },
  {
    id: "rig6",
    name: "Rig#6",
    type: "standard",
    active: true
  },
  {
    id: "rig7",
    name: "Rig#7",
    type: "standard",
    active: true
  },
  {
    id: "rig8",
    name: "Rig#8",
    type: "standard",
    active: true
  },
  {
    id: "premium1",
    name: "Premium 1",
    type: "premium",
    active: true
  },
  {
    id: "premium2",
    name: "Premium 2",
    type: "premium",
    active: true
  }
]

function getUserName() {
  return (
    state.userProfile?.name ||
    state.user?.displayName ||
    "Piloto"
  )
}

function getRigPrice(rig) {
  return rig.type === "premium"
    ? 350
    : 200
}

function getSelectedRigDetails() {
  return state.rigs
    .filter((rig) =>
      state.rigsSelected.includes(rig.name)
    )
    .map((rig) => ({
      id: rig.id,
      name: rig.name,
      type: rig.type,
      price: getRigPrice(rig)
    }))
}

function getSubtotalPerHour() {
  return getSelectedRigDetails()
    .reduce(
      (total, rig) =>
        total + rig.price,
      0
    )
}

function getTotalHNL() {
  const hoursCount =
    state.timesSelected.length || 1

  return (
    getSubtotalPerHour() *
    hoursCount
  )
}

function getTotalUSD() {
  return Number(
    getTotalHNL() /
    HNL_TO_USD_RATE
  ).toFixed(2)
}

function formatPrice(price) {
  return `L ${Number(price).toFixed(2)}`
}

function resetPaymentState() {
  state.paypalPaid = false
  state.paypalOrderId = null
  state.paypalDetails = null
}

function updateSummary() {

  const rigsText =
    state.rigsSelected.length
      ? state.rigsSelected.join(", ")
      : "Seleccioná simuladores"

  const timesText =
    state.timesSelected.length
      ? state.timesSelected.join(", ")
      : "Hora"

  const total =
    getTotalHNL()

  if (summaryTitle) {
    summaryTitle.textContent =
      rigsText
  }

  if (summaryDate) {
    summaryDate.textContent =
      `${getUserName()} · ${state.date || "Fecha"} · ${timesText}`
  }

  if (summaryPrice) {
    summaryPrice.textContent =
      formatPrice(total)
  }

  if (reserveBtn) {
    reserveBtn.textContent =
      `Reservar ${formatPrice(total)}`
  }

  if (
    state.paymentMethod === "card"
  ) {
    renderPaymentUI()
  }
}

async function loadUserProfile(user) {

  const snapshot =
    await get(
      ref(
        db,
        `users/${user.uid}`
      )
    )

  const profile =
    snapshot.exists()
      ? snapshot.val()
      : {}

  state.userProfile =
    profile

  if (!profile.phone) {

    alert(
      "Antes de reservar, agrega tu número de teléfono en tu perfil."
    )

    window.location.href =
      "/perfil"

    return
  }

  updateSummary()
}

async function loadRigs() {

  try {

    const snapshot =
      await get(
        ref(
          db,
          "admin/simulators"
        )
      )

    state.rigs =
      snapshot.exists()
        ? Object.values(snapshot.val())
        : defaultRigs

  } catch (error) {

    console.error(error)

    state.rigs =
      defaultRigs
  }

  renderRigs()
}

function toggleRig(rigName) {

  if (
    state.rigsSelected.includes(
      rigName
    )
  ) {

    state.rigsSelected =
      state.rigsSelected.filter(
        (name) =>
          name !== rigName
      )

    resetPaymentState()

    return
  }

  if (
    state.rigsSelected.length >=
    MAX_RIGS
  ) {

    alert(
      `Máximo ${MAX_RIGS} simuladores por reserva.`
    )

    return
  }

  state.rigsSelected.push(
    rigName
  )

  resetPaymentState()
}

function renderRigs() {

  if (!rigGrid) return

  rigGrid.innerHTML = ""

  state.rigs.forEach((rig) => {

    const card =
      document.createElement(
        "button"
      )

    card.type = "button"

    card.className =
      "rig-card"

    if (!rig.active) {
      card.classList.add(
        "disabled"
      )
    }

    if (
      state.rigsSelected.includes(
        rig.name
      )
    ) {
      card.classList.add(
        "active"
      )
    }

    card.innerHTML = `
      <img src="${RIG_ICON}" alt="">
      <span>${rig.name}</span>
      <small>${formatPrice(getRigPrice(rig))} / hora</small>
    `

    card.addEventListener(
      "click",
      () => {

        if (!rig.active) {
          return
        }

        toggleRig(
          rig.name
        )

        renderRigs()
        updateSummary()
      }
    )

    rigGrid.appendChild(
      card
    )
  })

  updateSummary()
}

function isBookingReadyForPayment() {

  return Boolean(
    state.user &&
    state.userProfile?.phone &&
    state.date &&
    state.timesSelected.length &&
    state.rigsSelected.length &&
    getTotalHNL() > 0
  )
}

function renderPaymentUI() {

  if (!paymentExtra) {
    return
  }

  if (
    state.paymentMethod ===
    "cash"
  ) {

    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Pagás al llegar al local.
      </div>
    `

    return
  }

  if (
    state.paymentMethod ===
    "bank"
  ) {

    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Transferí a una de nuestras cuentas y subí tu comprobante. Es obligatorio.
      </div>

      <button id="open-bank-modal" class="reserve-confirm" type="button">
        Ver cuentas bancarias
      </button>

      <input
        id="bank-proof"
        class="bank-proof"
        type="file"
        accept="image/*,.pdf"
        hidden>

      <button id="upload-proof-btn" class="reserve-confirm" type="button">
        Subir comprobante
      </button>

      <p id="proof-file-name" class="payment-placeholder">
        Ningún archivo seleccionado.
      </p>
    `

    setupBankProofUI()
    setupBankModalUI()

    return
  }

  if (
    state.paymentMethod ===
    "card"
  ) {

    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Total: ${formatPrice(getTotalHNL())}
        <br>
        PayPal cobrará en Dólares Americanos.
      </div>

      <div id="paypal-button-container" class="paypal-button-container"></div>
    `

    waitForPayPalAndRender()
  }
}

// ... RESTO DEL CÓDIGO IGUAL ...

loadRigs()
renderPaymentUI()
updateSummary()

if (dateInput) {

  dateInput.addEventListener(
    "change",
    (event) => {

      state.date =
        event.target.value

      resetPaymentState()
      updateSummary()
    }
  )
}

timeButtons.forEach(
  (button) => {

    button.type = "button"

    button.addEventListener(
      "click",
      () => {

        const value =
          button.dataset.time ||
          button.textContent.trim()

        if (
          state.timesSelected.includes(
            value
          )
        ) {

          state.timesSelected =
            state.timesSelected.filter(
              (time) =>
                time !== value
            )

          button.classList.remove(
            "active"
          )

        } else {

          state.timesSelected.push(
            value
          )

          button.classList.add(
            "active"
          )
        }

        resetPaymentState()
        updateSummary()
      }
    )
  }
)

paymentCards.forEach(
  (card) => {

    card.type = "button"

    card.addEventListener(
      "click",
      () => {

        const method =
          card.dataset.payment

        if (!method) {
          return
        }

        state.paymentMethod =
          method

        paymentCards.forEach(
          (item) => {
            item.classList.remove(
              "active"
            )
          }
        )

        card.classList.add(
          "active"
        )

        resetPaymentState()

        renderPaymentUI()
        updateSummary()
      }
    )
  }
)

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) {
      return
    }

    state.user = user

    try {

      await loadUserProfile(
        user
      )

    } catch (error) {

      console.error(error)
    }
  }
)