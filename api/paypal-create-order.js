const PAYPAL_API =
  process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com"

async function getAccessToken() {
  const auth =
    Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString("base64")

  const response =
    await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    })

  const data =
    await response.json()

  return data.access_token
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  const { total } =
    req.body || {}

  if (!total || Number(total) <= 0) {
    return res.status(400).json({ error: "Invalid total" })
  }

  const accessToken =
    await getAccessToken()

  const response =
    await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "HNL",
              value: Number(total).toFixed(2)
            }
          }
        ]
      })
    })

  const data =
    await response.json()

  return res.status(200).json(data)
}