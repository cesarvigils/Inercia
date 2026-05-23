import {
  getApp,
  getApps,
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

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

const dateInput = document.getElementById("booking-date")
const timeButtons = document.querySelectorAll("#time-slots button")
const rigGrid = document.getElementById("rig-grid")
const reserveBtn = document.getElementById("reserve-btn")
const summaryTitle = document.getElementById("summary-title")
const summaryDate = document.getElementById("summary-date")
const summaryPrice = document.getElementById("summary-price")
const paymentCards = document.querySelectorAll(".payment-card")
const paymentExtra = document.getElementById("payment-extra")
let bankProofFile = null
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

function getSelectedRigDetails() {
  return state.rigs
    .filter((rig) => state.rigsSelected.includes(rig.name))
    .map((rig) => ({
      id: rig.id,
      name: rig.name,
      type: rig.type,
      price: getRigPrice(rig)
    }))
}

function getSubtotalPerHour() {
  return getSelectedRigDetails()
    .reduce((total, rig) => total + rig.price, 0)
}

function getTotalHNL() {
  const hoursCount =
    state.timesSelected.length || 1

  return getSubtotalPerHour() * hoursCount
}

function getTotalUSD() {
  return Number(getTotalHNL() / HNL_TO_USD_RATE).toFixed(2)
}

function formatPrice(price) {
  return `L ${Number(price).toFixed(2)}`
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

  const total = getTotalHNL()

  if (summaryTitle) {
    summaryTitle.textContent = rigsText
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
if (state.paymentMethod === "bank" && !bankProofFile) {
  alert("Subí el comprobante de transferencia para reservar.")
  return
}
  if (state.paymentMethod === "card") {
    renderPaymentUI()
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

function resetPaymentState() {
  state.paypalPaid = false
  state.paypalOrderId = null
  state.paypalDetails = null
}

function toggleRig(rigName) {
  if (state.rigsSelected.includes(rigName)) {
    state.rigsSelected =
      state.rigsSelected.filter((name) => name !== rigName)

    resetPaymentState()
    return
  }

  if (state.rigsSelected.length >= MAX_RIGS) {
    alert(`Máximo ${MAX_RIGS} simuladores por reserva.`)
    return
  }

  state.rigsSelected.push(rigName)
  resetPaymentState()
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
      <small>${formatPrice(price)} / hora</small>
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
  if (!paymentExtra) return

  if (state.paymentMethod === "cash") {
    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Pagás al llegar al local.
      </div>
    `
    return
  }

if (state.paymentMethod === "bank") {

  paymentExtra.innerHTML = `
    <div class="payment-placeholder">
      Transferí a una de nuestras cuentas y subí tu comprobante. Es obligatorio.
    </div>

    <button
      id="open-bank-modal"
      class="reserve-confirm"
      type="button">
      Ver cuentas bancarias
    </button>

    <input
      id="bank-proof"
      class="bank-proof"
      type="file"
      accept="image/*,.pdf"
      hidden>

    <button
      id="upload-proof-btn"
      class="reserve-confirm"
      type="button">
      Subir comprobante
    </button>

    <p id="proof-file-name" class="payment-placeholder">
      Ningún archivo seleccionado.
    </p>
  `

  const proofInput =
    document.getElementById("bank-proof")

  const uploadBtn =
    document.getElementById("upload-proof-btn")

  const proofName =
    document.getElementById("proof-file-name")

  const openBankModal =
    document.getElementById("open-bank-modal")

  const bankModal =
    document.getElementById("bank-modal")

  const closeBankModal =
    document.getElementById("close-bank-modal")

  const bankAccounts =
    document.querySelectorAll(".bank-account")

  const bankCopyMsg =
    document.getElementById("bank-copy-msg")

  uploadBtn.addEventListener("click", () => {
    proofInput.click()
  })

  proofInput.addEventListener("change", () => {

    bankProofFile =
      proofInput.files[0] || null

    proofName.textContent =
      bankProofFile
        ? bankProofFile.name
        : "Ningún archivo seleccionado."

    resetPaymentState()
  })

  if (openBankModal && bankModal) {

    openBankModal.addEventListener("click", () => {
      bankModal.classList.remove("hidden-bank-modal")
    })
  }

  if (closeBankModal && bankModal) {

    closeBankModal.addEventListener("click", () => {
      bankModal.classList.add("hidden-bank-modal")
    })

    bankModal.addEventListener("click", (event) => {

      if (event.target === bankModal) {
        bankModal.classList.add("hidden-bank-modal")
      }
    })
  }

  bankAccounts.forEach((account) => {

    account.addEventListener("click", async () => {

      const value =
        account.dataset.copy

      try {

        await navigator.clipboard.writeText(value)

        if (bankCopyMsg) {
          bankCopyMsg.textContent =
            `Copiado: ${value}`
        }

      } catch (error) {

        console.error(error)

      }
    })
  })

  return
}

  if (state.paymentMethod === "card") {
    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Total: ${formatPrice(getTotalHNL())}
        <br>
        PayPal cobrará en Dolares Americanos.
      </div>

      <div id="paypal-button-container" class="paypal-button-container"></div>
    `

    waitForPayPalAndRender()
  }
}

function renderPayPalButton() {
  const container =
    document.getElementById("paypal-button-container")

  if (!container) return

  if (!isBookingReadyForPayment()) {
    container.innerHTML = `
      <div class="payment-placeholder">
        Primero seleccioná simulador, fecha y hora.
      </div>
    `
    return
  }

  if (!window.paypal) {
    container.innerHTML = `
      <div class="payment-placeholder">
        PayPal no cargó. Revisá VITE_PAYPAL_CLIENT_ID.
      </div>
    `
    return
  }

  window.paypal.Buttons({
    createOrder: async () => {
      const response =
        await fetch("/api/paypal-create-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
body: JSON.stringify({
  total: getTotalHNL()
})
        })

      const order =
        await response.json()

      if (!order.id) {
        console.error(order)
        throw new Error("No se pudo crear la orden de PayPal")
      }

      return order.id
    },

    onApprove: async (data) => {
      const response =
        await fetch("/api/paypal-capture-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            orderID: data.orderID
          })
        })

      const details =
        await response.json()

      state.paypalPaid = true
      state.paypalOrderId = data.orderID
      state.paypalDetails = details

      alert("Pago aprobado. Ahora confirmá la reserva.")
      updateSummary()
    },

    onError: (error) => {
      console.error(error)
      alert("Error con PayPal.")
    }
  }).render("#paypal-button-container")
}

