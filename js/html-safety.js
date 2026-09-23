/*
 * js/html-safety.js
 *
 * Helpers for building HTML strings in js/admin.js. Almost everything the
 * panel shows (customer names, phones, rig names, product names, receipt
 * links) comes from Firestore, and some of it is typed by customers on the
 * public site, so none of it can go into innerHTML as-is.
 *
 * Kept in its own module, like reservation-logic.js, so the tests can
 * import it in Node without the DOM or the Firebase SDK.
 */

// Escapes a value for use as HTML text or inside a quoted attribute.
export const esc = (v) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );

/*
 * Returns the URL only if it is an absolute https: link, otherwise "".
 * esc() alone does not make a link safe: a stored "javascript:..." value
 * survives escaping and runs when an admin clicks it.
 */
export const safeUrl = (v) => {
    try {
        const url = new URL(String(v ?? ""));
        return url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
};
