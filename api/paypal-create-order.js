import fetch from "node-fetch"

const PAYPAL_CLIENT =
  process.env.PAYPAL_CLIENT_ID

const PAYPAL_SECRET =
  process.env.PAYPAL_SECRET

const PAYPAL_API =
  "https://api-m.paypal.com"

const USD_RATE = 24.7

async function getAccessToken() {

  const auth =
    Buffer
      .from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`)
      .toString("base64")

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

  try {

    const { total } = req.body

    if (!total) {
      return res.status(400).json({
        error: "missing_total"
      })
    }

    const totalUSD =
      (Number(total) / USD_RATE)
        .toFixed(2)

    const accessToken =
      await getAccessToken()

    const response =
      await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              amount: {
                currency_code: "USD",
                value: totalUSD
              }
            }
          ]
        })
      })

    const data =
      await response.json()

    console.log(data)

    if (!data.id) {

      return res.status(400).json({
        error: data
      })
    }

    return res.status(200).json(data)

  } catch (error) {

    console.error(error)

    return res.status(500).json({
      error: "paypal_create_order_failed"
    })
  }
}