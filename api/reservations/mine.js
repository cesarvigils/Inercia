/*
 * GET /api/reservations/mine
 *
 * Returns the signed-in user's own reservations (most recent 50, newest
 * first), for a "my bookings" page. Requires a valid Firebase auth token
 * (requireUser) — there is no admin/all-users variant of this endpoint
 * here, only the caller's own reservations (filtered by uid).
 */
import { method,json,fail,requireUser,rateLimit } from '../_lib/http.js'; import { adminDb } from '../_lib/firebase-admin.js';
export default async function handler(req,res){try{if(!method(req,res,['GET']))return;const u=await requireUser(req);if(!rateLimit(req,res,{key:`mine:${u.uid}`,limit:20,windowMs:60_000}))return;const s=await adminDb.collection('reservations').where('uid','==',u.uid).orderBy('createdAt','desc').limit(50).get();json(res,200,{reservations:s.docs.map(d=>({id:d.id,...d.data()}))});}catch(e){fail(res,e)}}
