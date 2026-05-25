import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getDatabase } from "firebase-admin/database"

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error("Falta FIREBASE_SERVICE_ACCOUNT")

  const account = JSON.parse(raw)
  if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, "\n")

  return account
}

if (!getApps().length) {
  initializeApp({
    credential: cert(getServiceAccount()),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  })
}

const db = getDatabase()

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" })

    const uid = req.query.uid
    const date = req.query.date

    if (!uid || !date) return res.status(400).json({ error: "missing_uid_or_date" })

    const snap = await db.ref("bookings").get()
    const data = snap.exists() ? snap.val() : {}

    const count = Object.values(data).filter((booking) => {
      return booking.uid === uid &&
        booking.date === date &&
        booking.status !== "rejected" &&
        booking.status !== "expired"
    }).length

    return res.status(200).json({ ok: true, uid, date, count })
  } catch (error) {
    return res.status(500).json({
      error: "booking_count_failed",
      details: error.message
    })
  }
}
