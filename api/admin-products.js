import { adminDb, requireAdmin, sendError } from "./admin-utils.js"

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req)

    if (req.method === "GET") {
      const snap = await adminDb.ref("admin/products").get()
      const data = snap.exists() ? snap.val() : {}
      const products = Object.entries(data).map(([id, product]) => ({ id, ...product }))
      return res.status(200).json({ ok: true, products })
    }

    if (req.method === "POST") {
      const body = parseBody(req)

      if (!body.name || Number(body.price || 0) <= 0) {
        return res.status(400).json({ error: "missing_product_name_or_price" })
      }

      const id = body.id || adminDb.ref("admin/products").push().key

      const product = {
        id,
        name: body.name,
        price: Number(body.price),
        active: body.active !== false,
        updatedAt: Date.now()
      }

      await adminDb.ref(`admin/products/${id}`).set(product)
      return res.status(200).json({ ok: true, product })
    }

    if (req.method === "DELETE") {
      const id = req.query.id
      if (!id) return res.status(400).json({ error: "missing_product_id" })
      await adminDb.ref(`admin/products/${id}`).remove()
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: "method_not_allowed" })
  } catch (error) {
    return sendError(res, error)
  }
}
