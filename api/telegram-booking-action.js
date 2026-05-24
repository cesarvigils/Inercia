import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getDatabase } from "firebase-admin/database"

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN

const FIREBASE_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL

function getServiceAccount() {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT

  if (!raw) {
    throw new Error("Falta FIREBASE_SERVICE_ACCOUNT")
  }

  const serviceAccount =
    JSON.parse(raw)

  if (serviceAccount.private_key) {
    serviceAccount.private_key =
      serviceAccount.private_key.replace(/\\n/g, "\n")
  }

  return serviceAccount
}

if (!getApps().length) {
  initializeApp({
    credential: cert(getServiceAccount()),
    databaseURL: FIREBASE_DATABASE_URL
  })
}

const db =
  getDatabase()

async function answerCallback(callbackQueryId, text) {
  if (!TELEGRAM_TOKEN || !callbackQueryId) return

  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: false
      })
    }
  )
}

async function editMessage(chatId, messageId, text) {
  if (!TELEGRAM_TOKEN || !chatId || !messageId) return

  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text
      })
    }
  )
}

async function removeButtons(chatId, messageId) {
  if (!TELEGRAM_TOKEN || !chatId || !messageId) return

  await fetch(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageReplyMarkup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: []
        }
      })
    }
  )
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "method_not_allowed"
      })
    }

    if (!TELEGRAM_TOKEN) {
      return res.status(500).json({
        error: "missing_telegram_token"
      })
    }

    if (!FIREBASE_DATABASE_URL) {
      return res.status(500).json({
        error: "missing_firebase_database_url"
      })
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {}

    const callback =
      body.callback_query

    if (!callback) {
      return res.status(200).json({
        ok: true,
        ignored: true
      })
    }

    const callbackData =
      String(callback.data || "")

    const [action, bookingId] =
      callbackData.split(":")

    if (!bookingId) {
      await answerCallback(
        callback.id,
        "Reserva inválida."
      )

      return res.status(400).json({
        error: "missing_booking_id",
        received: callbackData
      })
    }

    const bookingRef =
      db.ref(`bookings/${bookingId}`)

    const bookingSnap =
      await bookingRef.get()

    if (!bookingSnap.exists()) {
      await answerCallback(
        callback.id,
        "La reserva no existe."
      )

      return res.status(404).json({
        error: "booking_not_found",
        bookingId
      })
    }

    const booking =
      bookingSnap.val()

    const DAY =
      24 * 60 * 60 * 1000

    const expired =
      booking.createdAt &&
      Date.now() - Number(booking.createdAt) > DAY

    const chatId =
      callback.message?.chat?.id

    const messageId =
      callback.message?.message_id

    const originalText =
      callback.message?.text || ""

    if (expired) {
      await bookingRef.update({
        status: "expired",
        expiredAt: Date.now(),
        reviewedByTelegram: true
      })

      await answerCallback(
        callback.id,
        "La solicitud expiró."
      )

      await removeButtons(chatId, messageId)

      await editMessage(
        chatId,
        messageId,
        `${originalText}

⏰ Solicitud expirada`
      )

      return res.status(200).json({
        ok: true,
        expired: true
      })
    }

    const status =
      action === "confirm"
        ? "confirmed"
        : action === "reject"
          ? "rejected"
          : null

    if (!status) {
      await answerCallback(
        callback.id,
        "Acción inválida."
      )

      return res.status(400).json({
        error: "invalid_action",
        received: action
      })
    }

    await bookingRef.update({
      status,
      reviewedAt: Date.now(),
      reviewedByTelegram: true
    })

    await answerCallback(
      callback.id,
      status === "confirmed"
        ? "Reserva confirmada."
        : "Reserva rechazada."
    )

    await removeButtons(chatId, messageId)

    await editMessage(
      chatId,
      messageId,
      `${originalText}

${
  status === "confirmed"
    ? "✅ Reserva confirmada"
    : "❌ Reserva rechazada"
}`
    )

    return res.status(200).json({
      ok: true,
      bookingId,
      status
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      error: "telegram_action_failed",
      details: error.message
    })
  }
}