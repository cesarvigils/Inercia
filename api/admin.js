import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getDatabase } from "firebase-admin/database"

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT

  if (!raw) {
    throw new Error("missing_firebase_service_account")
  }

  const account = JSON.parse(raw)

  if (account.private_key) {
    account.private_key = account.private_key.replace(/\\n/g, "\n")
  }

  return account
}

if (!getApps().length) {
  initializeApp({
    credential: cert(getServiceAccount()),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  })
}

const adminAuth = getAuth()
const db = getDatabase()

function parseBody(req) {
  return typeof req.body === "string"
    ? JSON.parse(req.body || "{}")
    : req.body || {}
}

async function requireAdmin(req) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : ""

  if (!token) {
    throw new Error("missing_token")
  }

  const decoded = await adminAuth.verifyIdToken(token)

  const adminEmails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  const email = String(decoded.email || "").toLowerCase()

  if (!decoded.admin && !adminEmails.includes(email)) {
    throw new Error("not_admin")
  }

  return decoded
}

function sendError(res, error) {
  const msg = error.message || "server_error"

  const status =
    msg === "missing_token"
      ? 401
      : msg === "not_admin"
        ? 403
        : 500

  return res.status(status).json({
    error: msg
  })
}

function getStartDate(range) {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  if (range === "week") return now - 7 * day
  if (range === "month") return now - 30 * day
  if (range === "year") return now - 365 * day

  return 0
}

function isTuesdayToSunday(dateString) {
  const day = new Date(`${dateString}T12:00:00`).getDay()
  return day === 0 || (day >= 2 && day <= 6)
}

async function handleBookings(req, res) {
  if (req.method === "GET") {
    const snap = await db.ref("bookings").get()
    const data = snap.exists() ? snap.val() : {}

    const bookings = Object.entries(data)
      .map(([id, booking]) => ({ id, ...booking }))
      .filter((booking) => booking.date && isTuesdayToSunday(booking.date))
      .sort((a, b) => {
        const dc = String(a.date).localeCompare(String(b.date))
        if (dc !== 0) return dc
        return String(a.times?.[0] || "").localeCompare(String(b.times?.[0] || ""))
      })

    return res.status(200).json({
      ok: true,
      bookings
    })
  }

  if (req.method === "POST") {
    const body = parseBody(req)

    if (!body.name || !body.phone || !body.date || !body.times?.length || !body.rigs?.length) {
      return res.status(400).json({
        error: "missing_booking_fields"
      })
    }

    const bookingRef = db.ref("bookings").push()
    const bookingId = bookingRef.key

    const bookingData = {
      id: bookingId,
      uid: body.uid || "manual-admin",
      name: body.name,
      phone: body.phone,
      email: body.email || "",
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

    if (bookingData.totalHNL > 0) {
      const saleRef = db.ref("admin/sales").push()

      await saleRef.set({
        id: saleRef.key,
        type: "booking_manual",
        description: `Reserva manual - ${bookingData.name}`,
        bookingId,
        amount: bookingData.totalHNL,
        method: "admin",
        createdAt: Date.now()
      })
    }

    return res.status(200).json({
      ok: true,
      booking: bookingData
    })
  }

  if (req.method === "PATCH") {
    const body = parseBody(req)

    if (!body.id) {
      return res.status(400).json({
        error: "missing_booking_id"
      })
    }

    if (body.action === "complete") {
      const snap = await db.ref(`bookings/${body.id}`).get()
      const booking = snap.exists() ? snap.val() : {}

      await db.ref(`admin/completedBookings/${body.id}`).set({
        id: body.id,
        ...booking,
        status: "completed",
        completedAt: Date.now()
      })

      await db.ref(`bookings/${body.id}`).remove()

      return res.status(200).json({
        ok: true,
        completed: true
      })
    }

    await db.ref(`bookings/${body.id}`).update({
      status: body.status,
      updatedAt: Date.now()
    })

    return res.status(200).json({
      ok: true
    })
  }

  if (req.method === "DELETE") {
    const id = req.query.id

    if (!id) {
      return res.status(400).json({
        error: "missing_booking_id"
      })
    }

    await db.ref(`bookings/${id}`).remove()

    return res.status(200).json({
      ok: true
    })
  }

  return res.status(405).json({
    error: "method_not_allowed"
  })
}

async function handleUsers(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "method_not_allowed"
    })
  }

  const snap = await db.ref("users").get()
  const data = snap.exists() ? snap.val() : {}

  const users = Object.entries(data)
    .map(([uid, user]) => ({ uid, ...user }))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))

  return res.status(200).json({
    ok: true,
    users
  })
}

