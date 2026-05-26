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

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
const auth = getAuth(app)

const $ = (id) => document.getElementById(id)

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

async function getToken() {
  if (!auth.currentUser) throw new Error("No admin user")
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
  return new Date(`${dateString}T12:00:00`).toLocaleDateString("es-HN", {
    weekday: "long",
    day: "2-digit",
    month: "short"
  })
}

function formatMoney(value) {
  return `L ${Number(value || 0).toFixed(2)}`
}

function getDayKey(dateString) {
  return new Date(`${dateString}T12:00:00`).getDay()
}

function normalizeRigs(booking) {
  if (Array.isArray(booking.rigDetails)) {
    return booking.rigDetails.map((r) => r.name || r.id || r).join(", ")
  }

  if (Array.isArray(booking.rigs)) {
    return booking.rigs.map((r) => typeof r === "string" ? r : r.name).join(", ")
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
      .filter((booking) => getDayKey(booking.date) === day.key)
      .sort((a, b) => String(a.times?.[0] || "").localeCompare(String(b.times?.[0] || "")))

    column.innerHTML = `<h3>${day.label}</h3>`

    if (!items.length) {
      column.innerHTML += `<div class="booking-card"><p>Sin reservas</p></div>`
    }

    items.forEach((booking) => {
      const card = document.createElement("div")
      const status = booking.status || "pending"

      card.className = "booking-card"

      card.innerHTML = `
        <strong>${booking.name || "Cliente"}</strong>
        <p>${formatDate(booking.date)}</p>
        <p><b>Hora:</b> ${(booking.times || []).join(", ")}</p>
        <p><b>Tel:</b> ${booking.phone || "-"}</p>
        <p><b>Correo:</b> ${booking.email || "-"}</p>
        <p><b>Rigs:</b> ${normalizeRigs(booking)}</p>
        <p><b>Total:</b> ${formatMoney(booking.totalHNL || booking.total || 0)}</p>

        <span class="status-pill status-${status}">
          ${getStatusInfo(status)}
        </span>

        <div class="booking-actions">
          <button class="complete" data-complete="${booking.id}">Completar</button>
          <button data-confirm="${booking.id}">Confirmar</button>
          <button data-reject="${booking.id}">Rechazar</button>
          <button class="delete" data-delete="${booking.id}">Borrar</button>
        </div>
      `

      card.querySelector("[data-complete]").onclick = async () => {
        if (!confirm("¿Completar y quitar esta reserva de la lista?")) return

        await adminFetch("/api/admin?action=bookings", {
          method: "PATCH",
          body: JSON.stringify({
            id: booking.id,
            action: "complete"
          })
        })

        await Promise.all([loadBookings(), loadSales()])
      }

      card.querySelector("[data-confirm]").onclick = async () => {
        await adminFetch("/api/admin?action=bookings", {
          method: "PATCH",
          body: JSON.stringify({
            id: booking.id,
            status: "confirmed"
          })
        })

        await loadBookings()
      }

      card.querySelector("[data-reject]").onclick = async () => {
        await adminFetch("/api/admin?action=bookings", {
          method: "PATCH",
          body: JSON.stringify({
            id: booking.id,
            status: "rejected"
          })
        })

        await loadBookings()
      }

      card.querySelector("[data-delete]").onclick = async () => {
        if (!confirm("¿Borrar esta reserva?")) return

        await adminFetch(`/api/admin?action=bookings&id=${booking.id}`, {
          method: "DELETE"
        })

        await Promise.all([loadBookings(), loadSales()])
      }

      column.appendChild(card)
    })

    bookingsBoard.appendChild(column)
  })
}

async function loadBookings() {
  const data = await adminFetch("/api/admin?action=bookings")
  renderBookings(data.bookings || [])
}

function fillPromoForm(promo) {
  $("promo-id").value = promo.id || ""
  $("promo-name").value = promo.name || ""
  $("promo-type").value = promo.type || "fixed_price"
  $("promo-simulator-type").value = promo.simulatorType || "standard"
  $("promo-fixed-price").value = promo.fixedPrice || ""
  $("promo-percent").value = promo.percent || ""
  $("promo-active").value = String(promo.active !== false)

  if ($("promo-ends-at")) {
    $("promo-ends-at").value = promo.endsAt || ""
  }

  document.querySelectorAll(".promo-day").forEach((checkbox) => {
    checkbox.checked = Array.isArray(promo.days) && promo.days.includes(Number(checkbox.value))
  })
}

