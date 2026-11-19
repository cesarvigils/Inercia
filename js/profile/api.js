/*
 * js/profile/api.js
 *
 * GET/POST helpers for the profile's data modules. Sends the signed-in user's
 * Firebase ID token (the /api/* functions check it with requireUser), and
 * turns every failure into a thrown Error with `.status` so callers can
 * tell "not set up yet" (404/503) from "something broke".
 */

const TIMEOUT_MS = 10_000;

export function getJson(path, { user = null } = {}) {
    return requestJson(path, { user });
}

/* POST with a JSON body (used to cancel the membership). */
export function postJson(path, body = {}, { user = null } = {}) {
    return requestJson(path, { user, method: 'POST', body });
}

async function requestJson(path, { user = null, method = 'GET', body } = {}) {
    const headers = {};

    if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(path, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || data === null) {
            const error = new Error(data?.error || `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }

        return data;
    } finally {
        clearTimeout(timer);
    }
}
