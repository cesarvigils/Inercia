/* =========================================
   FIREBASE
========================================= */

import {
  initializeApp,
  getApp,
  getApps
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"

/* =========================================
   CONFIG
========================================= */

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

/* =========================================
   INIT
========================================= */

const app =
  getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)

const auth = getAuth(app)

const $ = (id) =>
  document.getElementById(id)

/* =========================================
   ELEMENTS
========================================= */

const loginScreen = $("admin-login")
const adminApp = $("admin-app")

const emailInput = $("admin-email")
const passwordInput = $("admin-password")

const loginBtn = $("admin-login-btn")
const logoutBtn = $("admin-logout")

const loginError = $("login-error")

const bookingsBoard = $("bookings-board")

const salesRange = $("sales-range")
const salesTotal = $("sales-total")
const salesList = $("sales-list")

/* =========================================
   PRICES
========================================= */

const STANDARD_PRICE = 200
const PREMIUM_PRICE = 350

/* =========================================
   TOKEN
========================================= */

async function getToken() {

  if (!auth.currentUser) {
    throw new Error("No admin user")
  }

  return await auth.currentUser.getIdToken(true)
}

/* =========================================
   FETCH
========================================= */

async function adminFetch(
  url,
  options = {}
) {

  const token = await getToken()

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  })

  const data =
    await response.json()

  if (!response.ok) {

    console.error(data)

    throw new Error(
      data.error ||
      "admin_request_failed"
    )
  }

  return data
}

/* =========================================
   HELPERS
========================================= */

function formatMoney(value) {

  return `L ${Number(
    value || 0
  ).toFixed(2)}`
}

function formatDate(dateString) {

  if (!dateString) return "-"

  return new Date(
    `${dateString}T12:00:00`
  ).toLocaleDateString("es-HN", {
    weekday: "long",
    day: "2-digit",
    month: "short"
  })
}

function getDayKey(dateString) {

  return new Date(
    `${dateString}T12:00:00`
  ).getDay()
}

function normalizeRigs(booking) {

  if (
    Array.isArray(
      booking.rigDetails
    )
  ) {

    return booking.rigDetails
      .map(
        r =>
          r.name ||
          r.id ||
          r
      )
      .join(", ")
  }

  if (
    Array.isArray(
      booking.rigs
    )
  ) {

    return booking.rigs
      .map(
        r =>
          typeof r === "string"
            ? r
            : r.name
      )
      .join(", ")
  }

  return "-"
}

function getStatusInfo(status) {

  const map = {
    paid: "Pagada",
    confirmed: "Confirmada",
    completed: "Completada",
    pending_bank_review:
      "Pendiente transferencia",
    pending_cash:
      "Pendiente efectivo",
    admin_manual:
      "Manual admin",
    rejected: "Rechazada",
    expired: "Expirada"
  }

  return (
    map[status] ||
    status ||
    "Pendiente"
  )
}

/* =========================================
   BOOKINGS
========================================= */

function renderBookings(bookings) {

  if (!bookingsBoard) return

  const days = [
    { key: 2, label: "Martes" },
    { key: 3, label: "Miércoles" },
    { key: 4, label: "Jueves" },
    { key: 5, label: "Viernes" },
    { key: 6, label: "Sábado" },
    { key: 0, label: "Domingo" }
  ]

  bookingsBoard.innerHTML = ""

  days.forEach(day => {

    const column =
      document.createElement("div")

    column.className =
      "day-column"

    const items = bookings
      .filter(
        booking =>
          getDayKey(
            booking.date
          ) === day.key
      )
      .sort((a, b) =>
        String(
          a.times?.[0] || ""
        ).localeCompare(
          String(
            b.times?.[0] || ""
          )
        )
      )

    column.innerHTML =
      `<h3>${day.label}</h3>`

    if (!items.length) {

      column.innerHTML += `
        <div class="booking-card">
          <p>Sin reservas</p>
        </div>
      `
    }

    items.forEach(booking => {

      const card =
        document.createElement(
          "div"
        )

      const status =
        booking.status ||
        "pending"

      card.className =
        "booking-card"

      card.innerHTML = `
        <strong>
          ${booking.name || "Cliente"}
        </strong>

        <p>
          ${formatDate(
            booking.date
          )}
        </p>

        <p>
          <b>Hora:</b>
          ${(booking.times || []).join(", ")}
        </p>

        <p>
          <b>Rigs:</b>
          ${normalizeRigs(booking)}
        </p>

        <p>
          <b>Total:</b>
          ${formatMoney(
            booking.totalHNL ||
            booking.total ||
            0
          )}
        </p>

        <span class="status-pill status-${status}">
          ${getStatusInfo(status)}
        </span>
      `

      column.appendChild(card)
    })

    bookingsBoard.appendChild(
      column
    )
  })
}

