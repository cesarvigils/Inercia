import { auth, db } from '../firebase-config.js';

import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
    setPersistence,
    browserLocalPersistence
} from 'firebase/auth';
import {
    getStorage,
    ref,
    getDownloadURL
} from 'firebase/storage';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    serverTimestamp,
    writeBatch
} from 'firebase/firestore';

// DOM helpers
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// DOM references
const storage = getStorage(auth.app);
const loginScreen = $('#loginScreen');
const adminShell = $('#adminShell');
const loginForm = $('#loginForm');
const loginMessage = $('#loginMessage');

// State variables
let currentUser = null;
let reservations = [];
let rigs = [];
let sales = [];
let range = 'month';
let selectedReservation = null;

// Utility functions
const money = (v) => `L ${Number(v || 0).toLocaleString("es-HN")}`;

const esc = (v) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );

const today = () => {
    let d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const ftime = (v) => {
    if (!v) return "N/D";
    let [h, m] = v.split(":").map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

const fdate = (v) => (v ? String(v).split("-").reverse().join("/") : "N/D");

const dt = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

// Authorization check
async function authorized(u) {
    if (!u) return false;
    let s = await getDoc(doc(db, "adminUsers", u.uid));
    return s.exists() && s.data().enabled === true;
}

// Set persistence
setPersistence(auth, browserLocalPersistence).catch(console.error);

// Login handler
loginForm.onsubmit = async (e) => {
    e.preventDefault();
    let b = e.currentTarget.querySelector("button");
    b.disabled = true;
    b.textContent = "VERIFICANDO...";
    loginMessage.hidden = true;
    try {
        let c = await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
        if (!(await authorized(c.user))) {
            await signOut(auth);
            throw Error("unauthorized");
        }
    } catch (x) {
        loginMessage.textContent =
            x.message === "unauthorized" ? "Esta cuenta no tiene acceso al panel." : "Correo o contraseña incorrectos.";
        loginMessage.hidden = false;
    } finally {
        b.disabled = false;
        b.textContent = "INICIAR SESIÓN";
    }
};

// Logout handler
$('#logoutBtn').onclick = () => signOut(auth);

// Auth state listener
onAuthStateChanged(auth, async (u) => {
    if (!u) {
        adminShell.hidden = true;
        loginScreen.hidden = false;
        return;
    }
    if (!(await authorized(u))) {
        await signOut(auth);
        return;
    }
    currentUser = u;
    $('#adminEmail').textContent = u.email || u.uid;
    loginScreen.hidden = true;
    adminShell.hidden = false;
    listen();
});

// Navigation
$$(".nav").forEach(
    (b) =>
        (b.onclick = () => {
            $$(".nav").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
            $$(".view").forEach((x) => x.classList.remove("active"));
            $(`#view-${b.dataset.view}`).classList.add("active");
            $("#viewTitle").textContent = b.textContent;
        })
);

// Calendar navigation
$("#calendarDate").value = today();
$("#calendarDate").onchange = renderCalendar;

function shift(n) {
    let d = new Date($("#calendarDate").value + "T12:00");
    d.setDate(d.getDate() + n);
    $("#calendarDate").value = d.toISOString().slice(0, 10);
    renderCalendar();
}

$("#prevDay").onclick = () => shift(-1);
$("#nextDay").onclick = () => shift(1);

// Listen to Firestore changes
function listen() {
    onSnapshot(collection(db, "reservations"), (s) => {
        reservations = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderCalendar();
        renderSales();
    });
    onSnapshot(collection(db, "rigs"), (s) => {
        rigs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
        renderRigs();
        renderCalendar();
    });
    onSnapshot(collection(db, "sales"), (s) => {
        sales = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderSales();
    });
    loadSettings();
}
function normalizeRigType(value) {
    return String(value || "")
        .trim()
        .toLowerCase() === "premium"
        ? "premium"
        : "standard";
}

function rigNumber(rig) {
    const type = normalizeRigType(rig.type);

    // Primero usamos number si existe.
    if (rig.number != null) {
        return Number(rig.number);
    }

    // Si el order global es 1-10:
    // Standard 1-8
    // Premium 9-10 -> Premium 1-2
    if (rig.order != null) {
        const order = Number(rig.order);

        if (type === "premium" && order > 8) {
            return order - 8;
        }

        return order;
    }

    // Último fallback: sacar número del nombre.
    const match = String(rig.name || "").match(/\d+/);

    return match
        ? Number(match[0])
        : 0;
}

function displayRigName(rig) {
    const type = normalizeRigType(rig.type);
    const number = rigNumber(rig);

    return `${type === "premium" ? "Premium" : "Standard"} ${number}`;
}
// Active rigs helper
function activeRigs() {
    const active = rigs
        .filter(rig => rig.status !== "disabled")
        .map(rig => ({
            ...rig,
            type: normalizeRigType(rig.type)
        }));

    return active.sort((a, b) => {
        // Standard siempre primero.
        if (a.type !== b.type) {
            return a.type === "standard"
                ? -1
                : 1;
        }

        return rigNumber(a) - rigNumber(b);
    });
}
function rr(reservation) {
    return reservation.rigs ||
           reservation.simulators ||
           [];
}

function hasRig(reservation, calendarRig) {
    const calendarId =
        String(calendarRig.id || "");

    const calendarType =
        normalizeRigType(calendarRig.type);

    const calendarNumber =
        rigNumber(calendarRig);

    return rr(reservation).some(reserved => {
        /* ============================
           ID
           ============================ */

        if (typeof reserved === "string") {
            // Las reservas nuevas deberían guardar
            // el ID real del rig.
            return reserved === calendarId;
        }

        const reservedId =
            String(
                reserved.id ||
                reserved.rigId ||
                ""
            );

        if (
            reservedId &&
            calendarId &&
            reservedId === calendarId
        ) {
            return true;
        }

        /* ============================
           TYPE + NUMBER
           ============================ */

        const reservedType =
            normalizeRigType(
                reserved.type
            );

        const reservedNumber =
            rigNumber(reserved);

        return (
            reservedType === calendarType &&
            reservedNumber === calendarNumber
        );
    });
}

// Render calendar
function renderCalendar() {
    let date = $("#calendarDate").value,
        rs = activeRigs(),
        list = reservations.filter((r) => r.date === date && ["pending", "approved"].includes(r.status)),
        el = $("#reservationCalendar");
    el.style.setProperty("--rig-count", Math.max(rs.length, 1));
    let h = `<div class="cal-head"><div class="cell">HORA</div>${rs.map((r) => `
    <div class="cell">
        ${esc(displayRigName(r))}
    </div>
`).join("")}</div>`;
    for (let n = 10; n <= 21; n++) {
        let t = `${String(n).padStart(2, "0")}:00`;
        h += `<div class="cal-row"><div class="cell time">${ftime(t)}</div>${rs
            .map((g) => {
                let r = list.find((x) => x.time === t && hasRig(x, g));
                return `<div class="cell">${r ? `<button class="point ${r.status}" data-r="${r.id}"></button>` : ""}</div>`;
            })
            .join("")}</div>`;
    }
    el.innerHTML = h;
    $$("[data-r]").forEach((b) => (b.onclick = () => openReservation(b.dataset.r)));
}

// Payment method formatter
function pay(p) {
    let v = typeof p === "string" ? p : p?.method;
    return (
        { transferencia: "TRANSFERENCIA", tarjeta: "TARJETA", efectivo: "EFECTIVO" }[v] ||
        String(v || "N/D").toUpperCase()
    );
}
async function receipt(r) {
    // Formato actual
    const path =
        r.paymentProof?.path ||
        r.proofPath ||
        null;

    if (path) {
        try {
            return await getDownloadURL(
                ref(storage, path)
            );
        } catch (error) {
            console.error(
                '[ADMIN] No se pudo cargar el comprobante:',
                path,
                error
            );

            return "";
        }
    }

    // Compatibilidad con reservas viejas
    return (
        r.payment?.receiptUrl ||
        r.payment?.proofUrl ||
        r.confirmation?.receiptUrl ||
        r.receiptUrl ||
        ""
    );
}

// Open reservation detail
async function openReservation(id) {
    const r =
        reservations.find(
            x => x.id === id
        );

    if (!r) {
        console.error(
            '[ADMIN] Reserva no encontrada:',
            id
        );
        return;
    }

    const c =
        r.customer || {};

    const url =
        await receipt(r);

    const names =
        rr(r)
            .map(x =>
                typeof x === "string"
                    ? x
                    : x.name ||
                      `${x.type || "Rig"} ${
                          x.order ??
                          x.number ??
                          ""
                      }`
            )
            .join(", ") ||
        "N/D";

    $("#reservationDetail").innerHTML = `
        <div class="detail-grid">
            ${[
                ["CÓDIGO", r.code],
                ["CLIENTE", c.name],
                ["TELÉFONO", c.phone || c.phoneNumber],
                ["CORREO", c.email],
                ["FECHA", r.date],
                ["HORA", ftime(r.time)],
                ["DURACIÓN", `${r.duration || 1} H`],
                ["TOTAL", money(r.pricing?.total ?? r.total)],
                ["PAGO", pay(r.payment)],
                ["RIGS", names]
            ]
                .map(
                    x => `
                        <div class="detail">
                            <span>${x[0]}</span>
                            <strong>
                                ${esc(x[1] || "N/D")}
                            </strong>
                        </div>
                    `
                )
                .join("")}
        </div>

        ${
            url
                ? `
                    <div class="receipt">
                        ${
                            r.paymentProof?.contentType
                                ?.startsWith("image/")
                                ? `
                                    <img
                                        src="${esc(url)}"
                                        alt="Comprobante de pago"
                                    >
                                `
                                : ""
                        }

                        <a
                            href="${esc(url)}"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            VER COMPROBANTE COMPLETO
                        </a>
                    </div>
                `
                : `
                    <div class="receipt">
                        SIN COMPROBANTE ADJUNTO
                    </div>
                `
        }

        ${
            r.status === "pending"
                ? `
                    <div class="actions">
                        <button
                            id="reject"
                            class="danger"
                        >
                            RECHAZAR
                        </button>

                        <button
                            id="approve"
                            class="primary"
                        >
                            APROBAR
                        </button>
                    </div>
                `
                : ""
        }
    `;

    $("#drawerBackdrop").hidden =
        false;

    $("#drawer").classList.add(
        "open"
    );

    $("#approve")
        ?.addEventListener(
            "click",
            () => approve(r)
        );

    $("#reject")
        ?.addEventListener(
            "click",
            () => reject(r)
        );
}

// Close drawer
function closeDrawer() {
    $("#drawer").classList.remove("open");
    $("#drawerBackdrop").hidden = true;
}

$("#drawerClose").onclick = closeDrawer;
$("#drawerBackdrop").onclick = closeDrawer;

// Approve reservation
async function approve(r) {
    await updateDoc(doc(db, "reservations", r.id), {
        status: "approved",
        "confirmation.status": "approved",
        "confirmation.approvedAt": serverTimestamp(),
        "confirmation.approvedBy": currentUser.uid,
        updatedAt: serverTimestamp(),
    });
    closeDrawer();
}

// Reject reservation
async function reject(r) {
    let q = await getDocs(query(collection(db, "reservationLocks"), where("reservationId", "==", r.id))),
        b = writeBatch(db);
    b.update(doc(db, "reservations", r.id), {
        status: "rejected",
        "confirmation.status": "rejected",
        "confirmation.rejectedAt": serverTimestamp(),
        "confirmation.rejectedBy": currentUser.uid,
        updatedAt: serverTimestamp(),
    });
    q.forEach((x) => b.delete(x.ref));
    await b.commit();
    closeDrawer();
}

// Status formatter
function status(s) {
    return { active: "DISPONIBLE", maintenance: "MANTENIMIENTO", disabled: "DESACTIVADO" }[s] || "DISPONIBLE";
}

// Render rigs
function renderRigs() {
    let c = {
        total: rigs.length,
        active: rigs.filter((x) => x.status === "active").length,
        maintenance: rigs.filter((x) => x.status === "maintenance").length,
        disabled: rigs.filter((x) => x.status === "disabled").length,
    };
    $("#rigMetrics").innerHTML = [
        ["TOTAL", c.total],
        ["DISPONIBLES", c.active],
        ["MANTENIMIENTO", c.maintenance],
        ["DESACTIVADOS", c.disabled],
    ]
        .map((x) => `<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong></div>`)
        .join("");
    $("#rigList").innerHTML = rigs
        .map(
            (r) =>
                `<div class="rig"><div class="num">${String(r.order ?? "--").padStart(2, "0")}</div><div><strong>${esc(r.name)} <span class="status ${r.status}">${status(r.status)}</span></strong><small>${String(r.type || "standard").toUpperCase()} · ${money(r.pricePerHour ?? (r.type === "premium" ? 350 : 200))}/H</small></div><button class="mini" data-edit="${r.id}">EDITAR</button></div>`
        )
        .join("");
    $$("[data-edit]").forEach((b) => (b.onclick = () => rigModal(rigs.find((x) => x.id === b.dataset.edit))));
}

$("#newRigBtn").onclick = () => rigModal();

// Rig modal
function rigModal(r) {
    modal(
        `<span class="eyebrow">${r ? "MODIFICAR" : "NUEVO"} RIG</span><h2>${r ? "EDITAR" : "CREAR"} SIMULADOR</h2><form id="rigForm"><label>NOMBRE<input id="rn" value="${esc(r?.name || "")}" required></label><label>ORDEN<input id="ro" type="number" value="${r?.order ?? ""}" required></label><label>TIPO<select id="rt"><option value="standard">STANDARD</option><option value="premium" ${r?.type === "premium" ? "selected" : ""}>PREMIUM</option></select></label><label>PRECIO/H<input id="rp" type="number" value="${r?.pricePerHour ?? (r?.type === "premium" ? 350 : 200)}"></label><label>ESTADO<select id="rs"><option value="active">DISPONIBLE</option><option value="maintenance" ${r?.status === "maintenance" ? "selected" : ""}>MANTENIMIENTO</option><option value="disabled" ${r?.status === "disabled" ? "selected" : ""}>DESACTIVADO</option></select></label><button class="primary">GUARDAR</button>${r ? '<button type="button" id="delRig" class="danger">ELIMINAR</button>' : ""}</form>`
    );
    $("#rigForm").onsubmit = async (e) => {
        e.preventDefault();
        let d = {
            name: $("#rn").value.trim(),
            order: +$("#ro").value,
            type: $("#rt").value,
            pricePerHour: +$("#rp").value,
            status: $("#rs").value,
            updatedAt: serverTimestamp(),
        };
        r
            ? await updateDoc(doc(db, "rigs", r.id), d)
            : await addDoc(collection(db, "rigs"), { ...d, createdAt: serverTimestamp() });
        closeModal();
    };
    $("#delRig")?.addEventListener("click", async () => {
        if (confirm("¿Eliminar este rig?")) {
            await deleteDoc(doc(db, "rigs", r.id));
            closeModal();
        }
    });
}

// Sales filters
$$(".filter").forEach(
    (b) =>
        (b.onclick = () => {
            $$(".filter").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
            range = b.dataset.range;
            renderSales();
        })
);

// Check if date is within range
function inside(d) {
    if (!d) return false;
    let n = new Date();
    if (range === "year") return d.getFullYear() === n.getFullYear();
    if (range === "month") return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    let s = new Date(n);
    s.setHours(0, 0, 0, 0);
    s.setDate(n.getDate() - ((n.getDay() + 6) % 7));
    let e = new Date(s);
    e.setDate(s.getDate() + 7);
    return d >= s && d < e;
}

// Render sales
function renderSales() {
    let a = reservations
        .filter((r) => r.status === "approved")
        .map((r) => ({
            type: "reservation",
            description: `Reserva ${r.code || r.id}`,
            total: +(r.pricing?.total || 0),
            paymentMethod: typeof r.payment === "string" ? r.payment : r.payment?.method,
            date: dt(r.confirmation?.approvedAt) || dt(r.updatedAt) || dt(r.createdAt),
        })),
        b = sales.map((s) => ({ ...s, type: s.type || "manual", date: dt(s.createdAt), total: +s.total || 0 })),
        rows = [...a, ...b].filter((x) => inside(x.date)).sort((a, b) => b.date - a.date),
        total = rows.reduce((a, b) => a + b.total, 0);
    $("#salesMetrics").innerHTML = [
        ["VENTAS TOTALES", money(total)],
        ["TRANSACCIONES", rows.length],
        ["PROMEDIO", money(rows.length ? total / rows.length : 0)],
        ["RESERVAS", rows.filter((x) => x.type === "reservation").length],
    ]
        .map((x) => `<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong></div>`)
        .join("");
    $("#salesTable").innerHTML = rows.length
        ? rows
            .map(
                (s) =>
                    `<tr><td>${s.date ? s.date.toLocaleDateString("es-HN") : "N/D"}</td><td>${esc(s.description || "Venta")}</td><td>${pay(s.paymentMethod)}</td><td>${s.type === "reservation" ? "RESERVA" : "MANUAL"}</td><td>${money(s.total)}</td></tr>`
            )
            .join("")
        : '<tr><td colspan="5">No hay ventas en este período.</td></tr>';
}

// New sale modal
$("#newSaleBtn").onclick = () => {
    modal(
        `<span class="eyebrow">VENTA ADMINISTRATIVA</span><h2>NUEVA VENTA</h2><form id="saleForm"><label>PRODUCTO / CONCEPTO<input id="sd" required></label><label>CANTIDAD<input id="sq" type="number" min="1" value="1"></label><label>PRECIO UNITARIO<input id="sp" type="number" min="0" required></label><label>MÉTODO<select id="sm"><option value="efectivo">EFECTIVO</option><option value="transferencia">TRANSFERENCIA</option><option value="tarjeta">TARJETA</option></select></label><button class="primary">REGISTRAR VENTA</button></form>`
    );
    $("#saleForm").onsubmit = async (e) => {
        e.preventDefault();
        let q = +$("#sq").value,
            p = +$("#sp").value;
        await addDoc(collection(db, "sales"), {
            type: "manual",
            description: $("#sd").value.trim(),
            quantity: q,
            unitPrice: p,
            total: q * p,
            paymentMethod: $("#sm").value,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
        });
        closeModal();
    };
};

// Modal functions
function modal(h) {
    $("#modalContent").innerHTML = h;
    $("#modalBackdrop").hidden = false;
}

function closeModal() {
    $("#modalBackdrop").hidden = true;
    $("#modalContent").innerHTML = "";
}

$("#modalClose").onclick = closeModal;
$("#modalBackdrop").onclick = (e) => {
    if (e.target === $("#modalBackdrop")) closeModal();
};

// Load settings
async function loadSettings() {
    let s = await getDoc(doc(db, "settings", "reservations"));
    if (s.exists()) {
        let d = s.data();
        $("#standardPrice").value = d.pricing?.standard ?? 200;
        $("#premiumPrice").value = d.pricing?.premium ?? 350;
        $("#mondayClosed").checked = d.schedule?.mondayClosed ?? true;
        $("#weekdayStart").value = d.schedule?.weekdayStart ?? "14:00";
    }
}

// Pricing form
$("#pricingForm").onsubmit = async (e) => {
    e.preventDefault();
    await setDoc(
        doc(db, "settings", "reservations"),
        {
            pricing: { standard: +$("#standardPrice").value, premium: +$("#premiumPrice").value },
            updatedAt: serverTimestamp(),
        },
        { merge: true }
    );
};

// Schedule form
$("#scheduleForm").onsubmit = async (e) => {
    e.preventDefault();
    await setDoc(
        doc(db, "settings", "reservations"),
        {
            schedule: { mondayClosed: $("#mondayClosed").checked, weekdayStart: $("#weekdayStart").value },
            updatedAt: serverTimestamp(),
        },
        { merge: true }
    );
};