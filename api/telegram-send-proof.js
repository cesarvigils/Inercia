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

function getFile(file) {
  return Array.isArray(file) ? file[0] : file
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "method_not_allowed"
    })
  }

  try {
    const form = formidable({
      multiples: false,
      keepExtensions: true
    })

    const { fields, files } =
      await form.parse(req)

    const proofFile =
      getFile(files.proof)

    const bookingId =
      Array.isArray(fields.bookingId)
        ? fields.bookingId[0]
        : fields.bookingId

    const bookingRaw =
      Array.isArray(fields.booking)
        ? fields.booking[0]
        : fields.booking

    const booking =
      JSON.parse(bookingRaw || "{}")

    if (!proofFile || !bookingId) {
      return res.status(400).json({
        error: "missing_proof_or_booking"
      })
    }

    const caption =
      [
        "🧾 Nueva transferencia pendiente",
        "",
        `Reserva: ${bookingId}`,
        `Cliente: ${booking.name}`,
        `Teléfono: ${booking.phone}`,
        `Correo: ${booking.email || "-"}`,
        `Fecha: ${booking.date}`,
        `Hora: ${(booking.times || []).join(", ")}`,
        `Simuladores: ${(booking.rigs || []).join(", ")}`,
        `Total: L ${Number(booking.totalHNL || booking.total || 0).toFixed(2)}`,
        "",
        "Confirmar o rechazar desde los botones:"
      ].join("\n")

    const isPdf =
      proofFile.mimetype === "application/pdf"

    const endpoint =
      isPdf
        ? "sendDocument"
        : "sendPhoto"

    const telegramForm =
      new FormData()

    telegramForm.append("chat_id", TELEGRAM_GROUP_CHAT_ID)
    telegramForm.append("caption", caption)

    telegramForm.append(
      "reply_markup",
      JSON.stringify({
        inline_keyboard: [
          [
            {
              text: "✅ Confirmar reserva",
              callback_data: `confirm_booking:${bookingId}`
            },
            {
              text: "❌ Rechazar reserva",
              callback_data: `reject_booking:${bookingId}`
            }
          ]
        ]
      })
    )

    const blob =
      new Blob([
        fs.readFileSync(proofFile.filepath)
      ], {
        type: proofFile.mimetype || "application/octet-stream"
      })

    telegramForm.append(
      isPdf ? "document" : "photo",
      blob,
      proofFile.originalFilename || "comprobante"
    )

    const telegramResponse =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
        {
          method: "POST",
          body: telegramForm
        }
      )

    const telegramData =
      await telegramResponse.json()

    if (!telegramResponse.ok) {
      return res.status(telegramResponse.status).json(telegramData)
    }

    return res.status(200).json({
      ok: true,
      telegram: telegramData
    })
  } catch (error) {
    console.error(error)

    return res.status(500).json({
      error: "telegram_send_failed",
      details: error.message
    })
  }
}