    /*
     * api/_lib/paypal.js
     *
     * Server-side helpers for talking to PayPal's REST API (OAuth2 client
     * credentials flow) and for converting reservation totals (stored in
     * Honduran Lempiras, HNL) into USD for PayPal checkout, since PayPal
     * charges in USD here.
     *
     * Required environment variables:
     *   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET   App credentials from
     *                                            developer.paypal.com.
     *   PAYPAL_WEBHOOK_ID                        ID of the PayPal webhook
     *                                            configured to hit
     *                                            api/paypal/webhook.js,
     *                                            used to verify incoming
     *                                            webhook signatures.
     *   PAYPAL_ENV                               "sandbox" (default) or
     *                                            "live" — picks which
     *                                            PayPal API host to use.
     *   PAYPAL_HNL_USD_RATE                      Fallback exchange rate
     *                                            used only if there is no
     *                                            settings/payments document
     *                                            in Firestore (see
     *                                            getPaypalRate below).
     *
     * Exports:
     *   - paypalBaseUrl()        Sandbox vs live API base URL.
     *   - paypalClientId()       Reads PAYPAL_CLIENT_ID (throws if missing).
     *   - paypalWebhookId()      Reads PAYPAL_WEBHOOK_ID (throws if missing).
     *   - paypalAccessToken()    Exchanges client id/secret for a short-lived
     *                            OAuth2 access token (not cached — fetched
     *                            fresh on every call).
     *   - paypalRequest(path, o) Generic authenticated fetch against the
     *                            PayPal API; throws a normalized error with
     *                            .status = 502 and the raw PayPal error body
     *                            attached as .paypal on failure.
     *   - getPaypalRate()        HNL-per-USD exchange rate: prefers the rate
     *                            stored in Firestore's settings/payments doc
     *                            (also checks a `paypal.enabled` kill switch
     *                            there), and falls back to the
     *                            PAYPAL_HNL_USD_RATE env var if Firestore
     *                            doesn't have one yet.
     *   - hnlToUsd(total, rate)  Converts an HNL amount to a USD string with
     *                            2 decimals, for the PayPal order amount.
     *   - verifyPaypalWebhook(headers, event)
     *                            Calls PayPal's webhook-signature-verification
     *                            endpoint using the headers PayPal sends with
     *                            each webhook delivery. Returns false (does
     *                            NOT throw) if required headers are missing,
     *                            so callers should treat a false return as
     *                            "reject this webhook".
     */

    import { adminDb } from './firebase-admin.js';

    function required(name) {
        const value = String(process.env[name] || '').trim();
        if (!value) {
            const error = new Error(`Falta ${name} en el entorno.`);
            error.status = 500;
            throw error;
        }
        return value;
    }

    export function paypalBaseUrl() {
        return String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

    export function paypalClientId() {
        return required('PAYPAL_CLIENT_ID');
    }

    export function paypalWebhookId() {
        return required('PAYPAL_WEBHOOK_ID');
    }

    export async function paypalAccessToken() {
        const clientId = paypalClientId();
        const secret = required('PAYPAL_CLIENT_SECRET');

        const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.access_token) {
            console.error('[PAYPAL TOKEN]', response.status, data);
            const error = new Error('No se pudo autenticar con PayPal.');
            error.status = 502;
            throw error;
        }

        return data.access_token;
    }

    export async function paypalRequest(path, options = {}) {
        const token = await paypalAccessToken();

        const response = await fetch(`${paypalBaseUrl()}${path}`, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
                ...(options.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.error('[PAYPAL API]', path, response.status, data);
            const error = new Error(
                data?.details?.[0]?.description ||
                data?.message ||
                'PayPal rechazó la operación.'
            );
            error.status = 502;
            error.paypal = data;
            throw error;
        }

        return data;
    }

    export async function getPaypalRate() {
        let rate = 0;

        try {
            const snapshot = await adminDb.doc('settings/payments').get();
            if (snapshot.exists) {
                const paypal = snapshot.data()?.paypal || {};

                if (paypal.enabled === false) {
                    const error = new Error('PayPal está desactivado temporalmente.');
                    error.status = 503;
                    throw error;
                }

                rate = Number(paypal.hnlPerUsd || 0);
            }
        } catch (error) {
            console.warn('[PAYPAL RATE] No se pudo leer settings/payments:', error.message);
        }

        if (!rate) {
            rate = Number(process.env.PAYPAL_HNL_USD_RATE || 0);
        }

        if (!Number.isFinite(rate) || rate <= 0) {
            const error = new Error('La tasa HNL/USD de PayPal no está configurada.');
            error.status = 500;
            throw error;
        }

        return rate;
    }

    export function hnlToUsd(totalHnl, hnlPerUsd) {
        const value = Number(totalHnl) / Number(hnlPerUsd);
        if (!Number.isFinite(value) || value <= 0) {
            const error = new Error('El total de la reserva es inválido para PayPal.');
            error.status = 400;
            throw error;
        }
        return value.toFixed(2);
    }

    export async function verifyPaypalWebhook(headers, event) {
        const body = {
            auth_algo: headers['paypal-auth-algo'],
            cert_url: headers['paypal-cert-url'],
            transmission_id: headers['paypal-transmission-id'],
            transmission_sig: headers['paypal-transmission-sig'],
            transmission_time: headers['paypal-transmission-time'],
            webhook_id: paypalWebhookId(),
            webhook_event: event
        };

        if (
            !body.auth_algo ||
            !body.cert_url ||
            !body.transmission_id ||
            !body.transmission_sig ||
            !body.transmission_time
        ) {
            return false;
        }

        const result = await paypalRequest('/v1/notifications/verify-webhook-signature', {
            method: 'POST',
            body: JSON.stringify(body)
        });

        return result.verification_status === 'SUCCESS';
    }
