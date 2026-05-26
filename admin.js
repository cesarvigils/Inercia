import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig)

const auth = getAuth(app)

const $ = (id) => document.getElementById(id)

/* =========================================
   ELEMENTS
========================================= */

const loginScreen = $("admin-login")
const adminApp = $("admin-app")
const emailInput = $("admin-email")
const passwordInput = $("admin-password")
const loginBtn = $("admin-login-btn")
const loginError = $("login-error")
const logoutBtn = $("admin-logout")

const bookingsBoard = $("bookings-board")
const usersList = $("users-list")
const creditUser = $("credit-user")

const salesRange = $("sales-range")
const salesTotal = $("sales-total")
const salesList = $("sales-list")
const productsList = $("products-list")

/* =========================================
   PRICES
========================================= */

const STANDARD_PRICE = 200
const PREMIUM_PRICE = 350

/* =========================================
   HELPERS
========================================= */

async function getToken() {

  if (!auth.currentUser) {
    throw new Error("No admin user")
  }

  return await auth.currentUser.getIdToken(true)
}

async function adminFetch(url, options = {}) {

  const token = await getToken()

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  })

  const data = await response.json()

  if (!response.ok) {
    console.error(data)
    throw new Error(data.error || "admin_request_failed")
  }

  return data
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

function formatMoney(value) {
  return `L ${Number(value || 0).toFixed(2)}`
}

function getDayKey(dateString) {
  return new Date(
    `${dateString}T12:00:00`
  ).getDay()
}

