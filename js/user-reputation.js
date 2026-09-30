/*
 * USUARIOS: la lista de usuarios registrados y su reputación.
 *
 * La reputación empieza en 5/5 y baja un punto por cada reserva del
 * usuario que fue rechazada (status "rejected") o marcada como no-show
 * (noShow: true, que queda sobre una reserva approved). Nunca baja de 0.
 * Es solo texto en la tabla: no hay alertas ni bloqueos.
 *
 * El no-show es un campo aparte y no un status nuevo a propósito: una
 * reserva a la que el cliente no llegó sigue ocupando su lugar en el
 * calendario y sigue contando en ventas, que filtran por status.
 *
 * Vive fuera de js/admin.js para poder probarlo en Node (ver tests/).
 */

export const MAX_REPUTATION = 5;

export function countsAgainstReputation(reservation) {
    return reservation?.status === 'rejected' || reservation?.noShow === true;
}

/*
 * Una reserva se puede marcar como no-show solo si está aprobada y su hora
 * de inicio ya pasó. `now` se pasa por parámetro para los tests.
 */
export function canMarkNoShow(reservation, now = new Date()) {
    if (reservation?.status !== 'approved' || !reservation.date) return false;
    const start = new Date(`${reservation.date}T${reservation.time || '00:00'}`);
    return !Number.isNaN(start.getTime()) && start <= now;
}

/*
 * La clase de color de una reserva en el calendario: un no-show se pinta
 * en rojo aunque su status siga siendo "approved".
 */
export function calendarStatus(reservation) {
    return reservation?.noShow === true ? 'noshow' : reservation?.status || '';
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

/*
 * A quién le pertenece una reserva. Las del sitio traen el uid del
 * cliente; las manuales del panel se guardan con uid null (ver
 * js/reservation-writes.js), así que ahí se cae al correo del cliente.
 */
function ownerOf(reservation, usersById, usersByEmail) {
    if (reservation.uid && usersById.has(reservation.uid)) return reservation.uid;
    return usersByEmail.get(normalizeEmail(reservation.customer?.email)) || null;
}

/*
 * users: [{ id, name, email, phone, createdAt, ... }]
 * reservations: las que cuentan en contra (se filtran igual acá, así que
 * pasar reservas de más no cambia el resultado).
 */
export function buildUserRows(users, reservations) {
    const usersById = new Map(users.map((user) => [user.id, user]));
    const usersByEmail = new Map();
    for (const user of users) {
        const email = normalizeEmail(user.email);
        if (email && !usersByEmail.has(email)) usersByEmail.set(email, user.id);
    }

    const counts = new Map();
    const seen = new Set();
    for (const reservation of reservations) {
        if (!countsAgainstReputation(reservation) || seen.has(reservation.id)) continue;
        seen.add(reservation.id);
        const owner = ownerOf(reservation, usersById, usersByEmail);
        if (!owner) continue;
        const entry = counts.get(owner) || { rejected: 0, noShows: 0 };
        if (reservation.noShow === true) entry.noShows += 1;
        else entry.rejected += 1;
        counts.set(owner, entry);
    }

    return users
        .map((user) => {
            const { rejected, noShows } = counts.get(user.id) || { rejected: 0, noShows: 0 };
            return {
                id: user.id,
                name: user.name || '',
                email: user.email || '',
                phone: user.phone || user.phoneNumber || '',
                createdAt: user.createdAt || null,
                rejected,
                noShows,
                reputation: Math.max(0, MAX_REPUTATION - rejected - noShows)
            };
        })
        .sort((a, b) =>
            (a.name || a.email).localeCompare(b.name || b.email, 'es', { sensitivity: 'base' })
        );
}

export function filterUserRows(rows, text) {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
        [row.name, row.email, row.phone].some((value) => String(value).toLowerCase().includes(needle))
    );
}

/*
 * Las lecturas de Firestore para la vista. Se hacen con getDocs (una sola
 * vez, al abrir USUARIOS o al tocar ACTUALIZAR), no con onSnapshot, y de
 * reservas solo se piden las que restan puntos, de todos los años: el
 * listener del calendario solo trae el año en curso, así que no alcanza.
 * `deps` son las funciones del SDK, igual que en js/reservation-writes.js.
 */
export async function loadUserReputation(deps) {
    const { db, collection, query, where, getDocs } = deps;
    const reservations = collection(db, 'reservations');
    const [users, rejected, noShows] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(query(reservations, where('status', '==', 'rejected'))),
        getDocs(query(reservations, where('noShow', '==', true)))
    ]);
    const rows = (snapshot) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return buildUserRows(rows(users), [...rows(rejected), ...rows(noShows)]);
}

/*
 * Marca (o desmarca) una reserva aprobada como no-show. No toca el status
 * ni los reservationLocks: el lugar ya se usó (o se perdió) igual.
 */
export async function setNoShow(deps, reservation, noShow, adminUid) {
    if (noShow && !canMarkNoShow(reservation)) {
        throw new Error('Solo se puede marcar no-show en una reserva aprobada que ya empezó.');
    }
    const { db, doc, updateDoc, serverTimestamp } = deps;
    await updateDoc(doc(db, 'reservations', reservation.id), {
        noShow,
        noShowAt: noShow ? serverTimestamp() : null,
        noShowBy: noShow ? adminUid : null,
        updatedAt: serverTimestamp()
    });
}
