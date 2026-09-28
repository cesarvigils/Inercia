/*
 * Vista REEMBOLSOS del panel: lista las reservas pagadas con PayPal y
 * permite reembolsarlas total o parcialmente.
 *
 * Separada de js/admin.js para no mezclarse con el resto del panel:
 * admin.js solo llama setupRefunds() una vez y renderRefunds() cada vez
 * que cambian las reservas. La lógica (saldos, validación y la llamada
 * al endpoint) está en js/refund-logic.js.
 */

import { esc } from "./html-safety.js";
import {
    parseRefundAmount,
    refundInfo,
    refundRows,
    refundStatusLabel,
    requestRefund
} from "./refund-logic.js";

const $ = (s) => document.querySelector(s);

const money = (v) =>
    `L ${Number(v || 0).toLocaleString("es-HN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fdate = (v) => (v ? String(v).split("-").reverse().join("/") : "N/D");

const RESERVATION_STATUS = {
    approved: "APROBADA",
    pending: "PENDIENTE",
    rejected: "RECHAZADA",
    cancelled: "CANCELADA",
    payment_pending: "PAGO PENDIENTE"
};

let getUser = () => null;
let lastReservations = [];
let filter = "pending";
let selectedId = null;
let busy = false;

export function setupRefunds({ currentUser }) {
    getUser = currentUser;

    document.querySelectorAll("[data-refund-filter]").forEach((button) => {
        button.onclick = () => {
            document
                .querySelectorAll("[data-refund-filter]")
                .forEach((x) => x.classList.toggle("active", x === button));
            filter = button.dataset.refundFilter;
            renderRefunds(lastReservations);
        };
    });
}

export function renderRefunds(reservations) {
    lastReservations = reservations || [];
    if (!$("#refundTable")) return;

    const all = refundRows(lastReservations, "all");
    const pendingRows = all.filter((x) => x.info.refundable);
    const refundedTotal = all.reduce((sum, x) => sum + x.info.refundedHNL, 0);

    $("#refundMetrics").innerHTML = [
        ["PAGOS PAYPAL", all.length],
        ["CON SALDO", pendingRows.length],
        ["RECHAZADAS SIN REEMBOLSAR", pendingRows.filter((x) => x.reservation.status === "rejected").length],
        ["TOTAL REEMBOLSADO", money(refundedTotal)]
    ]
        .map((x) => `<div class="metric"><span>${x[0]}</span><strong>${esc(x[1])}</strong></div>`)
        .join("");

    const rows = refundRows(lastReservations, filter);
    $("#refundTable").innerHTML = rows.length
        ? rows.map(rowHtml).join("")
        : `<tr><td colspan="7" class="refund-empty">NO HAY RESERVAS EN ESTA LISTA</td></tr>`;

    document.querySelectorAll("[data-refund]").forEach((button) => {
        button.onclick = () => {
            selectedId = button.dataset.refund;
            renderRefundForm();
        };
    });

    renderRefundForm();
}

function rowHtml({ reservation: r, info }) {
    const status = r.status || "";
    return `<tr class="${status === "rejected" && info.refundable ? "refund-flag" : ""}">
        <td>${esc(fdate(r.date))}</td>
        <td>${esc(r.code || r.id)}</td>
        <td>${esc(r.customer?.name || "N/D")}</td>
        <td><span class="refund-res-${esc(status)}">${esc(RESERVATION_STATUS[status] || status.toUpperCase() || "N/D")}</span></td>
        <td>${esc(refundStatusLabel(info))}</td>
        <td>${money(info.totalHNL)}${info.refundedHNL ? `<small>−${money(info.refundedHNL)}</small>` : ""}</td>
        <td>${
            info.refundable
                ? `<button class="mini" data-refund="${esc(r.id)}">REEMBOLSAR</button>`
                : `<button class="mini" data-refund="${esc(r.id)}">VER</button>`
        }</td>
    </tr>`;
}

function renderRefundForm() {
    const panel = $("#refundPanel");
    if (!panel) return;

    const r = lastReservations.find((x) => x.id === selectedId);
    const info = refundInfo(r);
    if (!r || !info) {
        panel.hidden = true;
        panel.innerHTML = "";
        return;
    }
    // No redibujar el formulario mientras el reembolso está en curso: el
    // listener de reservas dispara renderRefunds() apenas el servidor
    // guarda el reembolso, y borraría el mensaje de resultado.
    if (busy) return;

    const history = info.refunds.length
        ? `<ul class="refund-history">${info.refunds
            .map(
                (x) =>
                    `<li>${esc(x.createdAt ? new Date(x.createdAt).toLocaleString("es-HN") : "")} · ${money(x.amountHNL)} (USD ${esc(x.amountUSD)}) · ${esc(x.status)}</li>`
            )
            .join("")}</ul>`
        : "";

    panel.hidden = false;
    panel.innerHTML = `
        <div class="refund-panel-head">
            <div>
                <span class="eyebrow">RESERVA ${esc(r.code || r.id)}</span>
                <h3>${esc(r.customer?.name || "Cliente")} · ${esc(fdate(r.date))}</h3>
            </div>
            <button class="close" id="refundClose" type="button">×</button>
        </div>
        <div class="refund-summary">
            <div><span>PAGADO</span><strong>${money(info.totalHNL)}</strong><small>USD ${esc(info.amountUSD ?? "N/D")}</small></div>
            <div><span>REEMBOLSADO</span><strong>${money(info.refundedHNL)}</strong><small>USD ${esc(info.refundedUSD)}</small></div>
            <div><span>SALDO</span><strong>${money(info.remainingHNL)}</strong></div>
        </div>
        ${history}
        ${
            info.refundable
                ? `<form id="refundForm">
                    <label>MONTO A REEMBOLSAR (L)
                        <input id="refundAmount" type="number" min="0.01" step="0.01" max="${info.remainingHNL}" value="${info.remainingHNL}">
                    </label>
                    <p class="refund-note">Dejalo en el saldo para un reembolso total. PayPal lo devuelve en USD con la tasa del día del pago.</p>
                    <p id="refundMessage" class="refund-message" hidden></p>
                    <button class="danger" type="submit">REEMBOLSAR POR PAYPAL</button>
                </form>`
                : `<p class="refund-note">Esta reserva ya fue reembolsada completamente.</p>`
        }
    `;

    $("#refundClose").onclick = () => {
        selectedId = null;
        renderRefundForm();
    };

    const form = $("#refundForm");
    if (form) form.onsubmit = (e) => submitRefund(e, r, info);
}

async function submitRefund(event, r, info) {
    event.preventDefault();
    if (busy) return;

    const message = $("#refundMessage");
    const button = event.currentTarget.querySelector("button[type=submit]");
    const parsed = parseRefundAmount($("#refundAmount").value, info.remainingHNL);

    const show = (text, ok = false) => {
        message.textContent = text;
        message.classList.toggle("ok", ok);
        message.hidden = false;
    };

    if (parsed.error) return show(parsed.error);

    const amount = parsed.amountHNL ?? info.remainingHNL;
    const kind = parsed.amountHNL == null ? "TOTAL" : "PARCIAL";
    if (!confirm(`¿Reembolsar ${money(amount)} (${kind}) de la reserva ${r.code || r.id} por PayPal? Esto no se puede deshacer.`)) {
        return;
    }

    busy = true;
    button.disabled = true;
    button.textContent = "PROCESANDO...";
    try {
        const result = await requestRefund({
            user: getUser(),
            reservationId: r.id,
            amountHNL: parsed.amountHNL
        });
        show(
            `Reembolso ${result.status === "PENDING" ? "enviado (pendiente en PayPal)" : "completado"}: ${money(result.amountHNL)} / USD ${result.amountUSD}.`,
            true
        );
        button.hidden = true;
    } catch (error) {
        show(error.message || "No se pudo hacer el reembolso.");
        button.disabled = false;
        button.textContent = "REEMBOLSAR POR PAYPAL";
    } finally {
        busy = false;
    }
}
