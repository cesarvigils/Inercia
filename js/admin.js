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
    writeBatch,
    runTransaction,
    Timestamp,
        orderBy

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
let products = [];

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

// Permanent business rule: every Tuesday is 50% off (mirrors applyTuesdayPromotion
// in api/_lib/reservations.js on the main site so admin-created reservations match).
const isTuesday = (dateStr) => {
    if (!dateStr) return false;
    let [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === 2;
};

/*
 * reservationLocks helpers — mirror api/_lib/reservations.js's hm()/slotIds()/
 * isLockActive()/expiresAt() on the main site exactly (same doc id format,
 * same slot size, same expiry rule) so a lock either side creates is
 * understood by the other. Duplicated here rather than imported because this
 * bundle has no build step wiring it to that file.
 *
 * Manual admin reservations used to skip reservationLocks entirely: they
 * only ever wrote the `reservations` doc, with no check against existing
 * locks and no lock of their own. That let the admin panel double-book a
 * rig/time that was already taken (nothing here or in the security rules
 * stopped it), invisibly — since renderCalendar() draws straight from
 * `reservations` and only ever shows one dot per cell (list.find() returns
 * the first match), a second reservation silently landed on the same
 * cell. Rejecting whichever one happened to render first then "revealed"
 * the other, which is why rejecting a reservation could appear to flip an
 * unrelated slot for a different client back to available/approved. Every
 * write below goes through a transaction that checks reservationLocks
 * first, the same way api/reservations/create.js already does for the
 * public site.
 */
const LOCK_SLOT_MINUTES = 30;

function hm(value) {
    const [h, m] = String(value).split(":").map(Number);
    return h * 60 + m;
}

function slotIds(date, start, end, rigId) {
    const out = [];
    for (let m = start; m < end; m += LOCK_SLOT_MINUTES) {
        out.push(`${date}_${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}_${rigId}`);
    }
    return out;
}

// Same rule as expiresAt() in api/_lib/reservations.js: ~6h after the
// reservation's own start time, not 6h from now.
function lockExpiresAt(date, time) {
    const [y, m, d] = date.split("-").map(Number);
    const [h, mi] = time.split(":").map(Number);
    return Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d, h + 6, mi)));
}