async function handlePromos(req, res) {
  if (req.method === "GET") {
    const snap = await db.ref("promotions").get()
    const data = snap.exists() ? snap.val() : {}

    const promos = Object.entries(data)
      .map(([id, promo]) => ({ id, ...promo }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))

    return res.status(200).json({
      ok: true,
      promos
    })
  }

  if (req.method === "POST") {
    const body = parseBody(req)
    const id = body.id || db.ref("promotions").push().key

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

await db.ref(`promotions/${id}`).set(promo)
    return res.status(200).json({
      ok: true,
      promo
    })
  }

  if (req.method === "DELETE") {
    const id = req.query.id

    if (!id) {
      return res.status(400).json({
        error: "missing_promo_id"
      })
    }

await db.ref(`promotions/${id}`).remove()
    return res.status(200).json({
      ok: true
    })
  }

  return res.status(405).json({
    error: "method_not_allowed"
  })
}

async function handleCreditHours(req, res, admin) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "method_not_allowed"
    })
  }

  const body = parseBody(req)
  const uid = body.uid
  const hours = Number(body.hours || 0)

  if (!uid || hours <= 0) {
    return res.status(400).json({
      error: "missing_uid_or_hours"
    })
  }

  const userRef = db.ref(`users/${uid}`)
  const snap = await userRef.get()
  const user = snap.exists() ? snap.val() : {}
  const current = Number(user.freeHours || 0)

  await userRef.update({
    freeHours: current + hours,
    freeHoursUpdatedAt: Date.now()
  })

  const creditRef = db.ref("admin/freeHoursCredits").push()

  await creditRef.set({
    id: creditRef.key,
    uid,
    hours,
    note: body.note || "",
    adminEmail: admin.email || "",
    createdAt: Date.now()
  })

  return res.status(200).json({
    ok: true,
    uid,
    freeHours: current + hours
  })
}

async function handleProducts(req, res) {
  if (req.method === "GET") {
    const snap = await db.ref("admin/products").get()
    const data = snap.exists() ? snap.val() : {}

    const products = Object.entries(data)
      .map(([id, product]) => ({ id, ...product }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))

    return res.status(200).json({
      ok: true,
      products
    })
  }

  if (req.method === "POST") {
    const body = parseBody(req)

    if (!body.name || Number(body.price || 0) <= 0) {
      return res.status(400).json({
        error: "missing_product_name_or_price"
      })
    }

    const id = body.id || db.ref("admin/products").push().key

    const product = {
      id,
      name: body.name,
      price: Number(body.price),
      active: body.active !== false,
      updatedAt: Date.now()
    }

    await db.ref(`admin/products/${id}`).set(product)

    return res.status(200).json({
      ok: true,
      product
    })
  }

  if (req.method === "DELETE") {
    const id = req.query.id

    if (!id) {
      return res.status(400).json({
        error: "missing_product_id"
      })
    }

    await db.ref(`admin/products/${id}`).remove()

    return res.status(200).json({
      ok: true
    })
  }

  return res.status(405).json({
    error: "method_not_allowed"
  })
}

async function handleSales(req, res) {
  if (req.method === "GET") {
    const range = req.query.range || "month"
    const start = getStartDate(range)

    const salesSnap = await db.ref("admin/sales").get()
    const salesData = salesSnap.exists() ? salesSnap.val() : {}

    const bookingsSnap = await db.ref("bookings").get()
    const bookingsData = bookingsSnap.exists() ? bookingsSnap.val() : {}

    const completedSnap = await db.ref("admin/completedBookings").get()
    const completedData = completedSnap.exists() ? completedSnap.val() : {}

    const sales = Object.entries(salesData)
      .map(([id, sale]) => ({ id, ...sale }))
      .filter((sale) => Number(sale.createdAt || 0) >= start)

    const bookingSales = [
      ...Object.entries(bookingsData),
      ...Object.entries(completedData)
    ]
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

    return res.status(200).json({
      ok: true,
      range,
      total,
      sales: allSales
    })
  }

  if (req.method === "POST") {
    const body = parseBody(req)
    const amount = Number(body.amount || 0)

    if (!body.description || amount <= 0) {
      return res.status(400).json({
        error: "missing_description_or_amount"
      })
    }

    const saleRef = db.ref("admin/sales").push()

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

    return res.status(200).json({
      ok: true,
      sale
    })
  }

  if (req.method === "DELETE") {
    const id = req.query.id

    if (!id) {
      return res.status(400).json({
        error: "missing_sale_id"
      })
    }

    await db.ref(`admin/sales/${id}`).remove()

    return res.status(200).json({
      ok: true
    })
  }

  return res.status(405).json({
    error: "method_not_allowed"
  })
}

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req)
    const action = req.query.action

    if (action === "bookings") return handleBookings(req, res)
    if (action === "users") return handleUsers(req, res)
    if (action === "promos") return handlePromos(req, res)
    if (action === "credit-hours") return handleCreditHours(req, res, admin)
    if (action === "products") return handleProducts(req, res)
    if (action === "sales") return handleSales(req, res)

    return res.status(400).json({
      error: "invalid_admin_action"
    })
  } catch (error) {
    return sendError(res, error)
  }
}