async function loadBookings() {

  const data =
    await adminFetch(
      "/api/admin?action=bookings"
    )

  renderBookings(
    data.bookings || []
  )
}

/* =========================================
   SALES
========================================= */

let currentSalesType = "all"

function renderSales(
  sales,
  total
) {

  if (salesTotal) {
    salesTotal.textContent =
      formatMoney(total)
  }

  if (!salesList) return

  salesList.innerHTML = ""

  const filtered =
    currentSalesType === "all"
      ? sales
      : sales.filter(
          sale =>
            sale.type ===
            currentSalesType
        )

  if (!filtered.length) {

    salesList.innerHTML = `
      <div class="sale-card">
        <p>No hay ventas.</p>
      </div>
    `

    return
  }

  filtered.forEach(sale => {

    const card =
      document.createElement(
        "div"
      )

    card.className =
      "sale-card"

    card.innerHTML = `
      <h4>
        ${sale.description || "Venta"}
      </h4>

      <p>
        <b>Monto:</b>
        ${formatMoney(
          sale.amount
        )}
      </p>

      <p>
        <b>Método:</b>
        ${sale.method || "-"}
      </p>
    `

    salesList.appendChild(card)
  })
}

async function loadSales() {

  if (!salesRange) return

  const data =
    await adminFetch(
      `/api/admin?action=sales&range=${salesRange.value}`
    )

  renderSales(
    data.sales || [],
    data.total || 0
  )
}

/* =========================================
   PROMOS
========================================= */

function calculatePromo(
  baseTotal
) {

  /*
    SIN DESCUENTOS AUTOMATICOS
  */

  return baseTotal
}

/* =========================================
   TOTAL
========================================= */

function updateManualTotal() {

  const selectedBtns =
    document.querySelectorAll(
      ".manual-rig-btn.active"
    )

  const rigs = []

  const timeSelect =
    document.getElementById(
      "manual-time"
    )

  const selectedTimes =
    timeSelect
      ? Array.from(
          timeSelect.selectedOptions
        )
      : []

  const hoursCount =
    selectedTimes.length || 1

  let baseTotal = 0

  selectedBtns.forEach(btn => {

    const rigName = (
      btn.dataset.rig ||
      btn.textContent ||
      ""
    ).trim()

    rigs.push(rigName)

    let rigPrice = 0

    if (
      rigName
        .toLowerCase()
        .includes("premium")
    ) {

      rigPrice =
        PREMIUM_PRICE

    } else {

      rigPrice =
        STANDARD_PRICE
    }

    baseTotal +=
      rigPrice *
      hoursCount
  })

  const rigsInput =
    document.getElementById(
      "manual-rigs"
    ) ||
    document.getElementById(
      "manualRigs"
    )

  const totalInput =
    document.getElementById(
      "manual-total"
    ) ||
    document.getElementById(
      "manualTotal"
    )

  if (rigsInput) {

    rigsInput.value =
      rigs.join(", ")
  }

  if (!totalInput) return

  const finalTotal =
    calculatePromo(
      baseTotal
    )

  if (finalTotal <= 0) {

    totalInput.value = ""

    return
  }

  totalInput.value =
    `L ${finalTotal}`
}

/* =========================================
   BUTTONS
========================================= */

document
  .querySelectorAll(
    ".manual-rig-btn"
  )
  .forEach(btn => {

    btn.addEventListener(
      "click",
      () => {

        btn.classList.toggle(
          "active"
        )

        updateManualTotal()
      }
    )
  })