function isLockSnapshotActive(snapshot) {
    if (!snapshot.exists()) return false;
    const expiry = snapshot.data()?.expiresAt;
    if (expiry && typeof expiry.toMillis === "function" && expiry.toMillis() < Date.now()) return false;
    return true;
}

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
    onSnapshot(collection(db, "products"), (snapshot) => {
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
                            id="editReservation"
                            class="ghost"
                        >
                            EDITAR
                        </button>

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

    const currentPayment =
        typeof r.payment === "string"
            ? r.payment
            : r.payment?.method || "efectivo";

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
                    <option
                        value="efectivo"
                        ${currentPayment === "efectivo" ? "selected" : ""}
                    >
                        EFECTIVO
                    </option>

                    <option
                        value="transferencia"
                        ${currentPayment === "transferencia" ? "selected" : ""}
                    >
                        TRANSFERENCIA
                    </option>

                    <option
                        value="tarjeta"
                        ${currentPayment === "tarjeta" ? "selected" : ""}
                    >
                        TARJETA
                    </option>
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
        const duration =
            Number($("#erDuration").value) || 1;

        const selectedIds = $$(
            'input[name="erRig"]:checked'
        ).map((input) => input.value);

        const selectedRigs = availableRigs.filter(
            (rig) => selectedIds.includes(rig.id)
        );

        const subtotal = selectedRigs.reduce(
            (sum, rig) => {
                const type = String(
                    rig.type || "standard"
                ).toLowerCase();

                const defaultPrice =
                    type === "premium"
                        ? 350
                        : 200;

                const price = Number(
                    rig.pricePerHour ??
                    defaultPrice
                );

                return sum + (price * duration);
            },
            0
        );

        const tuesdayDiscount = isTuesday($("#erDate").value)
            ? Math.round(subtotal * 0.5 * 100) / 100
            : 0;

        const total =
            Math.round((subtotal - tuesdayDiscount) * 100) / 100;

        $("#erTotal").textContent = tuesdayDiscount
            ? `${money(total)} (-50% MARTES)`
            : money(total);

        return {
            subtotal,
            tuesdayDiscount,
            total,
            selectedRigs
        };
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

            const start =
                hm(time);

            const end =
                start + duration * 60;

            const oldStart =
                hm(r.time);

            const oldEnd =
                oldStart + Number(r.duration || 1) * 60;

            const oldLockIds = new Set(
                [...currentRigIds].flatMap(
                    (rigId) =>
                        slotIds(r.date, oldStart, oldEnd, rigId)
                )
            );

            const newLockIds = new Set(
                selectedRigs.flatMap(
                    (rig) =>
                        slotIds(date, start, end, rig.id)
                )
            );

            const idsToRelease =
                [...oldLockIds].filter(
                    (id) => !newLockIds.has(id)
                );

            const idsToCheck =
                [...newLockIds].filter(
                    (id) => !oldLockIds.has(id)
                );

            const reservationRigs =
                selectedRigs.map(
                    (rig) => {

                        const type =
                            String(
                                rig.type || "standard"
                            ).toLowerCase();

                        const price =
                            Number(
                                rig.pricePerHour ??
                                (type === "premium" ? 350 : 200)
                            );

                        return {
                            id: rig.id,
                            rigId: rig.id,
                            name: displayRigName(rig),
                            type,
                            number: rigNumber(rig),
                            pricePerHour: price
                        };
                    }
                );

            submitButton.disabled = true;
            submitButton.textContent =
                "GUARDANDO...";

            try {

                await runTransaction(
                    db,
                    async (transaction) => {

                        const checkRefs =
                            idsToCheck.map(
                                (id) =>
                                    doc(db, "reservationLocks", id)
                            );

                        const snapshots =
                            await Promise.all(
                                checkRefs.map(
                                    (ref) =>
                                        transaction.get(ref)
                                )
                            );

                        if (
                            snapshots.some(
                                isLockSnapshotActive
                            )
                        ) {

                            throw Object.assign(
                                new Error(
                                    "Uno de esos simuladores ya está reservado para ese horario."
                                ),
                                { code: "slot-taken" }
                            );
                        }

                        for (
                            const id
                            of idsToRelease
                        ) {

                            transaction.delete(
                                doc(db, "reservationLocks", id)
                            );
                        }

                        for (
                            const id
                            of idsToCheck
                        ) {

                            transaction.set(
                                doc(db, "reservationLocks", id),
                                {
                                    reservationId: r.id,
                                    createdBy: auth.currentUser.uid,
                                    expiresAt: lockExpiresAt(date, time),
                                    createdAt: serverTimestamp()
                                }
                            );
                        }

                        transaction.update(
                            doc(db, "reservations", r.id),
                            {
                                date,
                                time,
                                duration,
                                rigs: reservationRigs,

                                pricing: {
                                    beforeTuesdayDiscount: subtotal,
                                    tuesdayDiscount,
                                    tuesdayDiscountPercent:
                                        tuesdayDiscount ? 50 : 0,
                                    tuesdayPromotionApplied:
                                        tuesdayDiscount > 0,
                                    total
                                },

                                payment: {
                                    method: $("#erPayment").value
                                },

                                updatedAt: serverTimestamp()
                            }
                        );
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
                            value="${product.id}"
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
                            data-product="${product.id}"
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
        const duration =
            Number($("#mrDuration").value) || 1;

        const selectedIds = $$(
            'input[name="manualRig"]:checked'
        ).map((input) => input.value);

        const selectedRigs = availableRigs.filter(
            (rig) => selectedIds.includes(rig.id)
        );

        const subtotal = selectedRigs.reduce(
            (sum, rig) => {
                const type = String(
                    rig.type || "standard"
                ).toLowerCase();

                const defaultPrice =
                    type === "premium"
                        ? 350
                        : 200;

                const price = Number(
                    rig.pricePerHour ??
                    defaultPrice
                );

                return sum + (price * duration);
            },
            0
        );

        const tuesdayDiscount = isTuesday($("#mrDate").value)
            ? Math.round(subtotal * 0.5 * 100) / 100
            : 0;

        const total =
            Math.round((subtotal - tuesdayDiscount) * 100) / 100;

        $("#mrTotal").textContent = tuesdayDiscount
            ? `${money(total)} (-50% MARTES)`
            : money(total);

        return {
            subtotal,
            tuesdayDiscount,
            total,
            selectedRigs
        };
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

            const start =
                hm(time);

            const end =
                start + duration * 60;

            const reservationRigs =
                selectedRigs.map(
                    (rig) => {

                        const type =
                            String(
                                rig.type ||
                                "standard"
                            ).toLowerCase();

                        const number =
                            typeof rigNumber ===
                            "function"
                                ? rigNumber(rig)
                                : Number(
                                    rig.number ??
                                    rig.order ??
                                    0
                                );

                        const rigName =
                            typeof displayRigName ===
                            "function"
                                ? displayRigName(rig)
                                : rig.name;

                        const price =
                            Number(
                                rig.pricePerHour ??
                                (
                                    type ===
                                    "premium"
                                        ? 350
                                        : 200
                                )
                            );

                        return {
                            id: rig.id,
                            rigId: rig.id,

                            name:
                                rigName,

                            type,

                            number,

                            pricePerHour:
                                price
                        };
                    }
                );

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

                const reservationRef =
                    doc(
                        collection(
                            db,
                            "reservations"
                        )
                    );

                const lockRefs =
                    reservationRigs.flatMap(
                        (rig) =>
                            slotIds(
                                date,
                                start,
                                end,
                                rig.id
                            ).map(
                                (id) =>
                                    doc(
                                        db,
                                        "reservationLocks",
                                        id
                                    )
                            )
                    );

                await runTransaction(
                    db,
                    async (transaction) => {

                        const snapshots =
                            await Promise.all(
                                lockRefs.map(
                                    (ref) =>
                                        transaction.get(ref)
                                )
                            );

                        if (
                            snapshots.some(
                                isLockSnapshotActive
                            )
                        ) {

                            throw Object.assign(
                                new Error(
                                    "Uno de esos simuladores ya está reservado para ese horario."
                                ),
                                { code: "slot-taken" }
                            );
                        }

                        for (
                            const lockRef
                            of lockRefs
                        ) {

                            transaction.set(
                                lockRef,
                                {
                                    reservationId:
                                        reservationRef.id,

                                    createdBy:
                                        auth.currentUser.uid,

                                    expiresAt:
                                        lockExpiresAt(
                                            date,
                                            time
                                        ),

                                    createdAt:
                                        serverTimestamp()
                                }
                            );
                        }

                        transaction.set(
                            reservationRef,
                            {
                                code,

                                source: "admin",

                                /*
                                 * No existe usuario Firebase
                                 * necesariamente porque es
                                 * reserva manual.
                                 */
                                uid: null,

                                customer: {
                                    name,

                                    email:
                                        email || null,

                                    phone:
                                        phone || null
                                },

                                date,

                                time,

                                duration,

                                rigs:
                                    reservationRigs,

                                pricing: {
                                    beforeTuesdayDiscount:
                                        subtotal,

                                    tuesdayDiscount,

                                    tuesdayDiscountPercent:
                                        tuesdayDiscount
                                            ? 50
                                            : 0,

                                    tuesdayPromotionApplied:
                                        tuesdayDiscount > 0,

                                    total
                                },

                                payment: {
                                    method:
                                        $("#mrPayment")
                                            .value
                                },

                                status,

                                confirmation: {
                                    status,

                                    approvedAt:
                                        status ===
                                        "approved"
                                            ? serverTimestamp()
                                            : null,

                                    approvedBy:
                                        status ===
                                        "approved"
                                            ? auth.currentUser.uid
                                            : null
                                },

                                createdBy: auth.currentUser.uid,

                                createdAt:
                                    serverTimestamp(),

                                updatedAt:
                                    serverTimestamp()
                            }
                        );
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