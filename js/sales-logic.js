/*
 * Lógica pura de la vista VENTAS: qué filas entran en cada filtro y cómo
 * se describe cada venta en la tabla. Vive fuera de js/admin.js por la
 * misma razón que reservation-logic.js: poder probarla en Node.
 */

const localDate = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ¿Cae `date` dentro del filtro elegido ("day", "week", "month", "year",
// o "custom" con `custom = { from, to }` en "YYYY-MM-DD", ambos incluidos)
// contado desde `now`? La semana va de lunes a domingo.
export function isInSalesRange(date, range, now = new Date(), custom = {}) {
    if (!date) return false;

    if (range === "custom") {
        const day = localDate(date);
        return (!custom.from || day >= custom.from) && (!custom.to || day <= custom.to);
    }

    if (range === "year") return date.getFullYear() === now.getFullYear();

    if (range === "month") {
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (range === "day") {
        const end = new Date(start);
        end.setDate(start.getDate() + 1);
        return date >= start && date < end;
    }

    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return date >= start && date < end;
}

// Plural simple para nombres de producto: "Pepsi" -> "Pepsis". Solo agrega
// "s" si termina en vocal; "Red Bull" o "Doritos" quedan igual, porque
// adivinar el plural de una consonante da cosas como "Red Bulles".
function pluralize(name) {
    return /[aeiouáéíóú]$/i.test(name) ? `${name}s` : name;
}

// El texto de la columna CONCEPTO: con cantidad cuando es más de una,
// para que 3 Pepsis vendidas juntas digan "3 Pepsis" y no solo "Pepsi".
export function saleDescription(sale) {
    const name = String(sale?.description || "").trim() || "Venta";
    const quantity = Number(sale?.quantity);

    if (sale?.type === "reservation" || !Number.isFinite(quantity) || quantity <= 1) {
        return name;
    }

    return `${quantity} ${pluralize(name)}`;
}

export const PAYMENT_LABELS = {
    efectivo: "EFECTIVO",
    transferencia: "TRANSFERENCIA",
    tarjeta: "TARJETA",
    paypal: "PAYPAL"
};

export function paymentLabel(method) {
    const value = typeof method === "string" ? method : method?.method;
    return PAYMENT_LABELS[String(value || "").toLowerCase()] || String(value || "N/D").toUpperCase();
}

/*
 * Total por método de pago, de mayor a menor: cuánto entró en efectivo,
 * transferencia, tarjeta o PayPal en el período.
 */
export function paymentBreakdown(rows) {
    const totals = new Map();
    for (const row of rows) {
        const label = paymentLabel(row.paymentMethod);
        const entry = totals.get(label) || { label, total: 0, count: 0 };
        entry.total += Number(row.total) || 0;
        entry.count += 1;
        totals.set(label, entry);
    }
    return [...totals.values()].sort((a, b) => b.total - a.total);
}

const csvCell = (value) => {
    let text = String(value ?? "");
    // Una celda que empieza con = + - @ la ejecuta Excel como fórmula.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Las filas de la tabla VENTAS como CSV (con BOM para que Excel lea las tildes).
export function salesCsv(rows) {
    const lines = [["FECHA", "CONCEPTO", "METODO", "ORIGEN", "TOTAL"]];
    for (const row of rows) {
        lines.push([
            row.date ? localDate(row.date) : "",
            saleDescription(row),
            paymentLabel(row.paymentMethod),
            row.type === "reservation" ? "RESERVA" : "MANUAL",
            Number(row.total || 0).toFixed(2)
        ]);
    }
    return "﻿" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
}
