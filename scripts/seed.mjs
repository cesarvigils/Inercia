import { initializeApp, cert } from 'firebase-admin/app'; import { getFirestore } from 'firebase-admin/firestore';
const service=JSON.parse(process.env.GOOGLE_CREDENTIALS); service.private_key=service.private_key.replace(/\\n/g,'\n'); initializeApp({credential:cert(service)}); const db=getFirestore();
const batch=db.batch();
for(let i=1;i<=8;i++) batch.set(db.doc(`rigs/standard-${i}`),{type:'standard',number:i,name:`Standard ${i}`,active:true,sort:i});
for(let i=1;i<=2;i++) batch.set(db.doc(`rigs/premium-${i}`),{type:'premium',number:i,name:`Premium ${i}`,active:true,sort:100+i});
batch.set(db.doc('settings/reservations'),{bookingWindowDays:7,minLeadMinutes:30,minDurationHours:1,maxDurationHours:8,slotMinutes:30,prices:{standard:200,premium:350},hours:{0:['12:00','21:00'],1:['10:00','21:00'],2:['10:00','21:00'],3:['10:00','21:00'],4:['10:00','21:00'],5:['10:00','21:00'],6:['12:00','21:00']},lateBooking:{enabled:true,thresholdMinutes:60,type:'percent',value:0},payment:{bankTransfer:true,card:true,paypal:false,bank:'BAC',currency:'HNL',account:'758-610-001',beneficiary:'Inercia S.A.'}},{merge:true});
await batch.commit(); console.log('Seed listo: 8 Standard, 2 Premium y settings/reservations.');
