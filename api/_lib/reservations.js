/*
 * api/_lib/reservations.js
 *
 * Core booking rules and pricing logic shared by the reservation API
 * routes (api/reservations/*.js) and the PayPal checkout flow
 * (api/_lib/paypal-reservation.js). This file is intentionally dense
 * (many one-line functions) — read this header before editing anything
 * below, since the logic is easy to misread at a glance.
 *
 * All times are handled in the TZ timezone (America/Tegucigalpa), NOT
 * server-local time or UTC, because Vercel serverless functions can run
 * in any region.
 *
 * Exports, in the order they appear below:
 *   - TZ                    IANA timezone used for all date/time math.
 *   - DEFAULT_CONFIG        Fallback booking rules (hours, prices, booking
 *                           window, late-booking penalty, payment methods)
 *                           used when Firestore doc settings/reservations
 *                           doesn't exist yet or is missing a field.
 *   - merge(a, b)           Shallow-merges DEFAULT_CONFIG with whatever is
 *                           stored in Firestore, merging the nested
 *                           prices/hours/lateBooking/payment objects too
 *                           (so Firestore only needs to override the fields
 *                           it cares about).
 *   - getConfig()           Reads settings/reservations from Firestore and
 *                           returns it merged with DEFAULT_CONFIG. Call this
 *                           instead of reading DEFAULT_CONFIG directly.
 *   - hm(s)                 Converts an "HH:MM" string to minutes since
 *                           midnight (e.g. "10:30" -> 630).
 *   - localParts(date)      Breaks a JS Date into { date, minutes, weekday }
 *                           as seen in the TZ timezone (date = "YYYY-MM-DD",
 *                           minutes = minutes since midnight, weekday =
 *                           0=Sun..6=Sat). Used to know "now" in local time.
 *   - dateDay(dateStr)      Returns the day-of-week (0=Sun..6=Sat) for a
 *                           "YYYY-MM-DD" string, treated as a calendar date
 *                           (not affected by timezone shifts).
 *   - dateDiff(a, b)        Number of whole days between two "YYYY-MM-DD"
 *                           dates (b - a).
 *   - validateWhen(...)     The main booking-window validator: checks the
 *                           date/time format, duration bounds, that the
 *                           booking falls inside the allowed booking window
 *                           (config.bookingWindowDays), that it fits within
 *                           that day's opening hours, and that it's made
 *                           far enough in advance (config.minLeadMinutes).
 *                           Throws a `bad()` error (400) on any violation.
 *                           Returns { start, end, lead } in minutes.
 *   - bad(message, status)  Shorthand for creating an Error with an
 *                           HTTP status attached, so api/_lib/http.js's
 *                           fail() can turn it into the right response code.
 *   - activePromotions(...) Reads Firestore's `promotions` collection and
 *                           returns only the promotions that are active and
 *                           apply to the given date/day-of-week and rig
 *                           type(s).
 *   - priceReservation(...) Computes { base, discount, penalty, total } for
 *                           a reservation: base = sum of per-rig hourly
 *                           price * duration, discount = sum of matching
 *                           promotions (percent or fixed, capped at base),
 *                           penalty = late-booking surcharge if the booking
 *                           is made inside config.lateBooking.thresholdMinutes.
 *   - applyTuesdayPromotion(pricing, date)
 *                           Applies the permanent "every Tuesday = 50% off"
 *                           business rule on top of whatever priceReservation()
 *                           already computed. This used to be duplicated (and
 *                           only applied to the PayPal path, never the bank
 *                           transfer path — see git history) — it now lives
 *                           here once and both api/reservations/create.js and
 *                           api/_lib/paypal-reservation.js call it, so the
 *                           discount is consistent across payment methods.
 *   - getActiveRigs()       Reads the `rigs` collection (active, non-maintenance
 *                           only), cached briefly — see CACHE below.
 *   - getActiveLockdowns(date), findOverlappingLockdown(lockdowns, start, end)
 *                           Admin-configured booking blackout windows
 *                           (collection `availabilityLockdowns`). Previously
 *                           only enforced in the read-only availability
 *                           endpoint (api/reservations/availability.js), which
 *                           meant a lockdown never actually stopped a booking
 *                           from being created directly — it only made the UI
 *                           grey out the slot. Both reservation-creation paths
 *                           now call these too, so a lockdown is enforced at
 *                           the one place that actually matters: the write.
 *   - slotIds(...)          Generates the list of per-30-minutes (or
 *                           whatever slotMinutes is) lock document IDs for
 *                           a rig over a date/time range. These IDs are used
 *                           as Firestore document IDs in `reservationLocks`
 *                           to prevent double-booking the same rig/slot.
 *   - getLockedSlotIds(date) All reservationLocks doc IDs for one date, in a
 *                           single range query on the document ID itself
 *                           (IDs are `${date}_${HHMM}_${rigId}`), instead of
 *                           one getAll() per candidate hour/rig. Used by
 *                           api/reservations/calendar.js to build a whole
 *                           booking window's per-day/per-hour availability
 *                           in one pass instead of N Firestore round trips.
 *   - minutesToTime(minutes) Inverse of hm(): 630 -> "10:30".
 *   - addDays(dateStr, n)   "YYYY-MM-DD" + n days -> "YYYY-MM-DD".
 *   - code()                Generates a short human-readable reservation
 *                           code like "IN-240615-A1B2C3".
 *   - expiresAt(date, time) Returns a Firestore Timestamp ~6 hours after the
 *                           given local date/time, used to auto-expire
 *                           stale/unconfirmed reservations.
 */

