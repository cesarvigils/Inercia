import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getDatabase } from "firebase-admin/database"

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: process.env.VITE_FIREBASE_DATABASE_URL
  })
}

const db = getDatabase()

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN

async function answerCallback(callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text
    })
  })
}

async function editMessage(chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text
    })
  })
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "method_not_allowed"
      })
    }

    const callback =
      req.body.callback_query

    if (!callback) {
      return res.status(200).json({
        ok: true,
        ignored: true
      })
    }

    const [action, bookingId] =
      callback.data.split(":")

    if (!bookingId) {
      await answerCallback(callback.id, "Reserva inválida.")
      return res.status(400).json({
        error: "missing_booking_id"
      })
    }

    const status =
      action === "confirm"
        ? "confirmed"
        : action === "reject"
          ? "rejected"
          : null

    if (!status) {
      await answerCallback(callback.id, "Acción inválida.")
      return res.status(400).json({
        error: "invalid_action"
      })
    }

    await db.ref(`bookings/${bookingId}`).update({
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

    await editMessage(
      callback.message.chat.id,
      callback.message.message_id,
      status === "confirmed"
        ? `✅ Reserva confirmada\n\nID: ${bookingId}`
        : `❌ Reserva rechazada\n\nID: ${bookingId}`
    )

    return res.status(200).json({
      ok: true
    })
  } catch (error) {
    return res.status(500).json({
      error: "telegram_action_failed",
      details: error.message
    })
  }
}