import nodemailer from "nodemailer"

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" })
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {}

    const {
      email,
      name,
      bookingId,
      date,
      times,
      rigs,
      totalHNL,
      paymentMethod,
      status
    } = body

    if (!email || !bookingId) {
      return res.status(400).json({ error: "missing_email_or_booking_id" })
    }
const transporter =
  nodemailer.createTransport({
    host: "mail.privateemail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  })

    const html = `
      <div style="margin:0;padding:0;background:#050505;font-family:Arial,sans-serif;color:#fff;">
        <div style="max-width:620px;margin:0 auto;padding:32px;">
          <div style="background:#111;border:1px solid #242424;border-radius:22px;padding:28px;">
            
            <h1 style="margin:0 0 10px;font-size:28px;color:#ff8c1a;">
              Reserva Inercia
            </h1>

            <p style="color:#ccc;font-size:16px;">
              Hola <strong>${name || "Piloto"}</strong>, tu reserva fue registrada.
            </p>

            <div style="margin:24px 0;padding:18px;background:#191919;border-radius:16px;">
              <p style="margin:8px 0;"><strong>Fecha:</strong> ${date}</p>
              <p style="margin:8px 0;"><strong>Hora:</strong> ${(times || []).join(", ")}</p>
              <p style="margin:8px 0;"><strong>Simuladores:</strong> ${(rigs || []).join(", ")}</p>
              <p style="margin:8px 0;"><strong>Total:</strong> L ${Number(totalHNL || 0).toFixed(2)}</p>
              <p style="margin:8px 0;"><strong>Pago:</strong> ${paymentMethod}</p>
              <p style="margin:8px 0;"><strong>Estado:</strong> ${status}</p>
            </div>

            <p style="color:#aaa;font-size:14px;">
              Presentá este código al llegar al local.
            </p>

            <div style="margin-top:22px;padding-top:18px;border-top:1px solid #252525;color:#777;font-size:12px;">
              Simuladores Inercia
            </div>

          </div>
        </div>
      </div>
    `

    await transporter.sendMail({
      from: `"Simuladores Inercia" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `Reserva Inercia #${bookingId}`,
      html
    })

    return res.status(200).json({ ok: true })
  } catch (error) {
    return res.status(500).json({
      error: "email_send_failed",
      details: error.message
    })
  }
}