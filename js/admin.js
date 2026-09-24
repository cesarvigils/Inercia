import { auth, db } from '../firebase-config.js';

import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
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
    writeBatch,
    runTransaction,
    Timestamp,
        orderBy

} from 'firebase/firestore';

import {
    calculateReservationTotal,
    canEditReservation,
    currentPaymentMethod,
    displayRigName,
    normalizeRigType,
    paymentOptionsFor,
    rigNumber
} from './reservation-logic.js';

import {
    createManualReservation,
    saveReservationEdit
} from './reservation-writes.js';

import { esc, safeUrl } from './html-safety.js';

/*
 * Las funciones de Firestore que usan js/reservation-writes.js, pasadas
 * por parámetro en vez de importadas allá: los tests le pasan el doble en
 * memoria de tests/helpers/fake-firestore.mjs en este mismo lugar.
 */
const firestore = {
    db,
    doc,
    collection,
    runTransaction,
    serverTimestamp,
    timestampFromDate: (date) => Timestamp.fromDate(date)
};

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
let products = [];

// Utility functions
const money = (v) => `L ${Number(v || 0).toLocaleString("es-HN")}`;

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

/*
 * isTuesday(), los helpers de reservationLocks (hm/slotIds/lockExpiresAt/
 * isLockSnapshotActive), los de rigs (normalizeRigType/rigNumber/
 * displayRigName) y el cálculo de totales viven en
 * js/reservation-logic.js, y las dos escrituras de reservas en
 * js/reservation-writes.js. Están afuera de este archivo porque acá todo
 * toca el DOM y el SDK de Firebase apenas se importa, así que nada de
 * esto se podría ejecutar (ni probar) en Node. Ver tests/.
 */

// Authorization check
async function authorized(u) {
    if (!u) return false;
    let s = await getDoc(doc(db, "adminUsers", u.uid));
    return s.exists() && s.data().enabled === true;
}

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
        stopListening();
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

/*
 * Escuchar cambios en Firestore.
 *
 * Cada onSnapshot cobra una lectura por documento al conectarse (y otra
 * por cada cambio después), así que escuchar colecciones enteras hacía que
 * cada recarga del panel leyera TODAS las reservas y ventas desde el
 * inicio. Ahora reservas y ventas se limitan al año en curso, que es lo
 * más atrás que llegan los filtros de ventas ("AÑO"). El calendario ya no
 * muestra reservas de años anteriores.
 *
 * listen() puede volver a llamarse si alguien cierra sesión y vuelve a
 * entrar sin recargar; stopListening() suelta los listeners anteriores
 * para no duplicarlos (cada duplicado vuelve a leer todo).
 */
let unsubscribers = [];

function stopListening() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
}

function startOfYear() {
    return new Date(new Date().getFullYear(), 0, 1);
}