function normalizeRigs(booking) {

  if (Array.isArray(booking.rigDetails)) {
    return booking.rigDetails
      .map((r) => r.name || r.id || r)
      .join(", ")
  }

  if (Array.isArray(booking.rigs)) {
    return booking.rigs
      .map((r) => typeof r === "string"
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
    pending_bank_review: "Pendiente transferencia",
    pending_cash: "Pendiente efectivo",
    admin_manual: "Manual admin",
    rejected: "Rechazada",
    expired: "Expirada"
  }

  return map[status] || status || "Pendiente"
}

/* =========================================
   BOOKINGS
========================================= */

function renderBookings(bookings) {

  const days = [
    { key: 2, label: "Martes" },
    { key: 3, label: "Miércoles" },
    { key: 4, label: "Jueves" },
    { key: 5, label: "Viernes" },
    { key: 6, label: "Sábado" },
    { key: 0, label: "Domingo" }
  ]

  bookingsBoard.innerHTML = ""

  days.forEach((day) => {

    const column = document.createElement("div")
    column.className = "day-column"

    const items = bookings
      .filter(
        (booking) =>
          getDayKey(booking.date) === day.key
      )
      .sort((a, b) =>
        String(a.times?.[0] || "")
          .localeCompare(
            String(b.times?.[0] || "")
          )
      )

    column.innerHTML = `<h3>${day.label}</h3>`

    if (!items.length) {

      column.innerHTML += `
        <div class="booking-card">
          <p>Sin reservas</p>
        </div>
      `
    }

    items.forEach((booking) => {

      const card = document.createElement("div")

      const status =
        booking.status || "pending"

      card.className = "booking-card"

      card.innerHTML = `
        <strong>${booking.name || "Cliente"}</strong>

        <p>${formatDate(booking.date)}</p>

        <p>
          <b>Hora:</b>
          ${(booking.times || []).join(", ")}
        </p>

        <p>
          <b>Tel:</b>
          ${booking.phone || "-"}
        </p>

        <p>
          <b>Correo:</b>
          ${booking.email || "-"}
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

        <div class="booking-actions">
          <button class="complete" data-complete="${booking.id}">
            Completar
          </button>

          <button data-confirm="${booking.id}">
            Confirmar
          </button>

          <button data-reject="${booking.id}">
            Rechazar
          </button>

          <button class="delete" data-delete="${booking.id}">
            Borrar
          </button>
        </div>
      `

      card.querySelector("[data-complete]").onclick = async () => {

        if (!confirm(
          "¿Completar y quitar esta reserva de la lista?"
        )) return

        await adminFetch(
          "/api/admin?action=bookings",
          {
            method: "PATCH",
            body: JSON.stringify({
              id: booking.id,
              action: "complete"
            })
          }
        )

        await Promise.all([
          loadBookings(),
          loadSales()
        ])
      }

      card.querySelector("[data-confirm]").onclick = async () => {

        await adminFetch(
          "/api/admin?action=bookings",
          {
            method: "PATCH",
            body: JSON.stringify({
              id: booking.id,
              status: "confirmed"
            })
          }
        )

        await loadBookings()
      }

      card.querySelector("[data-reject]").onclick = async () => {

        await adminFetch(
          "/api/admin?action=bookings",
          {
            method: "PATCH",
            body: JSON.stringify({
              id: booking.id,
              status: "rejected"
            })
          }
        )

        await loadBookings()
      }

      card.querySelector("[data-delete]").onclick = async () => {

        if (!confirm(
          "¿Borrar esta reserva?"
        )) return

        await adminFetch(
          `/api/admin?action=bookings&id=${booking.id}`,
          {
            method: "DELETE"
          }
        )

        await Promise.all([
          loadBookings(),
          loadSales()
        ])
      }

      column.appendChild(card)
    })

    bookingsBoard.appendChild(column)
  })
}

async function loadBookings() {

  const data = await adminFetch(
    "/api/admin?action=bookings"
  )

  renderBookings(data.bookings || [])
}

/* =========================================
   PROMOS
========================================= */

function calculatePromo(baseTotal, rigs) {

  /*
    NO HAY DESCUENTOS AUTOMATICOS
  */

  return baseTotal;
}
/* =========================================
   MANUAL TOTAL
========================================= */

function updateManualTotal() {

  const selectedBtns =
    document.querySelectorAll(
      ".manual-rig-btn.active"
    )

  const rigs = []

  let baseTotal = 0

  selectedBtns.forEach(btn => {

    const rigName = (
      btn.dataset.rig ||
      btn.textContent ||
      ""
    ).trim()

    rigs.push(rigName)

    /*
      PRECIOS FORZADOS
    */

    if (
      rigName.toLowerCase()
        .includes("premium")
    ) {

      baseTotal += PREMIUM_PRICE

    } else {

      baseTotal += STANDARD_PRICE
    }
  })

  const manualRigsInput =
    $("manual-rigs") ||
    $("manualRigs")

  const manualTotalInput =
    $("manual-total") ||
    $("manualTotal")

  if (manualRigsInput) {
    manualRigsInput.value =
      rigs.join(", ")
  }

  if (!manualTotalInput) return

  if (baseTotal <= 0) {

    manualTotalInput.value = ""

    return
  }

  const finalTotal =
    calculatePromo(baseTotal, rigs)

  if (
    manualTotalInput.type === "number"
  ) {

    manualTotalInput.value = finalTotal

  } else {

    manualTotalInput.value =
      `L ${finalTotal}`
  }
}

/* =========================================
   RIG BUTTONS
========================================= */

document
  .querySelectorAll(".manual-rig-btn")
  .forEach(btn => {

    btn.addEventListener("click", () => {

      btn.classList.toggle("active")

      updateManualTotal()
    })
  })

/* =========================================
   USERS
========================================= */

function renderUsers(users) {

  usersList.innerHTML = ""
  creditUser.innerHTML = ""

  users.forEach((user) => {

    const option =
      document.createElement("option")

    option.value = user.uid

    option.textContent =
      `${user.name || "Usuario"} · ${user.email || user.uid}`

    creditUser.appendChild(option)

    const card =
      document.createElement("div")

    card.className = "user-card"

    card.innerHTML = `
      <h4>${user.name || "Usuario"}</h4>
      <span>${user.email || "-"}</span>
      <span>Tel: ${user.phone || "-"}</span>
      <span>UID: ${user.uid}</span>
      <span>
        Horas gratis:
        ${Number(user.freeHours || 0)}
      </span>
    `

    usersList.appendChild(card)
  })
}

async function loadUsers() {

  const data = await adminFetch(
    "/api/admin?action=users"
  )

  renderUsers(data.users || [])
}

/* =========================================
   SALES
========================================= */

let currentSalesType = "all"
let cachedSales = []
let cachedSalesTotal = 0

function renderSales(sales, total) {

  cachedSales = sales
  cachedSalesTotal = total

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
            sale.type === currentSalesType
        )

  if (!filtered.length) {

    salesList.innerHTML = `
      <div class="sale-card">
        <p>No hay ventas.</p>
      </div>
    `

    return
  }

  filtered.forEach((sale) => {

    const card =
      document.createElement("div")

    card.className = "sale-card"

    card.innerHTML = `
      <h4>${sale.description || "Venta"}</h4>

      <p>
        <b>Monto:</b>
        ${formatMoney(sale.amount)}
      </p>

      <p>
        <b>Método:</b>
        ${sale.method || "-"}
      </p>

      <p>
        <b>Tipo:</b>
        ${sale.type || "-"}
      </p>

      <p>
        <b>Fecha:</b>
        ${new Date(
          Number(
            sale.createdAt || Date.now()
          )
        ).toLocaleString("es-HN")}
      </p>
    `

    salesList.appendChild(card)
  })
}

