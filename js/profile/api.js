/*
 * js/profile/api.js
 *
 * GET helper for the profile's data modules. Sends the signed-in user's
 * Firebase ID token (the /api/* functions check it with requireUser), and
 * turns every failure into a thrown Error with `.status` so callers can
 * tell "not set up yet" (404/503) from "something broke".
 */

const TIMEOUT_MS = 10_000;

export async function getJson(path, { user = null } = {}) {
    const headers = {};

    if (user) {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(path, { headers, signal: controller.signal });
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
