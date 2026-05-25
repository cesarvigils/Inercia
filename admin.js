import{initializeApp,getApp,getApps}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";import{getAuth,signInWithEmailAndPassword,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const firebaseConfig={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,databaseURL:import.meta.env.VITE_FIREBASE_DATABASE_URL,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,storageBucket:import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
const app=getApps().length?getApp():initializeApp(firebaseConfig),auth=getAuth(app);
const loginScreen=document.getElementById("admin-login"),adminApp=document.getElementById("admin-app"),emailInput=document.getElementById("admin-email"),passwordInput=document.getElementById("admin-password"),loginBtn=document.getElementById("admin-login-btn"),loginError=document.getElementById("login-error"),logoutBtn=document.getElementById("admin-logout"),bookingsBoard=document.getElementById("bookings-board"),usersList=document.getElementById("users-list"),creditUser=document.getElementById("credit-user");
async function getToken(){if(!auth.currentUser)throw new Error("No admin user");return await auth.currentUser.getIdToken(true)}
async function adminFetch(url,options={}){const token=await getToken();const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,...(options.headers||{})}});const data=await response.json();if(!response.ok){console.error(data);throw new Error(data.error||"admin_request_failed")}return data}
function formatDate(dateString){if(!dateString)return"-";return new Date(`${dateString}T12:00:00`).toLocaleDateString("es-HN",{weekday:"long",day:"2-digit",month:"short"})}
function getDayKey(dateString){return new Date(`${dateString}T12:00:00`).getDay()}
function normalizeRigs(booking){if(Array.isArray(booking.rigDetails))return booking.rigDetails.map(r=>r.name||r.id||r).join(", ");if(Array.isArray(booking.rigs))return booking.rigs.map(r=>typeof r==="string"?r:r.name).join(", ");return"-"}
function renderBookings(bookings){const days=[{key:2,label:"Martes"},{key:3,label:"Miércoles"},{key:4,label:"Jueves"},{key:5,label:"Viernes"},{key:6,label:"Sábado"},{key:0,label:"Domingo"}];bookingsBoard.innerHTML="";days.forEach(day=>{const column=document.createElement("div");column.className="day-column";const items=bookings.filter(b=>getDayKey(b.date)===day.key).sort((a,b)=>String(a.times?.[0]||"").localeCompare(String(b.times?.[0]||"")));column.innerHTML=`<h3>${day.label}</h3>`;if(!items.length)column.innerHTML+=`<div class="booking-card"><p>Sin reservas</p></div>`;items.forEach(booking=>{const card=document.createElement("div");card.className="booking-card";card.innerHTML=`<strong>${booking.name||"Cliente"}</strong><p>${formatDate(booking.date)}</p><p><b>Hora:</b> ${(booking.times||[]).join(", ")}</p><p><b>Tel:</b> ${booking.phone||"-"}</p><p><b>Correo:</b> ${booking.email||"-"}</p><p><b>Rigs:</b> ${normalizeRigs(booking)}</p><p><b>Total:</b> L ${Number(booking.totalHNL||booking.total||0).toFixed(2)}</p><span class="status-pill">${booking.status||"pending"}</span>`;column.appendChild(card)});bookingsBoard.appendChild(column)})}
async function loadBookings(){const data=await adminFetch("/api/admin-bookings");renderBookings(data.bookings||[])}
function fillPromoForm(promo){document.getElementById("promo-id").value=promo.id||"";document.getElementById("promo-name").value=promo.name||"";document.getElementById("promo-type").value=promo.type||"fixed_price";document.getElementById("promo-simulator-type").value=promo.simulatorType||"standard";document.getElementById("promo-fixed-price").value=promo.fixedPrice||"";document.getElementById("promo-percent").value=promo.percent||"";document.getElementById("promo-active").value=String(promo.active!==false)}
function clearPromoForm(){fillPromoForm({active:true,type:"fixed_price",simulatorType:"standard"})}
function renderPromos(promos){const wrap=document.getElementById("promos-list");wrap.innerHTML="";if(!promos.length){wrap.innerHTML=`<div class="promo-card">No hay promociones.</div>`;return}promos.forEach(promo=>{const card=document.createElement("div");card.className="promo-card";card.innerHTML=`<h4>${promo.name||"Promo"}</h4><span>Tipo: ${promo.type}</span><span>Simulador: ${promo.simulatorType}</span><span>Precio fijo: ${promo.fixedPrice?`L ${promo.fixedPrice}`:"-"}</span><span>Descuento: ${promo.percent?`${promo.percent}%`:"-"}</span><span>Activa: ${promo.active!==false?"Sí":"No"}</span><div class="promo-actions"><button data-edit="${promo.id}">Editar</button><button class="delete" data-delete="${promo.id}">Borrar</button></div>`;card.querySelector("[data-edit]").onclick=()=>fillPromoForm(promo);card.querySelector("[data-delete]").onclick=async()=>{if(!confirm("¿Borrar esta promo?"))return;await adminFetch(`/api/admin-promos?id=${promo.id}`,{method:"DELETE"});await loadPromos()};wrap.appendChild(card)})}
async function loadPromos(){const data=await adminFetch("/api/admin-promos");renderPromos(data.promos||[])}
function renderUsers(users){usersList.innerHTML="";creditUser.innerHTML="";users.forEach(user=>{const option=document.createElement("option");option.value=user.uid;option.textContent=`${user.name||"Usuario"} · ${user.email||user.uid}`;creditUser.appendChild(option);const card=document.createElement("div");card.className="user-card";card.innerHTML=`<h4>${user.name||"Usuario"}</h4><span>${user.email||"-"}</span><span>Tel: ${user.phone||"-"}</span><span>UID: ${user.uid}</span><span>Horas gratis: ${Number(user.freeHours||0)}</span>`;usersList.appendChild(card)})}
async function loadUsers(){const data=await adminFetch("/api/admin-users");renderUsers(data.users||[])}
async function bootAdmin(){loginScreen.classList.add("hidden");adminApp.classList.remove("hidden");await Promise.all([loadBookings(),loadPromos(),loadUsers()])}
loginBtn.onclick=async()=>{try{loginError.textContent="";await signInWithEmailAndPassword(auth,emailInput.value.trim(),passwordInput.value)}catch(error){console.error(error);loginError.textContent="No se pudo iniciar sesión."}};
logoutBtn.onclick=async()=>{await signOut(auth);window.location.reload()};
document.querySelectorAll(".admin-tab").forEach(tab=>{tab.onclick=()=>{document.querySelectorAll(".admin-tab").forEach(i=>i.classList.remove("active"));document.querySelectorAll(".admin-section").forEach(i=>i.classList.remove("active"));tab.classList.add("active");document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active")}});
document.getElementById("refresh-bookings").onclick=loadBookings;document.getElementById("refresh-users").onclick=loadUsers;document.getElementById("clear-promo").onclick=clearPromoForm;
document.getElementById("promo-form").onsubmit=async e=>{e.preventDefault();const payload={id:document.getElementById("promo-id").value.trim()||null,name:document.getElementById("promo-name").value.trim(),type:document.getElementById("promo-type").value,simulatorType:document.getElementById("promo-simulator-type").value,fixedPrice:Number(document.getElementById("promo-fixed-price").value||0),percent:Number(document.getElementById("promo-percent").value||0),active:document.getElementById("promo-active").value==="true"};await adminFetch("/api/admin-promos",{method:"POST",body:JSON.stringify(payload)});clearPromoForm();await loadPromos()};
document.getElementById("credit-hours-btn").onclick=async()=>{const uid=creditUser.value,hours=Number(document.getElementById("credit-hours").value||0),note=document.getElementById("credit-note").value.trim();if(!uid||hours<=0){alert("Seleccioná usuario y horas.");return}await adminFetch("/api/admin-credit-hours",{method:"POST",body:JSON.stringify({uid,hours,note})});document.getElementById("credit-hours").value="";document.getElementById("credit-note").value="";await loadUsers();alert("Horas acreditadas.")};
onAuthStateChanged(auth,async user=>{if(!user){loginScreen.classList.remove("hidden");adminApp.classList.add("hidden");return}try{await bootAdmin()}catch(error){console.error(error);await signOut(auth);loginError.textContent="Este usuario no tiene permiso de admin.";loginScreen.classList.remove("hidden");adminApp.classList.add("hidden")}});
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
        <p><b>Total:</b> L ${Number(booking.totalHNL || booking.total || 0).toFixed(2)}</p>
        <span class="status-pill status-${status}">${getStatusInfo(status)}</span>

        <div class="booking-actions">
          <button class="complete" data-complete="${booking.id}">Completar</button>
          <button data-confirm="${booking.id}">Confirmar</button>
          <button data-reject="${booking.id}">Rechazar</button>
          <button class="delete" data-delete="${booking.id}">Borrar</button>
        </div>
      `

      card.querySelector("[data-complete]").onclick = async () => {
        if (!confirm("¿Completar y quitar esta reserva de la lista?")) return

        await adminFetch("/api/admin-bookings", {
          method: "PATCH",
          body: JSON.stringify({
            id: booking.id,
            action: "complete"
          })
        })

        await loadBookings()
      }

      card.querySelector("[data-confirm]").onclick = async () => {
        await adminFetch("/api/admin-bookings", {
          method: "PATCH",
          body: JSON.stringify({
            id: booking.id,
            status: "confirmed"
          })
        })

        await loadBookings()
      }

      card.querySelector("[data-reject]").onclick = async () => {
        await adminFetch("/api/admin-bookings", {
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

        await adminFetch(`/api/admin-bookings?id=${booking.id}`, {
          method: "DELETE"
        })

        await loadBookings()
      }

      column.appendChild(card)
    })

    bookingsBoard.appendChild(column)
  })
}

const manualBookingForm = document.getElementById("manual-booking-form")

if (manualBookingForm) {
  manualBookingForm.onsubmit = async (event) => {
    event.preventDefault()

    const times = Array.from(document.getElementById("manual-time").selectedOptions)
      .map((option) => option.value)

    const rigs = document.getElementById("manual-rigs").value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

    const payload = {
      name: document.getElementById("manual-name").value.trim(),
      phone: document.getElementById("manual-phone").value.trim(),
      email: document.getElementById("manual-email").value.trim(),
      date: document.getElementById("manual-date").value,
      times,
      rigs,
      totalHNL: Number(document.getElementById("manual-total").value || 0)
    }

    if (!payload.name || !payload.phone || !payload.email || !payload.date || !times.length || !rigs.length) {
      alert("Llená todos los campos de la reserva manual.")
      return
    }

    await adminFetch("/api/admin-bookings", {
      method: "POST",
      body: JSON.stringify(payload)
    })

    manualBookingForm.reset()
    await loadBookings()
    alert("Reserva manual creada.")
  }
}