import crypto from 'node:crypto';
import { Timestamp, FieldPath } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.js';

export const TZ = 'America/Tegucigalpa';
const DEFAULT_CONFIG = {
  bookingWindowDays: 7, minLeadMinutes: 30, minDurationHours: 1, maxDurationHours: 8, slotMinutes: 30,
  prices: { standard: 200, premium: 350 },
  // Lunes cerrado (sin entrada = cerrado, ver validateWhen/getConfig).
  // Martes a viernes 14:00-21:00, sábado y domingo 12:00-21:00.
  hours: { 0: ['12:00','21:00'], 2: ['14:00','21:00'], 3: ['14:00','21:00'], 4: ['14:00','21:00'], 5: ['14:00','21:00'], 6: ['12:00','21:00'] },
  lateBooking: { enabled: true, thresholdMinutes: 60, type: 'percent', value: 0 },
  payment: { bankTransfer: true, card: true, paypal: false, bank: 'BAC', currency: 'HNL', account: '758-610-001', beneficiary: 'Inercia S.A.' }
};
function merge(a,b){ return { ...a, ...b, prices:{...a.prices,...b?.prices}, hours:{...a.hours,...b?.hours}, lateBooking:{...a.lateBooking,...b?.lateBooking}, payment:{...a.payment,...b?.payment} }; }

/*
 * Tiny in-process cache, keyed by string, TTL in ms. Config/rigs/promotions/
 * lockdowns rarely change, but every page load and every availability poll
 * used to re-read them from Firestore on every single request. A warm
 * serverless instance handles many requests before it's recycled, so this
 * cuts most of that repeat-read cost for free — no extra service, no extra
 * moving parts.
 *
 * Important caveat on Vercel specifically: each api/*.js file is bundled and
 * deployed as its OWN isolated serverless function, so this Map is only
 * shared across requests handled by the SAME warm instance of the SAME
 * endpoint — it is NOT a cross-endpoint shared cache (create.js's copy of
 * this module and availability.js's copy each have their own Map). That's
 * still a real, meaningful reduction in reads for any single hot endpoint;
 * just don't expect writing through one endpoint to instantly invalidate
 * another endpoint's cached copy in production (invalidateCache() below IS
 * effective for same-process usage — local dev, tests, or a non-Vercel
 * deploy). Cleared automatically on failure so a transient Firestore error
 * doesn't get cached.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map();
export function cached(key, loader, ttlMs = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const promise = Promise.resolve().then(loader).catch(error => { cache.delete(key); throw error; });
  cache.set(key, { promise, expiresAt: Date.now() + ttlMs });
  return promise;
}

// So an admin write (e.g. api/paypal/settings.js flipping the PayPal kill
// switch) takes effect immediately instead of waiting out CACHE_TTL_MS.
export function invalidateCache(key) { cache.delete(key); }

// Test-only: wipes the whole cache so one test's seeded fake Firestore data
// can't leak into the next test via a still-warm cache entry. Not used by
// any production code path.
export function __clearCacheForTests() { cache.clear(); }

export async function getConfig(){ return cached('config', async () => { const s=await adminDb.doc('settings/reservations').get(); return merge(DEFAULT_CONFIG, s.exists ? s.data() : {}); }); }

/*
 * Whether a `rigs/{id}` document should be bookable right now. This used to
 * be three different, inconsistent checks in three different files:
 *   - getActiveRigs() below (used by the public rig list) only looked at
 *     the boolean `active`/`maintenance` fields via a Firestore `where`
 *     query, with no awareness of a `status` field at all.
 *   - api/_lib/paypal-reservation.js checked the booleans OR
 *     status==='active'/'maintenance', but not status==='disabled'.
 *   - api/reservations/create.js checked only the booleans, no `status`
 *     fallback at all.
 * The admin rig editor (separate `admin` branch) writes a single `status`
 * string field (active/maintenance/disabled) rather than toggling the
 * legacy `active`/`maintenance` booleans, which are only ever set once at
 * rig creation (see scripts/seed.mjs) and never updated afterward. Because
 * getActiveRigs() never looked at `status`, a rig an admin marked as
 * maintenance/disabled kept showing as bookable on the public site
 * indefinitely — this is what actually fixes that, by making `status` (when
 * present) the single source of truth everywhere, with the old booleans
 * only as a fallback for rigs that predate the `status` field.
 */