function listen() {
    stopListening();
    const yearStart = startOfYear();
    const yearStartDate = `${yearStart.getFullYear()}-01-01`;
    unsubscribers.push(onSnapshot(query(collection(db, "reservations"), where("date", ">=", yearStartDate)), (s) => {
        reservations = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderCalendar();
        renderSales();
    }));
    unsubscribers.push(onSnapshot(collection(db, "rigs"), (s) => {
        rigs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
        renderRigs();
        renderCalendar();
    }));
    unsubscribers.push(onSnapshot(query(collection(db, "sales"), where("createdAt", ">=", Timestamp.fromDate(yearStart))), (s) => {
        sales = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderSales();
    }));
    unsubscribers.push(onSnapshot(collection(db, "products"), (snapshot) => {
    products = snapshot.docs
        .map(d => ({
            id: d.id,
            ...d.data()
        }))
        .sort((a, b) =>
            String(a.name || "").localeCompare(
                String(b.name || "")
            )
        );
}));
    loadSettings();
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
                return `<div class="cell">${r ? `<button class="point ${esc(r.status)}" data-r="${esc(r.id)}"></button>` : ""}</div>`;
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
        safeUrl(await receipt(r));

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
            /*
             * EDITAR queda disponible en pending Y approved: una reserva
             * de PayPal (que se aprueba sola al capturarse el pago) podía
             * necesitar el mismo tipo de corrección que una pendiente, y
             * antes no había ninguna forma de tocarla salvo rechazarla.
             * RECHAZAR/APROBAR siguen siendo solo para pending — no tiene
             * sentido "aprobar" o "rechazar" algo que ya se resolvió.
             * Una reserva rejected no se puede editar: ya no cuenta para
             * el calendario ni para disponibilidad.
             */
            canEditReservation(r.status)
                ? `
                    <div class="actions">
                        <button
                            id="editReservation"
                            class="ghost"
                        >
                            EDITAR
                        </button>

                        ${
                            r.status === "pending"
                                ? `
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
                                `
                                : ""
                        }
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

    $("#editReservation")
        ?.addEventListener(
            "click",
            () => openEditReservation(r)
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

/*
 * Edit a pending reservation's date/time/duration, simulators and payment
 * method before approving or rejecting it. Before this existed, the only
 * way to fix a mistake in a manually-created (or customer-submitted)
 * pending reservation was to reject it and create a new one from scratch —
 * which, on top of being slower, made the WhatsApp bot send the client a
 * fresh "reserva pendiente"/"reserva aprobada" PDF for every throwaway
 * attempt.
 */
function openEditReservation(r) {
    const availableRigs =
        activeRigs();

    const timeOptions = Array.from(
        { length: 12 },
        (_, i) => {
            const hour = i + 10;
            const value = `${String(hour).padStart(2, "0")}:00`;

            return `
                <option
                    value="${value}"
                    ${value === r.time ? "selected" : ""}
                >
                    ${ftime(value)}
                </option>
            `;
        }
    ).join("");

    const currentRigIds = new Set(
        availableRigs
            .filter((rig) => hasRig(r, rig))
            .map((rig) => rig.id)
    );

    const rigOptions = availableRigs
        .map((rig) => `
            <label class="admin-rig-option">
                <input
                    type="checkbox"
                    name="erRig"
                    value="${esc(rig.id)}"
                    ${currentRigIds.has(rig.id) ? "checked" : ""}
                >

                <span>${esc(displayRigName(rig))}</span>
            </label>
        `)
        .join("");

    const currentPayment = currentPaymentMethod(r);

    const paymentOptions = paymentOptionsFor(currentPayment);

    const durationOptions = [1, 2, 3, 4]
        .map((h) => `
            <option
                value="${h}"
                ${Number(r.duration) === h ? "selected" : ""}
            >
                ${h} HORA${h > 1 ? "S" : ""}
            </option>
        `)
        .join("");

    modal(`
        <span class="eyebrow">
            RESERVA ADMINISTRATIVA
        </span>

        <h2>EDITAR RESERVA</h2>

        <form id="editReservationForm">

            <div class="form-row">

                <label>
                    FECHA
                    <input
                        id="erDate"
                        type="date"
                        value="${esc(r.date)}"
                        required
                    >
                </label>

                <label>
                    HORA
                    <select
                        id="erTime"
                        required
                    >
                        ${timeOptions}
                    </select>
                </label>

            </div>

            <label>
                DURACIÓN

                <select id="erDuration">
                    ${durationOptions}
                </select>
            </label>

            <div>
                <label>SIMULADORES</label>

                <div class="admin-rig-select">
                    ${rigOptions}
                </div>
            </div>

            <label>
                MÉTODO DE PAGO

                <select id="erPayment">
                    ${paymentOptions
                        .map((option) => `
                            <option
                                value="${esc(option.value)}"
                                ${option.selected ? "selected" : ""}
                            >
                                ${esc(option.label)}
                            </option>
                        `)
                        .join("")}
                </select>
            </label>

            <div class="manual-total">
                <span>TOTAL</span>

                <strong id="erTotal">
                    L 0
                </strong>
            </div>

            <button
                type="submit"
                class="primary"
            >
                GUARDAR CAMBIOS
            </button>

        </form>
    `);


    /* =========================================================
       CALCULAR TOTAL
       ========================================================= */

    function calculateEditTotal() {
        const result = calculateReservationTotal({
            rigs: availableRigs,

            selectedIds: $$(
                'input[name="erRig"]:checked'
            ).map((input) => input.value),

            duration: $("#erDuration").value,
            date: $("#erDate").value
        });

        $("#erTotal").textContent = result.tuesdayDiscount
            ? `${money(result.total)} (-50% MARTES)`
            : money(result.total);

        return result;
    }

    $$('input[name="erRig"]').forEach(
        (input) => {
            input.addEventListener(
                "change",
                calculateEditTotal
            );
        }
    );

    $("#erDuration").addEventListener(
        "change",
        calculateEditTotal
    );

    $("#erDate").addEventListener(
        "change",
        calculateEditTotal
    );


    /* =========================================================
       GUARDAR CAMBIOS

       Reconcilia los reservationLocks viejos contra los nuevos
       dentro de una transacción: solo se revisan (y pueden
       bloquear el guardado) los slots que la reserva NO tenía
       ya — los que se mantienen entre el horario viejo y el
       nuevo no se tocan, y los que ya no hacen falta se liberan.
       ========================================================= */

    $("#editReservationForm").onsubmit =
        async (event) => {
            event.preventDefault();

            const submitButton =
                event.currentTarget.querySelector(
                    'button[type="submit"]'
                );

            const {
                subtotal,
                tuesdayDiscount,
                total,
                selectedRigs
            } = calculateEditTotal();

            if (!selectedRigs.length) {
                alert(
                    "Seleccioná al menos un simulador."
                );
                return;
            }

            const date =
                $("#erDate").value;

            const time =
                $("#erTime").value;

            const duration =
                Number($("#erDuration").value);


            submitButton.disabled = true;
            submitButton.textContent =
                "GUARDANDO...";

            try {

                await saveReservationEdit(
                    firestore,
                    {
                        reservation: r,
                        currentRigIds: [...currentRigIds],
                        date,
                        time,
                        duration,
                        selectedRigs,

                        paymentMethod:
                            $("#erPayment").value,

                        pricing: {
                            subtotal,
                            tuesdayDiscount,
                            total
                        },

                        uid: auth.currentUser.uid
                    }
                );

                closeModal();
                closeDrawer();

            } catch (error) {

                console.error(
                    "[ADMIN] Error editando reserva:",
                    error
                );

                alert(
                    error?.code === "slot-taken"
                        ? error.message
                        : "No se pudieron guardar los cambios."
                );

                submitButton.disabled = false;
                submitButton.textContent =
                    "GUARDAR CAMBIOS";
            }
        };

    calculateEditTotal();
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
                `<div class="rig"><div class="num">${esc(String(r.order ?? "--").padStart(2, "0"))}</div><div><strong>${esc(r.name)} <span class="status ${esc(r.status)}">${status(r.status)}</span></strong><small>${esc(String(r.type || "standard").toUpperCase())} · ${money(r.pricePerHour ?? (r.type === "premium" ? 350 : 200))}/H</small></div><button class="mini" data-edit="${esc(r.id)}">EDITAR</button></div>`
        )
        .join("");
    $$("[data-edit]").forEach((b) => (b.onclick = () => rigModal(rigs.find((x) => x.id === b.dataset.edit))));
}

$("#newRigBtn").onclick = () => rigModal();

// Rig modal
function rigModal(r) {
    modal(
        `<span class="eyebrow">${r ? "MODIFICAR" : "NUEVO"} RIG</span><h2>${r ? "EDITAR" : "CREAR"} SIMULADOR</h2><form id="rigForm"><label>NOMBRE<input id="rn" value="${esc(r?.name || "")}" required></label><label>ORDEN<input id="ro" type="number" value="${esc(r?.order ?? "")}" required></label><label>TIPO<select id="rt"><option value="standard">STANDARD</option><option value="premium" ${r?.type === "premium" ? "selected" : ""}>PREMIUM</option></select></label><label>PRECIO/H<input id="rp" type="number" value="${esc(r?.pricePerHour ?? (r?.type === "premium" ? 350 : 200))}"></label><label>ESTADO<select id="rs"><option value="active">DISPONIBLE</option><option value="maintenance" ${r?.status === "maintenance" ? "selected" : ""}>MANTENIMIENTO</option><option value="disabled" ${r?.status === "disabled" ? "selected" : ""}>DESACTIVADO</option></select></label><button class="primary">GUARDAR</button>${r ? '<button type="button" id="delRig" class="danger">ELIMINAR</button>' : ""}</form>`
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
                    `<tr><td>${s.date ? s.date.toLocaleDateString("es-HN") : "N/D"}</td><td>${esc(s.description || "Venta")}</td><td>${esc(pay(s.paymentMethod))}</td><td>${s.type === "reservation" ? "RESERVA" : "MANUAL"}</td><td>${money(s.total)}</td></tr>`
            )
            .join("")
        : '<tr><td colspan="5">No hay ventas en este período.</td></tr>';
}

// New sale modal
$("#newSaleBtn").onclick = () => {
    const activeProducts =
        products.filter(
            product =>
                product.active !== false
        );

    modal(`
        <span class="eyebrow">
            VENTA ADMINISTRATIVA
        </span>

        <h2>NUEVA VENTA</h2>

        <form id="saleForm">

            <label>
                PRODUCTO

                <select id="saleProduct">
                    <option value="">
                        OTRO / MANUAL
                    </option>

                    ${activeProducts.map(product => `
                        <option
                            value="${esc(product.id)}"
                        >
                            ${esc(product.name)}
                            — ${money(product.price)}
                        </option>
                    `).join("")}
                </select>
            </label>

            <label>
                PRODUCTO / CONCEPTO
                <input
                    id="sd"
                    required
                >
            </label>

            <label>
                CANTIDAD
                <input
                    id="sq"
                    type="number"
                    min="1"
                    value="1"
                    required
                >
            </label>

            <label>
                PRECIO UNITARIO
                <input
                    id="sp"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                >
            </label>

            <label>
                MÉTODO
                <select id="sm">

                    <option value="efectivo">
                        EFECTIVO
                    </option>

                    <option value="transferencia">
                        TRANSFERENCIA
                    </option>

                    <option value="tarjeta">
                        TARJETA
                    </option>

                </select>
            </label>

            <div class="manual-total">
                <span>TOTAL</span>
                <strong id="saleTotal">
                    L 0
                </strong>
            </div>

            <button class="primary">
                REGISTRAR VENTA
            </button>

        </form>
    `);

    const calculate = () => {
        const quantity =
            Number($("#sq").value) || 0;

        const price =
            Number($("#sp").value) || 0;

        $("#saleTotal").textContent =
            money(quantity * price);
    };

    $("#saleProduct").onchange = e => {
        const product =
            products.find(
                p => p.id === e.target.value
            );

        if (!product) {
            $("#sd").value = "";
            $("#sp").value = "";
            calculate();
            return;
        }

        $("#sd").value =
            product.name;

        $("#sp").value =
            Number(product.price || 0);

        calculate();
    };

    $("#sq").oninput = calculate;
    $("#sp").oninput = calculate;

    $("#saleForm").onsubmit =
        async e => {
            e.preventDefault();

            const quantity =
                Number($("#sq").value);

            const unitPrice =
                Number($("#sp").value);

            const productId =
                $("#saleProduct").value ||
                null;

            await addDoc(
                collection(db, "sales"),
                {
                    type: "manual",

                    productId,

                    description:
                        $("#sd")
                            .value
                            .trim(),

                    quantity,

                    unitPrice,

                    total:
                        quantity *
                        unitPrice,

                    paymentMethod:
                        $("#sm").value,

                    createdBy:
auth.currentUser.uid,
                    createdAt:
                        serverTimestamp()
                }
            );

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
$("#manageProductsBtn").onclick = () => {
    renderProductsModal();
};

function renderProductsModal() {
    modal(`
        <span class="eyebrow">
            CATÁLOGO INTERNO
        </span>

        <h2>PRODUCTOS</h2>

        <form id="productForm">

            <label>
                NOMBRE
                <input
                    id="productName"
                    required
                >
            </label>

            <label>
                PRECIO
                <input
                    id="productPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                >
            </label>

            <button class="primary">
                AGREGAR PRODUCTO
            </button>

        </form>

        <div class="product-admin-list">

            ${products.length
                ? products.map(product => `
                    <div class="product-admin-item">

                        <div>
                            <strong>
                                ${esc(product.name)}
                            </strong>

                            <small>
                                ${money(product.price)}
                            </small>
                        </div>

                        <button
                            type="button"
                            class="danger product-delete"
                            data-product="${esc(product.id)}"
                        >
                            ELIMINAR
                        </button>

                    </div>
                `).join("")
                : `
                    <div class="empty-admin">
                        NO HAY PRODUCTOS CREADOS
                    </div>
                `
            }

        </div>
    `);

    $("#productForm").onsubmit =
        async e => {
            e.preventDefault();

            await addDoc(
                collection(db, "products"),
                {
                    name:
                        $("#productName")
                            .value
                            .trim(),

                    price:
                        Number(
                            $("#productPrice").value
                        ),

                    active: true,

                    createdBy:
                        auth.currentUser.uid,
                    createdAt:
                        serverTimestamp(),

                    updatedAt:
                        serverTimestamp()
                }
            );

            closeModal();
        };

    $$(".product-delete").forEach(button => {
        button.onclick = async () => {
            if (
                !confirm(
                    "¿Eliminar este producto?"
                )
            ) {
                return;
            }

            await deleteDoc(
                doc(
                    db,
                    "products",
                    button.dataset.product
                )
            );

            closeModal();
        };
    });
}
$("#newReservationBtn").onclick = () => {
    const availableRigs = activeRigs();

    /* =========================================================
       GENERAR OPCIONES DE HORA
       ========================================================= */

    const timeOptions = Array.from(
        { length: 12 },
        (_, i) => {
            const hour = i + 10;
            const value = `${String(hour).padStart(2, "0")}:00`;

            return `
                <option value="${value}">
                    ${ftime(value)}
                </option>
            `;
        }
    ).join("");


    /* =========================================================
       GENERAR RIGS
       ========================================================= */

    const rigOptions = availableRigs
        .map((rig) => {
            const name =
                typeof displayRigName === "function"
                    ? displayRigName(rig)
                    : rig.name;

            return `
                <label class="admin-rig-option">
                    <input
                        type="checkbox"
                        name="manualRig"
                        value="${esc(rig.id)}"
                    >

                    <span>${esc(name)}</span>
                </label>
            `;
        })
        .join("");


    /* =========================================================
       MODAL
       ========================================================= */

    modal(`
        <span class="eyebrow">
            RESERVA ADMINISTRATIVA
        </span>

        <h2>NUEVA RESERVA</h2>

        <form id="manualReservationForm">

            <label>
                NOMBRE
                <input
                    id="mrName"
                    type="text"
                    required
                >
            </label>

            <label>
                USUARIO / CORREO
                <input
                    id="mrUser"
                    type="text"
                    placeholder="Opcional"
                >
            </label>

            <label>
                TELÉFONO
                <input
                    id="mrPhone"
                    type="tel"
                    placeholder="Opcional"
                >
            </label>

            <div class="form-row">

                <label>
                    FECHA
                    <input
                        id="mrDate"
                        type="date"
                        value="${today()}"
                        required
                    >
                </label>

                <label>
                    HORA
                    <select
                        id="mrTime"
                        required
                    >
                        ${timeOptions}
                    </select>
                </label>

            </div>

            <label>
                DURACIÓN

                <select id="mrDuration">
                    <option value="1">1 HORA</option>
                    <option value="2">2 HORAS</option>
                    <option value="3">3 HORAS</option>
                    <option value="4">4 HORAS</option>
                </select>
            </label>

            <div>
                <label>SIMULADORES</label>

                <div class="admin-rig-select">
                    ${rigOptions}
                </div>
            </div>

            <label>
                MÉTODO DE PAGO

                <select id="mrPayment">
                    <option value="efectivo">
                        EFECTIVO
                    </option>

                    <option value="transferencia">
                        TRANSFERENCIA
                    </option>

                    <option value="tarjeta">
                        TARJETA
                    </option>
                </select>
            </label>

            <label>
                ESTADO

                <select id="mrStatus">
                    <option value="approved">
                        APROBADA
                    </option>

                    <option value="pending">
                        PENDIENTE
                    </option>
                </select>
            </label>

            <div class="manual-total">
                <span>TOTAL</span>

                <strong id="mrTotal">
                    L 0
                </strong>
            </div>

            <button
                type="submit"
                class="primary"
            >
                CREAR RESERVA
            </button>

        </form>
    `);


    /* =========================================================
       CALCULAR TOTAL
       ========================================================= */

    function calculateTotal() {
        const result = calculateReservationTotal({
            rigs: availableRigs,

            selectedIds: $$(
                'input[name="manualRig"]:checked'
            ).map((input) => input.value),

            duration: $("#mrDuration").value,
            date: $("#mrDate").value
        });

        $("#mrTotal").textContent = result.tuesdayDiscount
            ? `${money(result.total)} (-50% MARTES)`
            : money(result.total);

        return result;
    }


    /* =========================================================
       EVENTOS
       ========================================================= */

    $$('input[name="manualRig"]').forEach(
        (input) => {
            input.addEventListener(
                "change",
                calculateTotal
            );
        }
    );

    $("#mrDuration").addEventListener(
        "change",
        calculateTotal
    );

    $("#mrDate").addEventListener(
        "change",
        calculateTotal
    );


    /* =========================================================
       CREAR RESERVA
       ========================================================= */

    $("#manualReservationForm").onsubmit =
        async (event) => {
            event.preventDefault();

            const submitButton =
                event.currentTarget.querySelector(
                    'button[type="submit"]'
                );

            const {
                subtotal,
                tuesdayDiscount,
                total,
                selectedRigs
            } = calculateTotal();


            /* -------------------------
               VALIDACIONES
               ------------------------- */

            const name =
                $("#mrName").value.trim();

            if (!name) {
                alert(
                    "Ingresá el nombre del cliente."
                );
                return;
            }

            if (!selectedRigs.length) {
                alert(
                    "Seleccioná al menos un simulador."
                );
                return;
            }


            /* -------------------------
               DATOS
               ------------------------- */

            const status =
                $("#mrStatus").value;

            const duration =
                Number(
                    $("#mrDuration").value
                );

            const email =
                $("#mrUser").value.trim();

            const phone =
                $("#mrPhone").value.trim();

            const code =
                `ADM-${Date.now()
                    .toString()
                    .slice(-6)}`;


            /* -------------------------
               DESACTIVAR BOTÓN
               ------------------------- */

            submitButton.disabled = true;
            submitButton.textContent =
                "CREANDO...";


            const date =
                $("#mrDate").value;

            const time =
                $("#mrTime").value;

            try {

                /* =============================
                   CREAR RESERVA + LOCKS

                   En una transacción: primero se revisa que ningún
                   simulador elegido tenga ya un lock activo para ese
                   horario (igual que api/reservations/create.js en el
                   sitio público), y solo si todos están libres se crea
                   la reserva junto con sus reservationLocks. Antes esto
                   solo creaba el doc de `reservations`, sin revisar ni
                   dejar lock — lo que permitía reservar encima de un
                   horario ya tomado (silenciosamente: el calendario del
                   panel solo muestra un punto por celda) y dejaba ese
                   horario libre para el sitio público, que sí respeta
                   reservationLocks.
                   ============================= */

                await createManualReservation(
                    firestore,
                    {
                        date,
                        time,
                        duration,
                        selectedRigs,

                        customer: {
                            name,
                            email,
                            phone
                        },

                        paymentMethod:
                            $("#mrPayment").value,

                        status,
                        code,

                        uid: auth.currentUser.uid,

                        pricing: {
                            subtotal,
                            tuesdayDiscount,
                            total
                        }
                    }
                );


                /* =============================
                   TERMINADO
                   ============================= */

                closeModal();

            } catch (error) {

                console.error(
                    "[ADMIN] Error creando reserva manual:",
                    error
                );

                alert(
                    error?.code === "slot-taken"
                        ? error.message
                        : "No se pudo crear la reserva."
                );

                submitButton.disabled = false;
                submitButton.textContent =
                    "CREAR RESERVA";
            }
        };


    /* =========================================================
       TOTAL INICIAL
       ========================================================= */

    calculateTotal();
};
let lockdowns = [];

const lockdownForm =
    document.getElementById(
        'lockdownForm'
    );

const lockdownList =
    document.getElementById(
        'lockdownList'
    );


/* =========================================================
   LOCKDOWNS
   ========================================================= */

function renderLockdowns() {

    if (!lockdownList) {
        return;
    }

    if (!lockdowns.length) {

        lockdownList.innerHTML = `
            <div class="lockdown-empty">
                NO HAY BLOQUEOS PROGRAMADOS
            </div>
        `;

        return;
    }


    lockdownList.innerHTML =
        lockdowns.map(lock => `

            <div class="lockdown-item">

                <div class="lockdown-date">
                    <strong>
                        ${esc(lock.date)}
                    </strong>

                    <span>
                        ${esc(lock.start)}
                        —
                        ${esc(lock.end)}
                    </span>
                </div>

                <div class="lockdown-info">

                    ${
                        lock.reason
                            ? `
                                <small>
                                    ${esc(lock.reason)}
                                </small>
                            `
                            : ''
                    }

                </div>

                <button
                    type="button"
                    class="danger lockdown-delete"
                    data-id="${esc(lock.id)}"
                >
                    ELIMINAR
                </button>

            </div>

        `).join('');


    $$('.lockdown-delete')
        .forEach(button => {

            button.onclick =
                async () => {

                    if (
                        !confirm(
                            '¿Eliminar este bloqueo?'
                        )
                    ) {
                        return;
                    }

                    await deleteDoc(
                        doc(
                            db,
                            'availabilityLockdowns',
                            button.dataset.id
                        )
                    );
                };
        });
}


if (lockdownForm) {

    lockdownForm.onsubmit =
        async event => {

            event.preventDefault();


            const date =
                $('#lockdownDate')
                    .value;

            const start =
                $('#lockdownStart')
                    .value;

            const end =
                $('#lockdownEnd')
                    .value;

            const reason =
                $('#lockdownReason')
                    .value
                    .trim();


            if (
                !date ||
                !start ||
                !end
            ) {

                alert(
                    'Completá la fecha y las horas.'
                );

                return;
            }


            if (
                end <= start
            ) {

                alert(
                    'La hora final debe ser posterior a la hora inicial.'
                );

                return;
            }


            await addDoc(
                collection(
                    db,
                    'availabilityLockdowns'
                ),
                {
                    date,

                    start,

                    end,

                    reason:
                        reason ||
                        null,

                    active:
                        true,

 createdBy:
    auth.currentUser?.uid ||
    null,

                    createdAt:
                        serverTimestamp(),

                    updatedAt:
                        serverTimestamp()
                }
            );


            lockdownForm.reset();


            $('#lockdownDate').value =
                today();
        };
}


/*
 * Escuchar bloqueos en tiempo real.
 */

const lockdownQuery =
    query(
        collection(
            db,
            'availabilityLockdowns'
        ),
        orderBy(
            'date',
            'asc'
        )
    );


onSnapshot(
    lockdownQuery,

    snapshot => {

        lockdowns =
            snapshot.docs.map(
                snapshot => ({
                    id:
                        snapshot.id,

                    ...snapshot.data()
                })
            );


        renderLockdowns();
    },

    error => {

        console.error(
            '[LOCKDOWNS]',
            error
        );
    }
);