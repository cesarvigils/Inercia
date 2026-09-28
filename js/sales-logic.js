/*
 * Lógica pura de la vista VENTAS: qué filas entran en cada filtro y cómo
 * se describe cada venta en la tabla. Vive fuera de js/admin.js por la
 * misma razón que reservation-logic.js: poder probarla en Node.
 */

// ¿Cae `date` dentro del filtro elegido ("day", "week", "month", "year")
// contado desde `now`? La semana va de lunes a domingo.
export function isInSalesRange(date, range, now = new Date()) {
    if (!date) return false;

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
