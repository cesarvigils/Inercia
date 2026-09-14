// POST /api/uploads/proof
//
// Reserved endpoint. Proof files are uploaded directly to Firebase Storage by the authenticated client,
// then /api/reservations/create validates ownership, MIME type, existence and size server-side.
//
// This endpoint intentionally does nothing but return 410 Gone — it exists so old frontend code (or
// documentation) pointing at this URL fails loudly and obviously instead of silently 404ing. If you're
// looking for where transfer-proof uploads are actually handled/validated, see api/reservations/create.js
// (search for "PAYMENT PROOF").
export default function handler(req,res){res.status(410).json({error:'Usá la subida directa autenticada a Firebase Storage.'})}
