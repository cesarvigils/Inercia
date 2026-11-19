/*
 * js/paypal-checkout.js
 *
 * Drives the PayPal card-payment option on the booking modal in
 * reservas.html: loads the PayPal SDK, renders the PayPal Buttons, and
 * calls this project's own /api/paypal/* endpoints (not PayPal's REST API
 * directly) at each step:
 *   createOrder  -> POST /api/paypal/create-order   (creates the pending
 *                   reservation + PayPal order, see api/paypal/create-order.js)
 *   onApprove    -> POST /api/paypal/capture-order  (captures payment and
 *                   approves the reservation, see api/paypal/capture-order.js)
 *   onCancel     -> POST /api/paypal/cancel-order   (frees the held slot)
 *   onError      -> POST /api/paypal/cancel-order   (same, marked payment_failed)
 *
 * This only handles the "tarjeta"/PayPal payment path; the bank-transfer
 * path is handled separately in js/reservas.js + api/reservations/create.js.
 *
 * The success notice is showNotice() from js/notice.js, never a native
 * window.alert(), so a successful payment is never hidden behind a
 * blocked/ignored dialog: the reservation is already confirmed server-side
 * by the time this shows anything, so the on-screen success message
 * (reservationMessage) is set FIRST, and the notice (with an 8s auto-
 * close fallback) is just a friendlier way to prompt the page reload —
 * it deliberately cannot make a successful payment look like it failed.
 */

import { auth } from '../firebase-config.js';
import { showNotice } from './notice.js';

const $ = (id) => document.getElementById(id);

let paypalConfig = null;
let paypalButtonsInstance = null;
let checkoutReservationId = null;
let checkoutOrderId = null;
let renderingButtons = false;

function reservationMessage(text, type = 'info') {
    const element = $('reservationMessage');
    if (!element) return;
    element.textContent = text || '';
    element.dataset.type = type;
    element.hidden = !text;
}

