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

let activePromos = []

async function loadPromos() {
  try {
    const snap = await get(ref(db, "promotions"))

    const data =
      snap.exists()
        ? snap.val()
        : {}

    activePromos =
      Object.values(data)
        .filter((promo) => promo.active !== false)

  } catch (error) {
    console.error(error)
    activePromos = []
  }

  renderRigs()
  updateSummary()
}

function getUserName() {
  return (
    state.userProfile?.name ||
    state.user?.displayName ||
    "Piloto"
  )
}

function formatPrice(price) {
  return `L ${Number(price || 0).toFixed(2)}`
}

function getRigPrice(rig) {
  const type =
    String(
      rig.type ||
      "standard"
    ).toLowerCase()

  const basePrice =
    type.includes("premium")
      ? 350
      : 200

  const selectedDate =
    state.date ||
    dateInput?.value

  const day =
    selectedDate
      ? new Date(`${selectedDate}T12:00:00`).getDay()
      : null

  const promo =
    activePromos.find((promo) => {
      const promoType =
        String(
          promo.simulatorType || "all"
        ).toLowerCase()

      const appliesType =
        promoType === "all" ||
        promoType === type

      const promoDays =
        Array.isArray(promo.days)
          ? promo.days.map(Number)
          : []

      const appliesDay =
        !promoDays.length ||
        promoDays.includes(day)

      const appliesDate =
        !promo.endsAt ||
        !selectedDate ||
        selectedDate <= promo.endsAt

      return (
        promo.active !== false &&
        appliesType &&
        appliesDay &&
        appliesDate
      )
    })

  if (!promo) {
    return basePrice
  }

  if (
    promo.type === "fixed_price" ||
    promo.type === "fixed"
  ) {
    return Number(
      promo.fixedPrice ||
      basePrice
    )
  }

  if (
    promo.type === "percent_discount" ||
    promo.type === "percentage" ||
    promo.type === "discount"
  ) {
    const percent =
      Number(
        promo.percent ||
        promo.discount ||
        0
      )

    return Math.max(
      0,
      basePrice * (1 - percent / 100)
    )
  }

  return basePrice
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
    .reduce((total, rig) => {
      return total + Number(rig.price || 0)
    }, 0)
}

function getTotal() {
  const hours =
    state.timesSelected.length || 1

  return getSubtotalPerHour() * hours
}

function getTotalUSD() {
  return (
    getTotal() / HNL_TO_USD_RATE
  ).toFixed(2)
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
    getTotal()

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

  if (state.paymentMethod === "card") {
    renderPaymentUI()
  }
}

