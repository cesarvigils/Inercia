import { adminDb, requireAdmin, sendError } from "./admin-utils.js"

export default async function handler(req, res) {
  try {
    await requireAdmin(req)

    if (req.method === "GET") {
      const snap = await adminDb.ref("admin/promotions").get()
      const data = snap.exists() ? snap.val() : {}
      const promos = Object.entries(data).map(([id, promo]) => ({ id, ...promo }))
      return res.status(200).json({ ok: true, promos })
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}
      const id = body.id || adminDb.ref("admin/promotions").push().key

      const promo = {
        id,
        name: body.name || "Promo",
        type: body.type || "fixed_price",
        simulatorType: body.simulatorType || "standard",
        fixedPrice: Number(body.fixedPrice || 0),
        percent: Number(body.percent || 0),
        active: body.active !== false,
        days: Array.isArray(body.days) ? body.days.map(Number) : [],
        endsAt: body.endsAt || "",
        updatedAt: Date.now()
      }

      await adminDb.ref(`admin/promotions/${id}`).set(promo)
      return res.status(200).json({ ok: true, promo })
    }

    if (req.method === "DELETE") {
      const id = req.query.id
      if (!id) return res.status(400).json({ error: "missing_promo_id" })
      await adminDb.ref(`admin/promotions/${id}`).remove()
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: "method_not_allowed" })
  } catch (error) {
    return sendError(res, error)
  }
}
