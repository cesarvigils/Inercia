/*
 * GET /api/reservations/config?date=YYYY-MM-DD
 *
 * Public bootstrap endpoint for the booking page: returns the current
 * booking rules (getConfig() — hours, prices, booking window, etc, see
 * api/_lib/reservations.js), the list of active rigs sorted for display,
 * and any promotions active on the given date (defaults to today). The
 * frontend calls this once on page load to render the booking form.
 */

import { method, json, fail, rateLimit } from '../_lib/http.js';
import { getConfig, activePromotions, getActiveRigs } from '../_lib/reservations.js';
export default async function handler(req,res){ try{ if(!method(req,res,['GET']))return; if(!rateLimit(req,res,{limit:30,windowMs:60_000}))return; const config=await getConfig(); const rigs=(await getActiveRigs()).sort((a,b)=>(a.sort||0)-(b.sort||0)); const promotions=await activePromotions(req.query.date || new Date().toISOString().slice(0,10),['standard','premium']); res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=300'); json(res,200,{config,rigs,promotions}); }catch(e){fail(res,e)} }