function clearPromoForm() {
  fillPromoForm({
    active: true,
    type: "fixed_price",
    simulatorType: "standard",
    days: [],
    endsAt: ""
  })
}

function renderPromos(promos) {
  const wrap = $("promos-list")
  wrap.innerHTML = ""

  if (!promos.length) {
    wrap.innerHTML = `<div class="promo-card">No hay promociones.</div>`
    return
  }

  promos.forEach((promo) => {
    const card = document.createElement("div")
    card.className = "promo-card"

    card.innerHTML = `
      <h4>${promo.name || "Promo"}</h4>
      <span>Tipo: ${promo.type}</span>
      <span>Simulador: ${promo.simulatorType}</span>
      <span>Precio fijo: ${promo.fixedPrice ? `L ${promo.fixedPrice}` : "-"}</span>
      <span>Descuento: ${promo.percent ? `${promo.percent}%` : "-"}</span>
      <span>Días: ${Array.isArray(promo.days) && promo.days.length ? promo.days.join(", ") : "Todos"}</span>
      <span>Termina: ${promo.endsAt || "Sin fecha"}</span>
      <span>Activa: ${promo.active !== false ? "Sí" : "No"}</span>

      <div class="promo-actions">
        <button data-edit="${promo.id}">Editar</button>
        <button class="delete" data-delete="${promo.id}">Borrar</button>
      </div>
    `

    card.querySelector("[data-edit]").onclick = () => fillPromoForm(promo)

    card.querySelector("[data-delete]").onclick = async () => {
      if (!confirm("¿Borrar esta promo?")) return

      await adminFetch(`/api/admin?action=promos&id=${promo.id}`, {
        method: "DELETE"
      })

      await loadPromos()
    }

    wrap.appendChild(card)
  })
}

async function loadPromos() {
  const data = await adminFetch("/api/admin?action=promos")
  renderPromos(data.promos || [])
}

function renderUsers(users) {
  usersList.innerHTML = ""
  creditUser.innerHTML = ""

  users.forEach((user) => {
    const option = document.createElement("option")
    option.value = user.uid
    option.textContent = `${user.name || "Usuario"} · ${user.email || user.uid}`
    creditUser.appendChild(option)

    const card = document.createElement("div")
    card.className = "user-card"

    card.innerHTML = `
      <h4>${user.name || "Usuario"}</h4>
      <span>${user.email || "-"}</span>
      <span>Tel: ${user.phone || "-"}</span>
      <span>UID: ${user.uid}</span>
      <span>Horas gratis: ${Number(user.freeHours || 0)}</span>
    `

    usersList.appendChild(card)
  })
}

async function loadUsers() {
  const data = await adminFetch("/api/admin?action=users")
  renderUsers(data.users || [])
}
let currentSalesType = "all"
let cachedSales = []
let cachedSalesTotal = 0
function renderSales(sales, total) {
  cachedSales = sales
  cachedSalesTotal = total

  if (salesTotal) {
    salesTotal.textContent = formatMoney(total)
  }

  if (!salesList) return

  salesList.innerHTML = ""

  const filtered =
    currentSalesType === "all"
      ? sales
      : sales.filter((sale) => sale.type === currentSalesType)

  if (!filtered.length) {
    salesList.innerHTML = `
      <div class="sale-card">
        <p>No hay ventas en esta pestaña.</p>
      </div>
    `
    return
  }

  filtered.forEach((sale) => {
    const card = document.createElement("div")
    card.className = "sale-card"

    card.innerHTML = `
      <h4>${sale.description || "Venta"}</h4>
      <p><b>Monto:</b> ${formatMoney(sale.amount)}</p>
      <p><b>Método:</b> ${sale.method || "-"}</p>
      <p><b>Tipo:</b> ${sale.type || "-"}</p>
      <p><b>Fecha:</b> ${new Date(Number(sale.createdAt || Date.now())).toLocaleString("es-HN")}</p>
    `

    salesList.appendChild(card)
  })
}

async function loadSales() {
  if (!salesRange) return

  const data = await adminFetch(`/api/admin?action=sales&range=${salesRange.value}`)
  renderSales(data.sales || [], data.total || 0)
}

function fillProductForm(product) {
  $("product-id").value = product.id || ""
  $("product-name").value = product.name || ""
  $("product-price").value = product.price || ""
}

function clearProductForm() {
  fillProductForm({})
}

