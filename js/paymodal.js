/*
 * js/paymodal.js
 *
 * UI-only logic for the payment method selector inside the booking modal
 * on reservas.html: switching between "transferencia" (bank transfer) and
 * "tarjeta" (card, via PayPal Buttons — see js/paypal-checkout.js) toggles
 * which panel (#transferPanel / #cardPanel) is visible, and handles
 * picking/validating (client-side size check only) the bank-transfer
 * receipt file input.
 *
 * This file does NOT upload the receipt or talk to any API — actually
 * uploading the proof to Firebase Storage and building the reservation
 * request happens in js/reservas.js. This just manages the form's visual
 * state.
 */
const paymentOptions =
    document.querySelectorAll('.payment-option');

const transferPanel =
    document.getElementById('transferPanel');

const cardPanel =
    document.getElementById('cardPanel');

const paymentReceipt =
    document.getElementById('paymentReceipt');

const receiptUpload =
    document.getElementById('receiptUpload');

const receiptFileName =
    document.getElementById('receiptFileName');


/* =========================================================
   PAYMENT METHOD
   ========================================================= */

paymentOptions.forEach(option => {

    const radio =
        option.querySelector(
            'input[name="payment"]'
        );

    if (!radio) return;


    option.addEventListener('click', () => {

        paymentOptions.forEach(item => {
            item.classList.remove('active');
        });


        option.classList.add('active');

        radio.checked = true;


        /*
         * Ocultar todos los paneles primero.
         */

        transferPanel.hidden = true;
        cardPanel.hidden = true;


        /*
         * Mostrar el correspondiente.
         */

        if (radio.value === 'transferencia') {

            transferPanel.hidden = false;

        }


        if (radio.value === 'tarjeta') {

            cardPanel.hidden = false;

        }

    });

});


/* =========================================================
   RECEIPT FILE
   ========================================================= */

paymentReceipt?.addEventListener(
    'change',
    () => {

        const file =
            paymentReceipt.files?.[0];


        if (!file) {

            receiptUpload?.classList.remove(
                'has-file'
            );

            receiptFileName.textContent =
                'SUBÍ TU COMPROBANTE';

            return;
        }


        /*
         * Máximo 5 MB
         */

        const maxSize =
            5 * 1024 * 1024;


        if (file.size > maxSize) {

            alert(
                'El archivo no puede superar los 5 MB.'
            );

            paymentReceipt.value = '';

            receiptUpload?.classList.remove(
                'has-file'
            );

            receiptFileName.textContent =
                'SUBÍ TU COMPROBANTE';

            return;
        }


        /*
         * Mostrar archivo seleccionado
         */

        receiptUpload?.classList.add(
            'has-file'
        );

        receiptFileName.textContent =
            file.name;

    }
);