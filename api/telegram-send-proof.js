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
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "method_not_allowed"
    })
  }

  try {
    const form =
      formidable({
        multiples: false,
        keepExtensions: true
      })

    const [fields, files] =
      await form.parse(req)

    const proofFile =
      getFile(files, "proof")

    const bookingId =
      pick(fields?.bookingId)

    const bookingRaw =
      pick(fields?.booking)

    const booking =
      JSON.parse(bookingRaw || "{}")

    if (!proofFile || !bookingId) {
      return res.status(400).json({
        error: "missing_proof_or_booking",
        fields,
        filesKeys: files ? Object.keys(files) : []
      })
    }

    const filePath =
      proofFile.filepath

    const mimetype =
      proofFile.mimetype || "application/octet-stream"

    const isPdf =
      mimetype === "application/pdf"

    const caption =
      [
        "🧾 Nueva transferencia pendiente",
        "",
        `Reserva: ${bookingId}`,
        `Cliente: ${booking.name || "-"}`,
        `Teléfono: ${booking.phone || "-"}`,
        `Correo: ${booking.email || "-"}`,
        `Fecha: ${booking.date || "-"}`,
        `Hora: ${(booking.times || []).join(", ")}`,
        `Simuladores: ${(booking.rigs || []).join(", ")}`,
        `Total: L ${Number(booking.totalHNL || booking.total || 0).toFixed(2)}`,
        "",
        "Confirmar o rechazar desde los botones:"
      ].join("\n")

    const telegramForm =
      new FormData()

    telegramForm.append(
      "chat_id",
      TELEGRAM_GROUP_CHAT_ID
    )

    telegramForm.append(
      "caption",
      caption
    )

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

    const buffer =
      fs.readFileSync(filePath)

    const blob =
      new Blob([buffer], {
        type: mimetype
      })

    telegramForm.append(
      isPdf ? "document" : "photo",
      blob,
      proofFile.originalFilename || "comprobante"
    )

    const endpoint =
      isPdf ? "sendDocument" : "sendPhoto"

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
      return res
        .status(telegramResponse.status)
        .json(telegramData)
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