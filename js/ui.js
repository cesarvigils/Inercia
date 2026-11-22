/*
 * Piezas de interfaz compartidas por todo el panel: avisos (toast), el
 * diálogo de confirmación que reemplaza a confirm()/alert(), y el estado
 * "ocupado" de los botones mientras se guarda algo.
 */

import { esc } from "./html-safety.js";

function toastRoot() {
    let root = document.getElementById("toasts");
    if (!root) {
        root = document.createElement("div");
        root.id = "toasts";
        root.className = "toasts";
        root.setAttribute("role", "status");
        root.setAttribute("aria-live", "polite");
        document.body.append(root);
    }
    return root;
}

// kind: "ok" | "error" | "info"
export function toast(message, kind = "ok", ms = 3200) {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = message;
    toastRoot().append(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 250);
    }, kind === "error" ? Math.max(ms, 5000) : ms);
}

export const toastError = (error, fallback = "No se pudo guardar.") => {
    console.error("[ADMIN]", error);
    toast(error?.code === "slot-taken" || error?.userFacing ? error.message : fallback, "error");
};

let openConfirm = null;

export const isConfirmOpen = () => Boolean(openConfirm);

/*
 * confirmDialog({ title, message, confirmLabel, danger, reason }) ->
 * Promise<false | { reason }>. Con `reason: true` muestra un campo de
 * texto opcional (por ejemplo, el motivo de un rechazo).
 */
export function confirmDialog({
    title = "¿CONFIRMAR?",
    message = "",
    confirmLabel = "CONFIRMAR",
    cancelLabel = "CANCELAR",
    danger = false,
    reason = false,
    reasonLabel = "MOTIVO (OPCIONAL)",
    alertOnly = false
} = {}) {
    closeConfirm(false);
    const bg = document.createElement("div");
    bg.className = "confirm-bg";
    bg.innerHTML = `
        <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle">
            <h3 id="confirmTitle">${esc(title)}</h3>
            ${message ? `<p>${esc(message)}</p>` : ""}
            ${reason ? `<label>${esc(reasonLabel)}<textarea id="confirmReason" rows="3" maxlength="300"></textarea></label>` : ""}
            <div class="confirm-actions">
                ${alertOnly ? "" : `<button type="button" class="ghost" data-confirm="no">${esc(cancelLabel)}</button>`}
                <button type="button" class="${danger ? "danger" : "primary"}" data-confirm="yes">${esc(confirmLabel)}</button>
            </div>
        </div>`;
    document.body.append(bg);

    return new Promise((resolve) => {
        openConfirm = { bg, resolve };
        bg.querySelector('[data-confirm="yes"]').onclick = () =>
            closeConfirm({ reason: bg.querySelector("#confirmReason")?.value.trim() || "" });
        const no = bg.querySelector('[data-confirm="no"]');
        if (no) no.onclick = () => closeConfirm(false);
        bg.onclick = (e) => {
            if (e.target === bg) closeConfirm(false);
        };
        (bg.querySelector("#confirmReason") || bg.querySelector('[data-confirm="yes"]')).focus();
    });
}

export function closeConfirm(value = false) {
    if (!openConfirm) return;
    const { bg, resolve } = openConfirm;
    openConfirm = null;
    bg.remove();
    resolve(value);
}

export const alertDialog = (title, message = "") =>
    confirmDialog({ title, message, confirmLabel: "ENTENDIDO", alertOnly: true });

/*
 * Deshabilita el botón mientras corre `fn` (evita el doble clic que
 * registraba dos ventas) y avisa si sale bien o mal. Devuelve true si
 * `fn` terminó sin error.
 */
export async function withBusy(button, busyLabel, fn, { success, error: errorText } = {}) {
    if (button?.disabled) return false;
    const label = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = busyLabel;
    }
    try {
        await fn();
        if (success) toast(success, "ok");
        return true;
    } catch (error) {
        toastError(error, errorText);
        return false;
    } finally {
        if (button?.isConnected) {
            button.disabled = false;
            button.textContent = label;
        }
    }
}