function renderProducts(products) {
  if (!productsList) return

  productsList.innerHTML = ""

  if (!products.length) {
    productsList.innerHTML = `<div class="promo-card">No hay productos.</div>`
    return
  }

  products.forEach((product) => {
    const card = document.createElement("div")
    card.className = "promo-card"

    card.innerHTML = `
      <h4>${product.name}</h4>
      <span>Precio: ${formatMoney(product.price)}</span>

      <div class="product-actions">
        <input type="number" min="1" value="1" id="qty-${product.id}">
        <button data-sell="${product.id}">Vender</button>
        <button data-edit-product="${product.id}">Editar</button>
        <button class="delete" data-delete-product="${product.id}">Borrar</button>
      </div>
    `

    card.querySelector("[data-sell]").onclick = async () => {
      const quantity = Number($(`qty-${product.id}`).value || 1)

      await adminFetch("/api/admin?action=sales", {
        method: "POST",
        body: JSON.stringify({
          type: "product",
          description: `${product.name} x${quantity}`,
          amount: Number(product.price) * quantity,
          method: "cash",
          productId: product.id,
          quantity
        })
      })

      await loadSales()
      alert("Venta de producto agregada.")
    }

    card.querySelector("[data-edit-product]").onclick = () => fillProductForm(product)

    card.querySelector("[data-delete-product]").onclick = async () => {
      if (!confirm("¿Borrar producto?")) return

      await adminFetch(`/api/admin?action=products&id=${product.id}`, {
        method: "DELETE"
      })

      await loadProducts()
    }

    productsList.appendChild(card)
  })
}

async function loadProducts() {
  if (!productsList) return

  const data = await adminFetch("/api/admin?action=products")
  renderProducts(data.products || [])
}

async function bootAdmin() {
  loginScreen.classList.add("hidden")
  adminApp.classList.remove("hidden")

  await Promise.all([
    loadBookings(),
    loadPromos(),
    loadUsers(),
    loadSales(),
    loadProducts()
  ])
}

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
    loginError.textContent = "No se pudo iniciar sesión."
  }
}

logoutBtn.onclick = async () => {
  await signOut(auth)
  window.location.reload()
}

document.querySelectorAll(".admin-tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".admin-tab").forEach((i) => i.classList.remove("active"))
    document.querySelectorAll(".admin-section").forEach((i) => i.classList.remove("active"))

    tab.classList.add("active")
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active")
  }
})

$("refresh-bookings").onclick = loadBookings
$("refresh-users").onclick = loadUsers
$("clear-promo").onclick = clearPromoForm

$("promo-form").onsubmit = async (e) => {
  e.preventDefault()

  const payload = {
    id: $("promo-id").value.trim() || null,
    name: $("promo-name").value.trim(),
    type: $("promo-type").value,
    simulatorType: $("promo-simulator-type").value,
    fixedPrice: Number($("promo-fixed-price").value || 0),
    percent: Number($("promo-percent").value || 0),
    active: $("promo-active").value === "true",
    days: Array.from(document.querySelectorAll(".promo-day:checked")).map((item) => Number(item.value)),
    endsAt: $("promo-ends-at")?.value || ""
  }

  await adminFetch("/api/admin?action=promos", {
    method: "POST",
    body: JSON.stringify(payload)
  })

  clearPromoForm()
  await loadPromos()
}

$("credit-hours-btn").onclick = async () => {
  const uid = creditUser.value
  const hours = Number($("credit-hours").value || 0)
  const note = $("credit-note").value.trim()

  if (!uid || hours <= 0) {
    alert("Seleccioná usuario y horas.")
    return
  }

  await adminFetch("/api/admin?action=credit-hours", {
    method: "POST",
    body: JSON.stringify({
      uid,
      hours,
      note
    })
  })

  $("credit-hours").value = ""
  $("credit-note").value = ""

  await loadUsers()
  alert("Horas acreditadas.")
}

const manualBookingForm = $("manual-booking-form")