const timeSelector =
  document.getElementById(
    "manual-time"
  )

if (timeSelector) {

  timeSelector.addEventListener(
    "change",
    updateManualTotal
  )
}

/* =========================================
   MANUAL BOOKING
========================================= */

const manualBookingForm =
  $("manual-booking-form")

if (manualBookingForm) {

  manualBookingForm.onsubmit =
    async event => {

      event.preventDefault()

      const timeSelect =
        $("manual-time")

      const times =
        timeSelect
          ? Array.from(
              timeSelect.selectedOptions
            ).map(
              option =>
                option.value
            )
          : []

      const rigsInput =
        document.getElementById(
          "manual-rigs"
        ) ||
        document.getElementById(
          "manualRigs"
        )

      const totalInput =
        document.getElementById(
          "manual-total"
        ) ||
        document.getElementById(
          "manualTotal"
        )

      const rigs = (
        rigsInput?.value ||
        ""
      )
        .split(",")
        .map(
          item =>
            item.trim()
        )
        .filter(Boolean)

      const totalValue =
        String(
          totalInput?.value ||
          ""
        ).replace(/[^\d]/g, "")

      const payload = {
        name:
          $("manual-name")
            ?.value
            ?.trim() || "",

        phone:
          $("manual-phone")
            ?.value
            ?.trim() || "",

        email:
          $("manual-email")
            ?.value
            ?.trim() || "",

        date:
          $("manual-date")
            ?.value || "",

        times,
        rigs,

        totalHNL:
          Number(
            totalValue || 0
          )
      }

      if (
        !payload.name ||
        !payload.phone ||
        !payload.date ||
        !times.length ||
        !rigs.length
      ) {

        alert(
          "Llená nombre, teléfono, fecha, hora y rigs."
        )

        return
      }

      await adminFetch(
        "/api/admin?action=bookings",
        {
          method: "POST",
          body: JSON.stringify(
            payload
          )
        }
      )

      manualBookingForm.reset()

      document
        .querySelectorAll(
          ".manual-rig-btn.active"
        )
        .forEach(btn => {

          btn.classList.remove(
            "active"
          )
        })

      updateManualTotal()

      await Promise.all([
        loadBookings(),
        loadSales()
      ])

      alert(
        "Reserva creada."
      )
    }
}

/* =========================================
   LOGIN
========================================= */

loginBtn.onclick =
  async () => {

    try {

      loginError.textContent =
        ""

      await signInWithEmailAndPassword(
        auth,
        emailInput.value.trim(),
        passwordInput.value
      )

    } catch (error) {

      console.error(error)

      loginError.textContent =
        "No se pudo iniciar sesión."
    }
  }

logoutBtn.onclick =
  async () => {

    await signOut(auth)

    window.location.reload()
  }

/* =========================================
   TABS
========================================= */

document
  .querySelectorAll(
    ".admin-tab"
  )
  .forEach(tab => {

    tab.onclick = () => {

      document
        .querySelectorAll(
          ".admin-tab"
        )
        .forEach(i =>
          i.classList.remove(
            "active"
          )
        )

      document
        .querySelectorAll(
          ".admin-section"
        )
        .forEach(i =>
          i.classList.remove(
            "active"
          )
        )

      tab.classList.add(
        "active"
      )

      document
        .getElementById(
          `tab-${tab.dataset.tab}`
        )
        ?.classList.add(
          "active"
        )
    }
  })

/* =========================================
   AUTH
========================================= */

onAuthStateChanged(
  auth,
  async user => {

    if (!user) {

      loginScreen?.classList.remove(
        "hidden"
      )

      adminApp?.classList.add(
        "hidden"
      )

      return
    }

    try {

      loginScreen?.classList.add(
        "hidden"
      )

      adminApp?.classList.remove(
        "hidden"
      )

      await Promise.all([
        loadBookings(),
        loadSales()
      ])

    } catch (error) {

      console.error(error)

      await signOut(auth)

      loginError.textContent =
        "Este usuario no tiene permiso admin."
    }
  }
)

/* =========================================
   INIT
========================================= */

updateManualTotal()