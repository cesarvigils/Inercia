import formidable from "formidable"
import fs from "fs"

export const config = {
  api: {
    bodyParser: false
  }
}

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN

const TELEGRAM_GROUP_CHAT_ID =
  process.env.TELEGRAM_GROUP_CHAT_ID

function pick(value) {
  return Array.isArray(value) ? value[0] : value
}

function getFile(files, name) {
  if (!files) return null
  return pick(files[name])
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "method_not_allowed"
      })
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {}

    const {
      bookingId,
      name,
      email,
      phone,
      date,
      times,
      rigs,
      total,
      proofURL
    } = body

    if (!bookingId || !proofURL) {
      return res.status(400).json({
        error: "missing_booking_id_or_proof_url",
        received: body
      })
    }

    const token =
      process.env.TELEGRAM_BOT_TOKEN

    const chatId =
      process.env.TELEGRAM_GROUP_CHAT_ID

    if (!token || !chatId) {
      return res.status(500).json({
        error: "missing_telegram_env"
      })
    }

    const text = `
🧾 Nueva transferencia pendiente

 Cliente: ${name || "-"}
 Email: ${email || "-"}
Teléfono: ${phone || "-"}
 Fecha: ${date || "-"}
 Horas: ${(times || []).join(", ")}
 Simuladores: ${(rigs || []).join(", ")}
 Total: L ${Number(total || 0).toFixed(2)}

📎 Comprobante:
${proofURL}
`

    const response =
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Confirmar reserva",
                  callback_data: `confirm:${bookingId}`
                },
                {
                  text: "❌ Rechazar reserva",
                  callback_data: `reject:${bookingId}`
                }
              ]
            ]
          }
        })
      })

    const data =
      await response.json()

    if (!data.ok) {
      return res.status(400).json(data)
    }

    return res.status(200).json(data)
  } catch (error) {
    return res.status(500).json({
      error: "telegram_send_failed",
      details: error.message
    })
  }
}