async function loadSales() {

  if (!salesRange) return

  const data = await adminFetch(
    `/api/admin?action=sales&range=${salesRange.value}`
  )

  renderSales(
    data.sales || [],
    data.total || 0
  )
}

/* =========================================
   LOGIN
========================================= */

loginBtn.onclick = async () => {

  try {

    loginError.textContent = ""

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

logoutBtn.onclick = async () => {

  await signOut(auth)

  window.location.reload()
}

/* =========================================
   TABS
========================================= */

document
  .querySelectorAll(".admin-tab")
  .forEach((tab) => {

    tab.onclick = () => {

      document
        .querySelectorAll(".admin-tab")
        .forEach((i) =>
          i.classList.remove("active")
        )

      document
        .querySelectorAll(".admin-section")
        .forEach((i) =>
          i.classList.remove("active")
        )

      tab.classList.add("active")

      document
        .getElementById(
          `tab-${tab.dataset.tab}`
        )
        .classList.add("active")
    }
  })

/* =========================================
   MANUAL BOOKING
========================================= */

const manualBookingForm =
  $("manual-booking-form")

if (manualBookingForm) {

  manualBookingForm.onsubmit =
    async (event) => {

      event.preventDefault()

      const times = Array.from(
        $("manual-time").selectedOptions
      ).map(option => option.value)

      const rigs = (
        $("manual-rigs").value || ""
      )
        .split(",")
        .map(item => item.trim())
        .filter(Boolean)

      const totalValue =
        String(
          $("manual-total").value || ""
        )
          .replace(/[^\d]/g, "")

      const payload = {
        name: $("manual-name").value.trim(),
        phone: $("manual-phone").value.trim(),
        email: $("manual-email").value.trim(),
        date: $("manual-date").value,
        times,
        rigs,
        totalHNL: Number(totalValue || 0)
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
          body: JSON.stringify(payload)
        }
      )

      manualBookingForm.reset()

      document
        .querySelectorAll(
          ".manual-rig-btn.active"
        )
        .forEach(btn =>
          btn.classList.remove("active")
        )

      updateManualTotal()

      await Promise.all([
        loadBookings(),
        loadSales()
      ])

      alert("Reserva creada.")
    }
}

/* =========================================
   AUTH
========================================= */

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) {

      loginScreen.classList.remove(
        "hidden"
      )

      adminApp.classList.add(
        "hidden"
      )

      return
    }

    try {

      loginScreen.classList.add(
        "hidden"
      )

      adminApp.classList.remove(
        "hidden"
      )

      await Promise.all([
        loadBookings(),
        loadUsers(),
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