export function isRigBookable(data){
  if (typeof data.status === 'string') return data.status === 'active';
  return data.active === true && data.maintenance !== true;
}

/*
 * Shared by api/reservations/availability.js and api/reservations/config.js,
 * which used to each run their own near-identical `rigs` query. Fetches the
 * whole (small — a handful of simulators) collection rather than filtering
 * server-side with `where('active','==',true)`, precisely because that
 * boolean field can't be trusted alone (see isRigBookable's comment) — a
 * rig admin-created without ever setting it would otherwise never appear at
 * all, on top of the opposite problem of maintenance/disabled rigs that
 * still have it stuck at `true`.
 */
export async function getActiveRigs(){
  return cached('activeRigs', async () => {
    const snap = await adminDb.collection('rigs').get();
    return snap.docs.map(d=>({id:d.id,...d.data()})).filter(isRigBookable);
  });
}

/*
 * Admin-configured booking blackouts (collection `availabilityLockdowns`,
 * one document per date). See the file header for why every reservation
 * creation path needs to call this, not just the availability check.
 */
export async function getActiveLockdowns(date){
  return cached(`lockdowns:${date}`, async () => {
    const snap = await adminDb.collection('availabilityLockdowns').where('date','==',date).get();
    return snap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>l.active!==false);
  });
}

export function findOverlappingLockdown(lockdowns, start, end){
  return lockdowns.find(l => start < hm(l.end) && end > hm(l.start));
}

/*
 * All reservationLocks doc IDs for one date in a single query, using a
 * range scan on the document ID itself (IDs are `${date}_${HHMM}_${rigId}`,
 * see slotIds() below) rather than fetching one specific ref per candidate
 * hour/rig combination. Short TTL (15s, vs the default 60s) because this
 * reflects live booking activity — staleness here directly means showing a
 * customer a slot as open that just got taken.
 */
export async function getLockedSlotIds(date){
  return cached(`locks:${date}`, async () => {
    const snap = await adminDb.collection('reservationLocks')
      .orderBy(FieldPath.documentId())
      .startAt(`${date}_`)
      .endAt(`${date}_`)
      .get();
    return new Set(snap.docs.map(d => d.id));
  }, 15_000);
}

