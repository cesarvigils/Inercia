const PAYPAL_CLIENT =
  process.env.PAYPAL_CLIENT_ID

const PAYPAL_SECRET =
  process.env.PAYPAL_SECRET

const PAYPAL_API =
  "https://api-m.sandbox.paypal.com"

const FALLBACK_RATE = 26

async function getExchangeRate() {

  try {

    const response =
      await fetch(
        "https://open.er-api.com/v6/latest/USD"
      )

    const data =
      await response.json()

    const rate =
      Number(data?.rates?.HNL)

    if (!rate || Number.isNaN(rate)) {
      return FALLBACK_RATE
    }

    return rate

  } catch {

    return FALLBACK_RATE

  }
}

async function getAccessToken() {

  const auth =
    Buffer
      .from(
        `${PAYPAL_CLIENT}:${PAYPAL_SECRET}`
      )
      .toString("base64")

  const response =
    await fetch(
      `${PAYPAL_API}/v1/oauth2/token`,
      {
        method: "POST",

        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          "grant_type=client_credentials"
      }
    )

  const data =
    await response.json()

  if (!data.access_token) {

    console.error(data)

    throw new Error(
      "No PayPal access token"
    )
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

    console.log("BODY:", body)

    const totalHNL =
      Number(body.total)

    if (
      !totalHNL ||
      Number.isNaN(totalHNL) ||
      totalHNL <= 0
    ) {

      return res.status(400).json({
        error: "invalid_total"
      })
    }

    const rate =
      await getExchangeRate()

    const totalUSD =
      Number(totalHNL / rate)
        .toFixed(2)

    console.log({
      totalHNL,
      rate,
      totalUSD
    })

    const accessToken =
      await getAccessToken()

    const response =
      await fetch(
        `${PAYPAL_API}/v2/checkout/orders`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            "Content-Type":
              "application/json"
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
        }
      )

    const data =
      await response.json()

    console.log(
      "PAYPAL RESPONSE:",
      data
    )

    return res
      .status(response.status)
      .json(data)

  } catch (error) {

    console.error(error)

    return res.status(500).json({
      error:
        "paypal_create_order_failed",

      details:
        error.message
    })
  }
}