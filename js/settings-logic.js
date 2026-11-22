/*
 * CONFIGURACIÓN: lee y arma settings/reservations con las MISMAS claves
 * que usa el sitio público (getConfig() en api/_lib/reservations.js de
 * la rama main): `prices.{standard,premium}` y `hours`, un mapa por día de
 * la semana (0 = domingo) con [apertura, cierre]; sin entrada o null =
 * cerrado.
 *
 * Antes el panel guardaba `pricing` y `schedule`, que el sitio nunca leía:
 * cambiar las tarifas o el horario acá no cambiaba nada allá.
 *
 * Los valores por defecto son los de DEFAULT_CONFIG del sitio, para que
 * abrir el formulario y guardarlo sin tocar nada no cambie lo que cobra.
 */

export const SITE_DEFAULT_PRICES = { standard: 200, premium: 400 };

export const SITE_DEFAULT_HOURS = {
    0: ["12:00", "21:00"],
    1: null,
    2: ["14:00", "21:00"],
    3: ["14:00", "21:00"],
    4: ["14:00", "21:00"],
    5: ["14:00", "21:00"],
    6: ["12:00", "21:00"]
};

// Lunes primero, como se muestra en el formulario.
export const WEEK_DAYS = [
    [1, "LUNES"],
    [2, "MARTES"],
    [3, "MIÉRCOLES"],
    [4, "JUEVES"],
    [5, "VIERNES"],
    [6, "SÁBADO"],
    [0, "DOMINGO"]
];

export function readPrices(settings) {
    const prices = settings?.prices || {};
    const pick = (key) => {
        const value = Number(prices[key]);
        return Number.isFinite(value) && prices[key] != null ? value : SITE_DEFAULT_PRICES[key];
    };
    return { standard: pick("standard"), premium: pick("premium") };
}

/*
 * El sitio hace merge de sus horarios por defecto con los guardados, así
 * que un día que no está en el doc usa el default; uno guardado en null
 * queda cerrado.
 */
export function readHours(settings) {
    const saved = settings?.hours || {};
    const out = {};
    for (const [day] of WEEK_DAYS) {
        const entry = Object.prototype.hasOwnProperty.call(saved, day) ? saved[day] : SITE_DEFAULT_HOURS[day];
        out[day] = Array.isArray(entry) && entry.length === 2 ? [...entry] : null;
    }
    return out;
}

/*
 * rows: [{ day, closed, open, close }] del formulario. Devuelve
 * { hours } listo para setDoc(..., { merge: true }) o { error }.
 * Los 7 días se escriben explícitos (null = cerrado) porque el sitio
 * rellena con sus defaults cualquier día que falte.
 */
export function buildHoursPayload(rows) {
    const hours = {};
    for (const row of rows) {
        if (row.closed) {
            hours[row.day] = null;
            continue;
        }
        if (!row.open || !row.close) return { error: "Completá apertura y cierre de cada día abierto." };
        if (row.close <= row.open) return { error: "La hora de cierre debe ser posterior a la de apertura." };
        hours[row.day] = [row.open, row.close];
    }
    return { hours };
}

export function buildPricesPayload({ standard, premium }) {
    const s = Number(standard);
    const p = Number(premium);
    if (!Number.isFinite(s) || !Number.isFinite(p) || s < 0 || p < 0 || standard === "" || premium === "") {
        return { error: "Ingresá precios válidos." };
    }
    return { prices: { standard: s, premium: p } };
}

// Horas que abre el día (para la ocupación del resumen).
export function openHoursCount(range) {
    if (!range) return 0;
    const [oh, om] = range[0].split(":").map(Number);
    const [ch, cm] = range[1].split(":").map(Number);
    return Math.max(0, (ch * 60 + cm - (oh * 60 + om)) / 60);
}
