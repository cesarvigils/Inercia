// scripts/seed.mjs
//
// One-off, manually-run Firestore seeding script (not called by the app or any API route) — run it by
// hand (e.g. `node scripts/seed.mjs`) to (re)populate a fresh/empty Firestore project with the baseline
// data the app expects: 8 "standard" rigs, 2 "premium" rigs (under the `rigs` collection, matching what
// api/reservations/config.js and api/_lib/reservations.js read), and the settings/reservations document
// (booking window, hours, durations, prices, late-booking rule, and payment method / bank transfer info —
// this is the same document api/_lib/reservations.js's getConfig() merges with its own DEFAULT_CONFIG).
// Uses `{ merge: true }` on settings/reservations, so re-running this is safe and won't wipe fields that
// were changed manually since.
//
// Requires a GOOGLE_CREDENTIALS environment variable containing a full Firebase service account JSON
// (as a string) — this is a different env var name than api/_lib/firebase-admin.js's
// FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY trio, since this script is only ever run
// locally/manually and isn't part of the deployed API.
import { initializeApp, cert } from 'firebase-admin/app'; import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const service=JSON.parse(process.env.GOOGLE_CREDENTIALS); service.private_key=service.private_key.replace(/\\n/g,'\n'); initializeApp({credential:cert(service)}); const db=getFirestore();
const batch=db.batch();
for(let i=1;i<=8;i++) batch.set(db.doc(`rigs/standard-${i}`),{type:'standard',number:i,name:`Standard ${i}`,active:true,sort:i});
for(let i=1;i<=2;i++) batch.set(db.doc(`rigs/premium-${i}`),{type:'premium',number:i,name:`Premium ${i}`,active:true,sort:100+i});
// hours.1 (lunes) usa FieldValue.delete() en vez de simplemente omitirse: con
// set(...,{merge:true}), un mapa anidado como "hours" se mezcla clave por
// clave, así que si esta reserva ya se corrió antes con un valor viejo para
// el lunes, omitirlo no lo borraría — quedaría "cerrado" solo en instalaciones
// nuevas. delete() lo saca explícitamente pase lo que pase.
batch.set(db.doc('settings/reservations'),{bookingWindowDays:7,minLeadMinutes:30,minDurationHours:1,maxDurationHours:8,slotMinutes:30,prices:{standard:200,premium:350},hours:{0:['12:00','21:00'],1:FieldValue.delete(),2:['14:00','21:00'],3:['14:00','21:00'],4:['14:00','21:00'],5:['14:00','21:00'],6:['12:00','21:00']},lateBooking:{enabled:true,thresholdMinutes:60,type:'percent',value:0},payment:{bankTransfer:true,card:true,paypal:false,bank:'BAC',currency:'HNL',account:'758-610-001',beneficiary:'Inercia S.A.'}},{merge:true});
await batch.commit(); console.log('Seed listo: 8 Standard, 2 Premium y settings/reservations (martes-viernes 14:00-21:00, sábado-domingo 12:00-21:00, lunes cerrado).');