async function loadUserProfile(user) {
  try {
    const snapshot =
      await get(ref(db, `users/${user.uid}`))

    const profile =
      snapshot.exists()
        ? snapshot.val()
        : {}

    state.userProfile = profile

    if (!profile.phone) {
      alert("Agrega tu teléfono en tu perfil.")
      window.location.href = "/perfil"
      return
    }

    updateSummary()

  } catch (error) {
    console.error(error)
  }
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
      state.rigsSelected.filter(
        (name) => name !== rigName
      )

    resetPaymentState()
    return
  }

  if (state.rigsSelected.length >= MAX_RIGS) {
    alert(`Máximo ${MAX_RIGS} simuladores.`)
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

    card.type = "button"
    card.className = "rig-card"

    if (!rig.active) {
      card.classList.add("disabled")
    }

    if (
      state.rigsSelected.includes(rig.name)
    ) {
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
}

function isBookingReadyForPayment() {
  return Boolean(
    state.user &&
    state.userProfile?.phone &&
    state.date &&
    state.timesSelected.length &&
    state.rigsSelected.length &&
    getTotal() > 0
  )
}

function renderPaymentUI() {
  if (!paymentExtra) return

  if (state.paymentMethod === "cash") {
    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Pagás al llegar.
      </div>
    `
    return
  }

if (state.paymentMethod === "bank") {
  paymentExtra.innerHTML = `
    <div class="payment-placeholder">
      Primero realizá la transferencia y luego subí el comprobante.
    </div>

    <button id="open-bank-modal" class="bank-open-btn" type="button">
      Ver cuentas bancarias
    </button>

    <label class="bank-upload-label">
      Subir comprobante
      <input
        id="bank-proof"
        class="bank-proof"
        type="file"
        accept="image/*,.pdf"
        hidden>
    </label>

    <small id="bank-proof-name"></small>
  `

  document.getElementById("open-bank-modal")?.addEventListener("click", () => {
    document.getElementById("bank-modal")?.classList.remove("hidden-bank-modal")
  })

  document.getElementById("bank-proof")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0]
    document.getElementById("bank-proof-name").textContent = file ? file.name : ""
  })

  return
}

  if (state.paymentMethod === "card") {
    paymentExtra.innerHTML = `
      <div class="payment-placeholder">
        Total tarjeta: ${formatPrice(getTotal())}
        <br>
        USD ${getTotalUSD()}
      </div>

      <div id="paypal-button-container"></div>
    `

    renderPayPalButton()
  }
}

function renderPayPalButton() {
  const container =
    document.getElementById(
      "paypal-button-container"
    )

  if (!container) return

  if (!isBookingReadyForPayment()) {
    container.innerHTML = `
      <div class="payment-placeholder">
        Selecciona fecha, hora y simuladores.
      </div>
    `
    return
  }

  if (!window.paypal) {
    container.innerHTML = `
      <div class="payment-placeholder">
        PayPal no cargó.
      </div>
    `
    return
  }

  container.innerHTML = ""

  window.paypal.Buttons({
    createOrder: async () => {
      const response =
        await fetch(
          "/api/paypal-create-order",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              total: getTotalUSD()
            })
          }
        )

      const order =
        await response.json()

      if (!order.id) {
        throw new Error(
          "Error creando orden PayPal"
        )
      }

      return order.id
    },

    onApprove: async (data) => {
      const response =
        await fetch(
          "/api/paypal-capture-order",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              orderID: data.orderID
            })
          }
        )

      const details =
        await response.json()

      state.paypalPaid = true
      state.paypalOrderId =
        data.orderID

      state.paypalDetails =
        details

      alert("Pago aprobado.")
    },

    onError: (error) => {
      console.error(error)
      alert("Error PayPal.")
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

    renderRigs()
    updateSummary()
  })
}

timeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const time =
      button.textContent.trim()

    if (
      state.timesSelected.includes(time)
    ) {
      state.timesSelected =
        state.timesSelected.filter(
          (item) => item !== time
        )

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
  reserveBtn.addEventListener(
    "click",
    async () => {
      if (!state.user) {
        alert("Inicia sesión.")
        return
      }

      if (!state.userProfile?.phone) {
        alert("Agrega teléfono.")
        return
      }

      if (
        !state.date ||
        !state.timesSelected.length ||
        !state.rigsSelected.length
      ) {
        alert("Completa la reserva.")
        return
      }

      if (
        state.paymentMethod === "card" &&
        !state.paypalPaid
      ) {
        alert("Completa PayPal.")
        return
      }
const bankProofInput = document.getElementById("bank-proof")

if (state.paymentMethod === "bank" && !bankProofInput?.files?.[0]) {
  alert("Subí el comprobante de transferencia.")
  return
}
      try {
        reserveBtn.disabled = true
        reserveBtn.textContent =
          "Reservando..."

        const selectedRigDetails =
          getSelectedRigDetails()

        const bookingRef =
          push(ref(db, "bookings"))

        const bookingData = {
          uid: state.user.uid,
          name: getUserName(),
          email: state.user.email || "",
          phone: state.userProfile.phone,

          rigs: state.rigsSelected,
          rigDetails: selectedRigDetails,
          rigsCount:
            state.rigsSelected.length,

          times: state.timesSelected,
          hoursCount:
            state.timesSelected.length,

          date: state.date,

          subtotalPerHour:
            getSubtotalPerHour(),

          total: getTotal(),

          paymentMethod:
            state.paymentMethod,

          paypalPaid:
            state.paypalPaid,

          paypalOrderId:
            state.paypalOrderId,

          paypalDetails:
            state.paypalDetails || null,

          status:
            state.paymentMethod ===
            "card"
              ? "paid"
              : "pending",

          createdAt: Date.now()
        }

        await set(
          bookingRef,
          bookingData
        )
if (state.paymentMethod === "bank") {
  const proofFile = bankProofInput?.files?.[0]

  if (proofFile) {
    const safeName = proofFile.name.replace(/[^\w.-]/g, "_")

    const proofRef = storageRef(
      storage,
      `bank-proofs/${bookingRef.key}/${Date.now()}-${safeName}`
    )

    await uploadBytes(proofRef, proofFile)

    const proofURL = await getDownloadURL(proofRef)

    await set(ref(db, `bookings/${bookingRef.key}/proofURL`), proofURL)

    const telegramResponse = await fetch("/api/send-bank-proof", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        bookingId: bookingRef.key,
        name: bookingData.name,
        email: bookingData.email,
        phone: bookingData.phone,
        date: bookingData.date,
        times: bookingData.times,
        rigs: bookingData.rigs,
        total: bookingData.total,
        proofURL
      })
    })

    const telegramData = await telegramResponse.json()

    if (!telegramResponse.ok) {
      console.error(telegramData)
      alert("Reserva creada, pero no se pudo enviar el comprobante a Telegram.")
    }
  }
}
        const bookingId =
          bookingRef.key

        const whatsappMessage =
          `Buenas, He reservado en Inercia%0A%0A` +
          `Cliente: ${bookingData.name}%0A` +
          `Teléfono: ${bookingData.phone}%0A` +
          `Correo: ${bookingData.email}%0A` +
          `Fecha: ${bookingData.date}%0A` +
          `Horas: ${bookingData.times.join(", ")}%0A` +
          `Total: ${formatPrice(bookingData.total)}%0A` +
          `Pago: ${bookingData.paymentMethod}%0A` +
          `Estado: ${bookingData.status}`

        window.open(
          `https://wa.me/50493266075?text=${whatsappMessage}`,
          "_blank"
        )

        alert("Reserva creada.")

      } catch (error) {
        console.error(error)
        alert("Error creando reserva.")

      } finally {
        reserveBtn.disabled = false
        updateSummary()
      }
    }
  )
}

