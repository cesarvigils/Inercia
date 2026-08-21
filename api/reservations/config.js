import { method, json, fail } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { getConfig, activePromotions } from '../_lib/reservations.js';
export default async function handler(req,res){ try{ if(!method(req,res,['GET']))return; const config=await getConfig(); const rigs=(await adminDb.collection('rigs').where('active','==',true).get()).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.sort||0)-(b.sort||0)); const promotions=await activePromotions(req.query.date || new Date().toISOString().slice(0,10),['standard','premium']); json(res,200,{config,rigs,promotions}); }catch(e){fail(res,e)} }
