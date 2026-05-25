import { adminDb, requireAdmin, sendError } from "./admin-utils.js"

function isTuesdayToSunday(dateString) {
  const day = new Date(`${dateString}T12:00:00`).getDay()
  return day === 0 || (day >= 2 && day <= 6)
}

function parseBody(req) {
  return typeof req.body === "string"
    ? JSON.parse(req.body || "{}")
    : req.body || {}
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req)

    if (req.method === "GET") {
      const snap = await adminDb.ref("bookings").get()
      const data = snap.exists() ? snap.val() : {}

      const bookings = Object.entries(data)
        .map(([id, booking]) => ({ id, ...booking }))
        .filter((booking) => booking.date && isTuesdayToSunday(booking.date))
        .sort((a, b) => {
          const dc = String(a.date).localeCompare(String(b.date))
          if (dc !== 0) return dc
          return String(a.times?.[0] || "").localeCompare(String(b.times?.[0] || ""))
        })

      return res.status(200).json({ ok: true, bookings })
    }

    if (req.method === "POST") {
      const body = parseBody(req)

      if (!body.name || !body.phone || !body.email || !body.date || !body.times?.length || !body.rigs?.length) {
        return res.status(400).json({ error: "missing_booking_fields" })
      }

      const bookingRef = adminDb.ref("bookings").push()
      const bookingId = bookingRef.key

      const bookingData = {
        id: bookingId,
        uid: body.uid || "manual-admin",
        name: body.name,
        phone: body.phone,
        email: body.email,
        date: body.date,
        times: body.times,
        hoursCount: body.times.length,
        rigs: body.rigs,
        rigDetails: body.rigDetails || [],
        rigsCount: body.rigs.length,
        paymentMethod: body.paymentMethod || "admin",
        currencyDisplayed: "HNL",
        currencyCharged: "HNL",
        totalHNL: Number(body.totalHNL || 0),
        totalUSD: null,
        status: body.status || "admin_manual",
        createdByAdmin: true,
        createdAt: Date.now()
      }

      await bookingRef.set(bookingData)

      return res.status(200).json({ ok: true, booking: bookingData })
    }

    if (req.method === "PATCH") {
      const body = parseBody(req)

      if (!body.id) return res.status(400).json({ error: "missing_booking_id" })

      if (body.action === "complete") {
        const snap = await adminDb.ref(`bookings/${body.id}`).get()
        const booking = snap.exists() ? snap.val() : {}

        await adminDb.ref(`admin/completedBookings/${body.id}`).set({
          id: body.id,
          ...booking,
          status: "completed",
          completedAt: Date.now()
        })

        await adminDb.ref(`bookings/${body.id}`).remove()

        return res.status(200).json({ ok: true, completed: true, removedFromBoard: true })
      }

      const updates = { updatedAt: Date.now() }
      if (body.status) updates.status = body.status

      await adminDb.ref(`bookings/${body.id}`).update(updates)

      return res.status(200).json({ ok: true, updated: true })
    }

    if (req.method === "DELETE") {
      const id = req.query.id
      if (!id) return res.status(400).json({ error: "missing_booking_id" })

      await adminDb.ref(`bookings/${id}`).remove()

      return res.status(200).json({ ok: true, deleted: true })
    }

    return res.status(405).json({ error: "method_not_allowed" })
  } catch (error) {
    return sendError(res, error)
  }
}
