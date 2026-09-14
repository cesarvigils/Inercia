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
 *   - slotIds(...)          Generates the list of per-30-minutes (or
 *                           whatever slotMinutes is) lock document IDs for
 *                           a rig over a date/time range. These IDs are used
 *                           as Firestore document IDs in `reservationLocks`
 *                           to prevent double-booking the same rig/slot.
 *   - code()                Generates a short human-readable reservation
 *                           code like "IN-240615-A1B2C3".
 *   - expiresAt(date, time) Returns a Firestore Timestamp ~6 hours after the
 *                           given local date/time, used to auto-expire
 *                           stale/unconfirmed reservations.
 */

import crypto from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.js';

export const TZ = 'America/Tegucigalpa';
const DEFAULT_CONFIG = {
  bookingWindowDays: 7, minLeadMinutes: 30, minDurationHours: 1, maxDurationHours: 8, slotMinutes: 30,
  prices: { standard: 200, premium: 350 },
  hours: { 0: ['12:00','21:00'], 1: ['10:00','21:00'], 2: ['10:00','21:00'], 3: ['10:00','21:00'], 4: ['10:00','21:00'], 5: ['10:00','21:00'], 6: ['12:00','21:00'] },
  lateBooking: { enabled: true, thresholdMinutes: 60, type: 'percent', value: 0 },
  payment: { bankTransfer: true, card: true, paypal: false, bank: 'BAC', currency: 'HNL', account: '758-610-001', beneficiary: 'Inercia S.A.' }
};
function merge(a,b){ return { ...a, ...b, prices:{...a.prices,...b?.prices}, hours:{...a.hours,...b?.hours}, lateBooking:{...a.lateBooking,...b?.lateBooking}, payment:{...a.payment,...b?.payment} }; }
export async function getConfig(){ const s=await adminDb.doc('settings/reservations').get(); return merge(DEFAULT_CONFIG, s.exists ? s.data() : {}); }
export function hm(s){ const [h,m]=String(s).split(':').map(Number); return h*60+m; }
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
  const snap=await adminDb.collection('promotions').where('active','==',true).get(); const day=dateDay(date); return snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>(!p.daysOfWeek||p.daysOfWeek.includes(day))&&(!p.startDate||date>=p.startDate)&&(!p.endDate||date<=p.endDate)&&(!p.simulatorTypes||types.some(t=>p.simulatorTypes.includes(t))));
}
export function priceReservation(rigs,duration,config,promos,lead){
  const base=rigs.reduce((s,r)=>s+(Number(config.prices[r.type])||0)*duration,0);
  let discount=0; for(const p of promos){ if(p.type==='percent') discount += base*(Math.max(0,Math.min(100,Number(p.value)||0))/100); else if(p.type==='fixed') discount += Math.max(0,Number(p.value)||0); }
  discount=Math.min(base,Math.round(discount*100)/100); let penalty=0;
  if(config.lateBooking?.enabled && lead < Number(config.lateBooking.thresholdMinutes||60)){ penalty=config.lateBooking.type==='fixed'?Number(config.lateBooking.value||0):(base-discount)*Number(config.lateBooking.value||0)/100; }
  penalty=Math.max(0,Math.round(penalty*100)/100); return {base,discount,penalty,total:Math.max(0,base-discount+penalty)};
}
export function slotIds(date,start,end,slotMinutes,rigId){ const out=[]; for(let m=start;m<end;m+=slotMinutes) out.push(`${date}_${String(Math.floor(m/60)).padStart(2,'0')}${String(m%60).padStart(2,'0')}_${rigId}`); return out; }
export function code(){ return `IN-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
export function expiresAt(date,time){ const [y,m,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number); return Timestamp.fromDate(new Date(Date.UTC(y,m-1,d,h+6,mi))); }
