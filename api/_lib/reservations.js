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
