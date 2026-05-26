import { adminDb, requireAdmin, sendError } from "./admin-utils.js"

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}
}

function getStartDate(range) {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  if (range === "week") return now - 7 * day
  if (range === "month") return now - 30 * day
  if (range === "year") return now - 365 * day
  return 0
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req)

    if (req.method === "GET") {
      const range = req.query.range || "month"
      const start = getStartDate(range)

      const salesSnap = await adminDb.ref("admin/sales").get()
      const salesData = salesSnap.exists() ? salesSnap.val() : {}

      const bookingsSnap = await adminDb.ref("bookings").get()
      const bookingsData = bookingsSnap.exists() ? bookingsSnap.val() : {}

      const completedSnap = await adminDb.ref("admin/completedBookings").get()
      const completedData = completedSnap.exists() ? completedSnap.val() : {}

      const sales = Object.entries(salesData)
        .map(([id, sale]) => ({ id, ...sale }))
        .filter((sale) => Number(sale.createdAt || 0) >= start)

      const bookingSales = [...Object.entries(bookingsData), ...Object.entries(completedData)]
        .map(([id, booking]) => ({
          id: `booking-${id}`,
          type: "booking",
          description: `Reserva - ${booking.name || "Cliente"}`,
          amount: Number(booking.totalHNL || booking.total || 0),
          method: booking.paymentMethod || "-",
          createdAt: Number(booking.createdAt || booking.completedAt || 0),
          bookingId: id
        }))
        .filter((sale) => sale.amount > 0 && sale.createdAt >= start)

      const allSales = [...sales, ...bookingSales]
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))

      const total = allSales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)

      return res.status(200).json({ ok: true, range, total, sales: allSales })
    }

    if (req.method === "POST") {
      const body = parseBody(req)
      const amount = Number(body.amount || 0)

      if (!body.description || amount <= 0) {
        return res.status(400).json({ error: "missing_description_or_amount" })
      }

      const saleRef = adminDb.ref("admin/sales").push()

      const sale = {
        id: saleRef.key,
        type: body.type || "manual",
        description: body.description,
        amount,
        method: body.method || "cash",
        productId: body.productId || null,
        quantity: Number(body.quantity || 1),
        createdAt: Date.now()
      }

      await saleRef.set(sale)
      return res.status(200).json({ ok: true, sale })
    }

    return res.status(405).json({ error: "method_not_allowed" })
  } catch (error) {
    return sendError(res, error)
  }
}