if (manualBookingForm) {
  manualBookingForm.onsubmit = async (event) => {
    event.preventDefault()

    const times = Array.from($("manual-time").selectedOptions).map((option) => option.value)

    const rigs = $("manual-rigs").value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

    const payload = {
      name: $("manual-name").value.trim(),
      phone: $("manual-phone").value.trim(),
      email: $("manual-email").value.trim(),
      date: $("manual-date").value,
      times,
      rigs,
      totalHNL: Number($("manual-total").value || 0)
    }

    if (!payload.name || !payload.phone || !payload.date || !times.length || !rigs.length) {
      alert("Llená nombre, teléfono, fecha, hora y rigs.")
      return
    }

    await adminFetch("/api/admin?action=bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    })

    manualBookingForm.reset()
    await Promise.all([loadBookings(), loadSales()])
    alert("Reserva manual creada.")
  }
}

if (salesRange) {
  salesRange.onchange = loadSales
}
document.querySelectorAll(".sales-type-tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".sales-type-tab").forEach((item) => {
      item.classList.remove("active")
    })

    tab.classList.add("active")
    currentSalesType = tab.dataset.salesType

    renderSales(cachedSales, cachedSalesTotal)
  }
})
const manualSaleForm = $("manual-sale-form")

if (manualSaleForm) {
  manualSaleForm.onsubmit = async (event) => {
    event.preventDefault()

    const description = $("sale-description").value.trim()
    const amount = Number($("sale-amount").value || 0)
    const method = $("sale-method").value

    if (!description || amount <= 0) {
      alert("Agregá descripción y monto.")
      return
    }

    await adminFetch("/api/admin?action=sales", {
      method: "POST",
      body: JSON.stringify({
        type: "manual",
        description,
        amount,
        method
      })
    })

    manualSaleForm.reset()
    await loadSales()
    alert("Venta manual agregada.")
  }
}

const productForm = $("product-form")

if (productForm) {
  productForm.onsubmit = async (event) => {
    event.preventDefault()

    const payload = {
      id: $("product-id").value.trim() || null,
      name: $("product-name").value.trim(),
      price: Number($("product-price").value || 0)
    }

    if (!payload.name || payload.price <= 0) {
      alert("Agregá nombre y precio.")
      return
    }

    await adminFetch("/api/admin?action=products", {
      method: "POST",
      body: JSON.stringify(payload)
    })

    clearProductForm()
    await loadProducts()
    alert("Producto guardado.")
  }
}

const clearProductBtn = $("clear-product")

if (clearProductBtn) {
  clearProductBtn.onclick = clearProductForm
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginScreen.classList.remove("hidden")
    adminApp.classList.add("hidden")
    return
  }

  try {
    await bootAdmin()
  } catch (error) {
    console.error(error)

    await signOut(auth)

    loginError.textContent = "Este usuario no tiene permiso de admin."
    loginScreen.classList.remove("hidden")
    adminApp.classList.add("hidden")
  }
})
const rigButtons = document.querySelectorAll(".manual-rig-btn");
const manualRigsInput = document.getElementById("manualRigs");
const manualTotalInput = document.getElementById("manualTotal");

/* =========================================
   PROMOS DINAMICAS
========================================= */

function calculatePromo(baseTotal, rigs){

  const premiumCount = rigs.filter(r =>
    r.toLowerCase().includes("premium")
  ).length;

  const standardCount = rigs.length - premiumCount;

  let discount = 0;

  /* STANDARD */

  if(standardCount >= 8){
    discount = 0.25;
  }
  else if(standardCount >= 6){
    discount = 0.20;
  }
  else if(standardCount >= 4){
    discount = 0.15;
  }
  else if(standardCount >= 2){
    discount = 0.10;
  }

  /* PREMIUM BONUS */

  if(premiumCount >= 2){
    discount += 0.05;
  }

  /* MAX 35% */

  if(discount > 0.35){
    discount = 0.35;
  }

  return Math.round(
    baseTotal * (1 - discount)
  );
}

/* =========================================
   UPDATE TOTAL
========================================= */

function updateManualTotal(){

  const selectedBtns = document.querySelectorAll(
    ".manual-rig-btn.active"
  );

  const rigs = [];

  let baseTotal = 0;

  selectedBtns.forEach(btn => {

    rigs.push(btn.dataset.rig);

    baseTotal += Number(btn.dataset.price);
  });

  manualRigsInput.value = rigs.join(", ");

  if(baseTotal <= 0){

    manualTotalInput.value = "";

    return;
  }

  const finalTotal = calculatePromo(baseTotal, rigs);

  manualTotalInput.value = `L ${finalTotal}`;
}
/* =========================================
   SELECT
========================================= */

rigButtons.forEach(btn => {

  btn.addEventListener("click", () => {

    btn.classList.toggle("active");

    updateManualTotal();
  });

});

updateManualTotal();