paymentCards.forEach((card) => {
  card.addEventListener("click", () => {
    paymentCards.forEach((item) => {
      item.classList.remove("active")
    })

    card.classList.add("active")

    state.paymentMethod =
      card.dataset.payment || "cash"

    resetPaymentState()
    renderPaymentUI()
  })
})

if (dateInput) {
  dateInput.addEventListener("change", () => {
    state.date =
      dateInput.value

    resetPaymentState()
    updateSummary()
  })
}

timeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const time =
      button.textContent.trim()

    if (state.timesSelected.includes(time)) {
      state.timesSelected =
        state.timesSelected.filter((item) => item !== time)

      button.classList.remove("active")
    } else {
      state.timesSelected.push(time)
      button.classList.add("active")
    }

    resetPaymentState()
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

    if (!state.date || !state.timesSelected.length || !state.rigsSelected.length) {
      alert("Selecciona fecha, al menos una hora y al menos un simulador.")
      return
    }

    if (state.paymentMethod === "card" && !state.paypalPaid) {
      alert("Primero completá el pago con PayPal.")
      return
    }

    try {
      reserveBtn.disabled = true
      reserveBtn.textContent = "Reservando..."

      const selectedRigDetails =
        getSelectedRigDetails()

      const bookingRef =
        push(ref(db, "bookings"))
        const bookingId =
  bookingRef.key

const bankProofURL =
  state.paymentMethod === "bank"
    ? await uploadBankProof(bookingId)
    : ""

      await set(bookingRef, {
        uid: state.user.uid,
        name: getUserName(),
        email: state.user.email,
        phone: state.userProfile.phone,

        rigs: state.rigsSelected,
        rigDetails: selectedRigDetails,
        rigsCount: state.rigsSelected.length,

        times: state.timesSelected,
        hoursCount: state.timesSelected.length,

        date: state.date,

        subtotalPerHour: getSubtotalPerHour(),
        total: getTotalHNL(),

        paymentMethod: state.paymentMethod,
        currencyDisplayed: "HNL",
        currencyCharged: state.paymentMethod === "card" ? "USD" : "HNL",
        exchangeRate: HNL_TO_USD_RATE,
        totalHNL: getTotalHNL(),
        totalUSD: state.paymentMethod === "card" ? getTotalUSD() : null,

        paypalPaid: state.paypalPaid,
        paypalOrderId: state.paypalOrderId,
        paypalDetails: state.paypalDetails,

        status:
          state.paymentMethod === "card"
            ? "paid"
            : "pending",
bankProofURL,
status:
  state.paymentMethod === "card"
    ? "paid"
    : state.paymentMethod === "bank"
      ? "pending_bank_review"
      : "pending_cash",
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
function waitForPayPalAndRender() {
  if (window.paypal) {
    renderPayPalButton()
    return
  }

  window.addEventListener(
    "paypal-loaded",
    () => {
      renderPayPalButton()
    },
    { once: true }
  )
}
async function uploadBankProof(bookingId) {
  if (!bankProofFile) return ""

  const fileName =
    `${Date.now()}-${bankProofFile.name}`

  const fileRef =
    storageRef(
      storage,
      `bank-proofs/${bookingId}/${fileName}`
    )

  await uploadBytes(fileRef, bankProofFile)

  return await getDownloadURL(fileRef)
}
loadRigs()
renderPaymentUI()
updateSummary()

function setupBankProofUI() {
  const proofInput =
    document.getElementById("bank-proof")

  const uploadBtn =
    document.getElementById("upload-proof-btn")

  const proofName =
    document.getElementById("proof-file-name")

  if (!proofInput || !uploadBtn || !proofName) return

  uploadBtn.addEventListener("click", () => {
    proofInput.click()
  })

  proofInput.addEventListener("change", () => {
    bankProofFile =
      proofInput.files[0] || null

    proofName.textContent =
      bankProofFile
        ? bankProofFile.name
        : "Ningún archivo seleccionado."

    resetPaymentState()
  })
}

function setupBankModalUI() {
  const openBtn =
    document.getElementById("open-bank-modal")

  const modal =
    document.getElementById("bank-modal")

  const closeBtn =
    document.getElementById("close-bank-modal")

  const copyMsg =
    document.getElementById("bank-copy-msg")

  const accounts =
    document.querySelectorAll(".bank-account")

  if (!openBtn || !modal || !closeBtn) return

  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden-bank-modal")
  })

  closeBtn.addEventListener("click", () => {
    modal.classList.add("hidden-bank-modal")
  })

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden-bank-modal")
    }
  })

  accounts.forEach((account) => {
    account.addEventListener("click", async () => {
      const value =
        account.dataset.copy

      await navigator.clipboard.writeText(value)

      if (copyMsg) {
        copyMsg.textContent =
          `Copiado: ${value}`
      }
    })
  })
}