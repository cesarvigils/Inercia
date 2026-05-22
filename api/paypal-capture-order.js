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

  const { orderID } =
    req.body || {}

  if (!orderID) {
    return res.status(400).json({ error: "Missing orderID" })
  }

  const accessToken =
    await getAccessToken()

  const response =
    await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    })

  const data =
    await response.json()

  return res.status(200).json(data)
}