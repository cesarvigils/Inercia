const PAYPAL_CLIENT =
  process.env.PAYPAL_CLIENT_ID

const PAYPAL_SECRET =
  process.env.PAYPAL_SECRET

const PAYPAL_API =
  "https://api-m.sandbox.paypal.com"

const FALLBACK_HNL_PER_USD =
  26

async function getExchangeRate() {
  try {
    const response =
      await fetch(
        "https://api.frankfurter.dev/v2/rates?base=USD&quotes=HNL"
      )

    const data =
      await response.json()

    const rate =
      Number(data.rates?.HNL)

    if (!rate || rate <= 0) {
      return FALLBACK_HNL_PER_USD
    }

    return rate
  } catch {
    return FALLBACK_HNL_PER_USD
  }
}

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

  if (!data.access_token) {
    throw new Error(JSON.stringify(data))
  }

  return data.access_token
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

    const totalHNL =
      Number(body.total)

    if (!totalHNL || totalHNL <= 0) {
      return res.status(400).json({
        error: "missing_or_invalid_total"
      })
    }

    const rate =
      await getExchangeRate()

    const totalUSD =
      (totalHNL / rate).toFixed(2)

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
              description:
                `Reserva Inercia - L ${totalHNL.toFixed(2)} @ ${rate.toFixed(4)}`,

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

    return res
      .status(response.status)
      .json({
        ...data,
        totalHNL,
        totalUSD,
        exchangeRate: rate
      })
  } catch (error) {
    return res.status(500).json({
      error: "paypal_create_order_failed",
      details: error.message
    })
  }
}