async function api(path, options = {}) {
    const user = auth.currentUser;
    const headers = { ...(options.headers || {}) };

    if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
    }

    if (options.body && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(path, {
        ...options,
        headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Error del servidor (${response.status}).`);
    }

    return data;
}

function selectedRigIds() {
    return [...document.querySelectorAll('.simulator-card.selected[data-id]')]
        .map((button) => button.dataset.id)
        .filter(Boolean);
}

function reservationPayload() {
    return {
        date: $('reservationDate')?.value || '',
        time: $('reservationTime')?.value || '',
        duration: Number($('reservationDuration')?.value || 0),
        rigIds: selectedRigIds()
    };
}

function validateReservation() {
    if (!auth.currentUser) {
        throw new Error('Iniciá sesión para pagar con PayPal.');
    }

    const payload = reservationPayload();

    if (!payload.date || !payload.time || !payload.duration) {
        throw new Error('Seleccioná fecha, hora y duración.');
    }

    if (!payload.rigIds.length) {
        throw new Error('Seleccioná al menos un simulador.');
    }

    return payload;
}

function parseHnlFromSummary() {
    const text = $('reservationTotal')?.textContent || '';
    const normalized = text
        .replace(/[^0-9.,-]/g, '')
        .replace(/,/g, '');
    const value = Number(normalized || 0);
    return Number.isFinite(value) ? value : 0;
}

function updatePaypalPreview(serverData = null) {
    const preview = $('paypalAmountPreview');
    if (!preview) return;

    const hnl = Number(serverData?.pricing?.total ?? parseHnlFromSummary());
    const rate = Number(serverData?.exchangeRate ?? paypalConfig?.hnlPerUsd ?? 0);
    const usd = serverData?.amountUSD || (rate > 0 ? (hnl / rate).toFixed(2) : null);

    if (!hnl) {
        preview.innerHTML = '<span>TOTAL PAYPAL</span><strong>Seleccioná tus simuladores</strong>';
        return;
    }

    preview.innerHTML = `
        <span>TOTAL DE LA RESERVA</span>
        <strong>L ${hnl.toLocaleString('es-HN', { maximumFractionDigits: 2 })} + ISV</strong>
    `;
}

function loadPaypalSdk(clientId) {
    return new Promise((resolve, reject) => {
        if (window.paypal) {
            resolve(window.paypal);
            return;
        }

        const existing = document.querySelector('script[data-inercia-paypal-sdk]');
        if (existing) {
            existing.addEventListener('load', () => resolve(window.paypal), { once: true });
            existing.addEventListener('error', () => reject(new Error('No se pudo cargar PayPal.')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.dataset.inerciaPaypalSdk = 'true';
        script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
        script.async = true;
        script.onload = () => resolve(window.paypal);
        script.onerror = () => reject(new Error('No se pudo cargar PayPal.'));
        document.head.appendChild(script);
    });
}

async function cancelPendingCheckout(reason = 'cancelled') {
    if (!checkoutReservationId) return;

    const reservationId = checkoutReservationId;
    checkoutReservationId = null;
    checkoutOrderId = null;

    try {
        await api('/api/paypal/cancel-order', {
            method: 'POST',
            body: JSON.stringify({
                reservationId,
                reason
            })
        });
    } catch (error) {
        console.warn('[PAYPAL] No se pudo liberar el checkout inmediatamente:', error);
    }
}

async function renderPaypalButtons() {
    const container = $('paypalButtons');
    if (!container || renderingButtons || paypalButtonsInstance) return;

    renderingButtons = true;

    try {
        if (!paypalConfig) {
            paypalConfig = await api('/api/paypal/client-config');
        }

        const paypal = await loadPaypalSdk(paypalConfig.clientId);

        paypalButtonsInstance = paypal.Buttons({
            style: {
                layout: 'vertical',
                shape: 'rect',
                label: 'paypal'
            },

            createOrder: async () => {
                try {
                    const payload = validateReservation();
                    reservationMessage('Preparando pago seguro con PayPal…');

                    const data = await api('/api/paypal/create-order', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });

                    checkoutReservationId = data.reservationId;
                    checkoutOrderId = data.orderID;
                    updatePaypalPreview(data);

                    if (!data.orderID) {
                        throw new Error('PayPal no devolvió un número de orden.');
                    }

                    return data.orderID;
                } catch (error) {
                    reservationMessage(error.message || 'No se pudo iniciar PayPal.', 'error');
                    throw error;
                }
            },

            onApprove: async (data) => {
                /*
                 * Igual que en reservas.js: separamos "¿se cobró y
                 * se creó la reserva?" del resto del flujo (alert +
                 * reload), para que un alert() bloqueado NUNCA
                 * pueda hacer parecer que el pago falló cuando en
                 * realidad sí se procesó.
                 */
                let captureSucceeded = false;
                let successText = '';

                try {
                    if (!checkoutReservationId) {
                        throw new Error('No encontramos la reserva asociada al pago.');
                    }

                    reservationMessage('Confirmando pago con PayPal…');

                    const result = await api('/api/paypal/capture-order', {
                        method: 'POST',
                        body: JSON.stringify({
                            reservationId: checkoutReservationId,
                            orderID: data.orderID || checkoutOrderId
                        })
                    });

                    const code = result.code || 'N/D';
                    const total = Number(result.pricing?.total || result.totalHNL || 0);
                    checkoutReservationId = null;
                    checkoutOrderId = null;

                    successText =
                        `Pago confirmado. Tu reserva ${code} está APROBADA. ` +
                        `Total: L ${total.toLocaleString('es-HN', { maximumFractionDigits: 2 })}. + ISV ` +
                        'Revisá tu WhatsApp para recibir la confirmación y el recibo.';

                    captureSucceeded = true;
                } catch (error) {
                    reservationMessage(
                        error.message || 'PayPal confirmó la ventana, pero no pudimos validar el pago.',
                        'error'
                    );
                }

                /*
                 * Corre SIEMPRE que la captura haya sido exitosa,
                 * sin importar si el aviso en pantalla falla.
                 */
                if (captureSucceeded) {
                    reservationMessage(successText, 'success');

                    // El reload corre recién cuando el usuario cierra el modal
                    // (o al toque de 8s de respaldo), nunca antes.
                    showNotice(successText, {
                        title: 'PAGO CONFIRMADO',
                        onClose: () => {
                            // Recarga limpia: refresca disponibilidad y borra la selección privada de reservas.js.
                            window.location.reload();
                        }
                    });
                }
            },

            onCancel: async () => {
                await cancelPendingCheckout('cancelled');
                reservationMessage('Pago cancelado. Los simuladores fueron liberados.', 'info');
            },

            onError: async (error) => {
                console.error('[PAYPAL]', error);
                await cancelPendingCheckout('payment_failed');
                reservationMessage('PayPal no pudo completar el pago. Los simuladores fueron liberados.', 'error');
            }
        });

        if (!paypalButtonsInstance.isEligible()) {
            container.innerHTML = '<p class="paypal-unavailable">PayPal no está disponible para este navegador o cuenta.</p>';
            return;
        }

        await paypalButtonsInstance.render('#paypalButtons');
        updatePaypalPreview();
    } catch (error) {
        console.error('[PAYPAL INIT]', error);
        container.innerHTML = '<p class="paypal-unavailable">No se pudo cargar PayPal. Intentá de nuevo.</p>';
        reservationMessage(error.message, 'error');
    } finally {
        renderingButtons = false;
    }
}

function syncPaymentPanels() {
    const method = document.querySelector('input[name="payment"]:checked')?.value || '';
    const transferPanel = $('transferPanel');
    const paypalPanel = $('paypalPanel');
    const submit = $('reservationSubmit');

    if (transferPanel) transferPanel.hidden = method !== 'transferencia';
    if (paypalPanel) paypalPanel.hidden = method !== 'paypal';

    // Transferencia/efectivo usan el submit normal; PayPal usa su botón oficial.
    // La etiqueta dice qué pasa al tocarlo (js/reservas.js la reusa al
    // terminar un envío, vía data-label).
    if (submit) {
        submit.hidden = method === 'paypal';
        if (method !== 'paypal' && submit.getAttribute('aria-busy') !== 'true') {
            const label =
                method === 'transferencia' ? 'ENVIAR RESERVA'
                    : method === 'efectivo' ? 'CONFIRMAR RESERVA'
                        : 'CONTINUAR RESERVA';
            submit.dataset.label = label;
            submit.textContent = label;
        }
    }

    if (method === 'paypal') {
        updatePaypalPreview();
        renderPaypalButtons();
    }
}

function wireReceiptUi() {
    const input = $('paymentReceipt');
    const label = $('receiptUpload');
    const name = $('receiptFileName');

    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    const maxBytes = 5 * 1024 * 1024;

    input?.addEventListener('change', () => {
        let file = input.files?.[0];

        // Avisar en el momento (antes solo se validaba al enviar la reserva).
        if (file && (file.size > maxBytes || !allowedTypes.includes(file.type))) {
            reservationMessage(
                file.size > maxBytes
                    ? 'El comprobante no puede pesar más de 5 MB.'
                    : 'El comprobante debe ser JPG, PNG o PDF.',
                'error'
            );
            input.value = '';
            file = null;
        } else if (file && $('reservationMessage')?.textContent.startsWith('El comprobante')) {
            reservationMessage('');
        }

        if (name) {
            name.textContent = file ? file.name : 'SUBÍ TU COMPROBANTE';
        }
        label?.classList.toggle('has-file', Boolean(file));
    });
}

document.querySelectorAll('input[name="payment"]').forEach((input) => {
    input.addEventListener('change', syncPaymentPanels);
});

['reservationDate', 'reservationTime', 'reservationDuration'].forEach((id) => {
    $(id)?.addEventListener('change', () => {
        updatePaypalPreview();
    });
});

document.addEventListener('click', (event) => {
    if (event.target.closest('.simulator-card')) {
        queueMicrotask(updatePaypalPreview);
    }
});

wireReceiptUi();
syncPaymentPanels();