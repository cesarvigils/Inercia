# Inercia Admin

Pensado para vivir en `/admin` dentro del mismo repo que tu web actual. Usa el `firebase-config.js` existente del root.

## Autorizar un admin
1. Creá/invitá la cuenta normalmente en Firebase Authentication. El panel NO tiene registro.
2. Copiá su UID.
3. En Firestore creá `adminUsers/{UID}` con:
   - `enabled: true`
   - `role: "admin"`

## Colecciones
- `reservations`: reservas actuales; solo `approved` cuenta como venta.
- `reservationLocks`: se liberan al rechazar.
- `rigs`: name, order, type, pricePerHour, status (`active`, `maintenance`, `disabled`).
- `sales`: ventas manuales; admite efectivo, transferencia y tarjeta.
- `settings/reservations`: precios y restricciones de horario.

## Tests
`npm test` corre la suite con el runner de Node (sin dependencias extra). Cubre el flujo de reservas del panel: crear una reserva manual, el 50% de descuento de los martes, y editar una reserva antes de aprobarla o ya aprobada (incluidas las de PayPal).

La lógica que prueban vive en `js/reservation-logic.js` (cálculos puros) y `js/reservation-writes.js` (las dos escrituras a Firestore, que reciben el SDK por parámetro). `js/admin.js` les pasa Firebase de verdad; los tests, el doble en memoria de `tests/helpers/fake-firestore.mjs`.

## Comprobante
El panel intenta: `payment.receiptUrl`, `payment.proofUrl`, `confirmation.receiptUrl`, `receiptUrl`. Si tu campo real usa otro nombre, ajustá `receipt()` en `js/admin.js`.

## Seguridad
No uses una lista de UIDs solo en frontend. Las reglas incluidas verifican `adminUsers/{uid}`. Integralas con tus reglas actuales en vez de borrar reglas públicas que ya necesite la web principal.

## admin.inerciahn.com
Si este folder está dentro del proyecto principal, configurá el dominio `admin.inerciahn.com` en Vercel. Para que el subdominio sirva directamente este panel sin `/admin`, lo más limpio es crear un proyecto Vercel separado usando `admin` como Root Directory.
