const PAYPAL_CLIENT =
  process.env.PAYPAL_CLIENT_ID

const PAYPAL_SECRET =
  process.env.PAYPAL_SECRET

const PAYPAL_API =
  "https://api-m.sandbox.paypal.com"

async function getAccessToken() {

  const auth =
    Buffer
      .from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`)
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

    const total =
      body.total

    if (!total) {
      return res.status(400).json({
        error: "missing_total"
      })
    }

    const accessToken =
      await getAccessToken()

    const response =
      await fetch(
        `${PAYPAL_API}/v2/checkout/orders`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${accessToken}`
          },

          body: JSON.stringify({
            intent: "CAPTURE",

            purchase_units: [
              {
                amount: {
                  currency_code: "USD",
                  value:
                    Number(total).toFixed(2)
                }
              }
            ]
          })
        }
      )

    const data =
      await response.json()

    console.log(data)

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