onAuthStateChanged(auth, async (user) => {
  state.user = user

  if (!user) {
    updateSummary()
    return
  }

  await loadUserProfile(user)
})

let calendarDate = new Date()

function renderCalendar() {
  const title =
    document.getElementById(
      "calendar-title"
    )

  const daysBox =
    document.getElementById(
      "calendar-days"
    )

  if (!title || !daysBox) return

  const year =
    calendarDate.getFullYear()

  const month =
    calendarDate.getMonth()

  title.textContent =
    calendarDate.toLocaleDateString(
      "es-HN",
      {
        month: "long",
        year: "numeric"
      }
    )

  daysBox.innerHTML = ""

  const firstDay =
    new Date(year, month, 1).getDay()

  const lastDate =
    new Date(
      year,
      month + 1,
      0
    ).getDate()

  const today =
    new Date()

  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < firstDay; i++) {
    daysBox.appendChild(
      document.createElement("div")
    )
  }

  for (
    let day = 1;
    day <= lastDate;
    day++
  ) {
    const date =
      new Date(year, month, day)

    const dateValue =
      date.toISOString().split("T")[0]

    const btn =
      document.createElement("button")

    btn.type = "button"
    btn.className =
      "calendar-day"

    btn.textContent = day

    const isMonday =
      date.getDay() === 1

    const isPast =
      date < today

    if (isMonday) {
      btn.classList.add("monday")
    }

    if (isMonday || isPast) {
      btn.classList.add("disabled")
      btn.disabled = true
    }

    if (state.date === dateValue) {
      btn.classList.add("active")
    }

    btn.onclick = () => {
      state.date = dateValue

      if (dateInput) {
        dateInput.value =
          dateValue
      }

      resetPaymentState()

      renderCalendar()
      renderRigs()
      updateSummary()
    }

    daysBox.appendChild(btn)
  }
}

document
  .getElementById("calendar-prev")
  ?.addEventListener("click", () => {
    calendarDate.setMonth(
      calendarDate.getMonth() - 1
    )

    renderCalendar()
  })

document
  .getElementById("calendar-next")
  ?.addEventListener("click", () => {
    calendarDate.setMonth(
      calendarDate.getMonth() + 1
    )

    renderCalendar()
  })
const bankModal =
  document.getElementById("bank-modal")

const closeBankModal =
  document.getElementById("close-bank-modal")

closeBankModal?.addEventListener("click", () => {
  bankModal?.classList.add("hidden-bank-modal")
})

bankModal?.addEventListener("click", (event) => {
  if (event.target === bankModal) {
    bankModal.classList.add("hidden-bank-modal")
  }
})

document.querySelectorAll(".bank-account").forEach((button) => {
  button.addEventListener("click", async () => {
    const number = button.dataset.copy || ""

    try {
      await navigator.clipboard.writeText(number)

      const msg =
        document.getElementById("bank-copy-msg")

      if (msg) {
        msg.textContent =
          `Cuenta copiada: ${number}`

        setTimeout(() => {
          msg.textContent = ""
        }, 2500)
      }
    } catch (error) {
      console.error(error)
      alert("No se pudo copiar la cuenta.")
    }
  })
})
renderCalendar()
loadPromos()
loadRigs()
renderPaymentUI()
updateSummary()