// Reserved endpoint. Proof files are uploaded directly to Firebase Storage by the authenticated client,
// then /api/reservations/create validates ownership, MIME type, existence and size server-side.
export default function handler(req,res){res.status(410).json({error:'Usá la subida directa autenticada a Firebase Storage.'})}