export function hm(s){ const [h,m]=String(s).split(':').map(Number); return h*60+m; }
export function minutesToTime(minutes){ return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`; }
export function addDays(dateStr, days){ const [y,m,d]=dateStr.split('-').map(Number); const dt=new Date(Date.UTC(y,m-1,d)); dt.setUTCDate(dt.getUTCDate()+days); return dt.toISOString().slice(0,10); }
export function localParts(date=new Date()) { const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date); const o=Object.fromEntries(p.map(x=>[x.type,x.value])); return { date:`${o.year}-${o.month}-${o.day}`, minutes:+o.hour*60 + +o.minute, weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(o.weekday) }; }
export function dateDay(dateStr){ const [y,m,d]=dateStr.split('-').map(Number); return new Date(Date.UTC(y,m-1,d,12)).getUTCDay(); }
function dateDiff(a,b){ const [ay,am,ad]=a.split('-').map(Number),[by,bm,bd]=b.split('-').map(Number); return Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000); }
export function validateWhen(date,time,duration,config){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)) throw bad('Fecha u hora inválida.');
  duration=Number(duration); if(!Number.isInteger(duration)||duration<config.minDurationHours||duration>config.maxDurationHours) throw bad(`La duración debe ser de ${config.minDurationHours} a ${config.maxDurationHours} horas.`);
  const now=localParts(); const dd=dateDiff(now.date,date); if(dd<0||dd>=config.bookingWindowDays) throw bad(`Solo podés reservar dentro de los próximos ${config.bookingWindowDays} días.`);
  const start=hm(time), end=start+duration*60; const hours=config.hours[dateDay(date)]; if(!hours) throw bad('Ese día no está abierto.');
  if(start<hm(hours[0])||end>hm(hours[1])) throw bad(`La reserva debe estar dentro del horario ${hours[0]}–${hours[1]}.`);
  const lead=dd*1440 + start-now.minutes; if(lead<config.minLeadMinutes) throw bad(`La reserva debe hacerse con al menos ${config.minLeadMinutes} minutos de anticipación.`);
  return { start, end, lead };
}
export function bad(message,status=400){ return Object.assign(new Error(message),{status,expose:true}); }
export async function activePromotions(date, types){
  // Cached per-date only (not per `types`) so different rig-type combos on the
  // same date still share one Firestore read; the type filter runs after,
  // in memory, on every call.
  const day=dateDay(date);
  const perDate = await cached(`promotions:${date}`, async () => {
    const snap=await adminDb.collection('promotions').where('active','==',true).get();
    return snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>(!p.daysOfWeek||p.daysOfWeek.includes(day))&&(!p.startDate||date>=p.startDate)&&(!p.endDate||date<=p.endDate));
  });
  return perDate.filter(p=>!p.simulatorTypes||types.some(t=>p.simulatorTypes.includes(t)));
}
export function priceReservation(rigs,duration,config,promos,lead){
  const base=rigs.reduce((s,r)=>s+(Number(config.prices[r.type])||0)*duration,0);
  let discount=0; for(const p of promos){ if(p.type==='percent') discount += base*(Math.max(0,Math.min(100,Number(p.value)||0))/100); else if(p.type==='fixed') discount += Math.max(0,Number(p.value)||0); }
  discount=Math.min(base,Math.round(discount*100)/100); let penalty=0;
  if(config.lateBooking?.enabled && lead < Number(config.lateBooking.thresholdMinutes||60)){ penalty=config.lateBooking.type==='fixed'?Number(config.lateBooking.value||0):(base-discount)*Number(config.lateBooking.value||0)/100; }
  penalty=Math.max(0,Math.round(penalty*100)/100); return {base,discount,penalty,total:Math.max(0,base-discount+penalty)};
}

/*
 * Permanent business rule: every Tuesday is 50% off the final total. This
 * used to be hand-implemented only inside api/_lib/paypal-reservation.js
 * (labeled "EMERGENCY PATCH"), so a bank-transfer booking (api/reservations/
 * create.js) never got the discount while a PayPal booking on the same date
 * did. It's now one function both paths call after priceReservation().
 */
export function applyTuesdayPromotion(pricing, dateStr){
  if (dateDay(dateStr) !== 2) return pricing;
  const totalBeforeDiscount = Number(pricing.total || 0);
  const tuesdayDiscount = Math.round(totalBeforeDiscount * 0.5 * 100) / 100;
  const total = Math.round((totalBeforeDiscount - tuesdayDiscount) * 100) / 100;
  return {
    ...pricing,
    beforeTuesdayDiscount: totalBeforeDiscount,
    tuesdayDiscount,
    tuesdayDiscountPercent: 50,
    tuesdayPromotionApplied: true,
    total
  };
}
export function slotIds(date,start,end,slotMinutes,rigId){ const out=[]; for(let m=start;m<end;m+=slotMinutes) out.push(`${date}_${String(Math.floor(m/60)).padStart(2,'0')}${String(m%60).padStart(2,'0')}_${rigId}`); return out; }
export function code(){ return `IN-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
export function expiresAt(date,time){ const [y,m,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number); return Timestamp.fromDate(new Date(Date.UTC(y,m-1,d,h+6,mi))); }
