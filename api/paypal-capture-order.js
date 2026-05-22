const PAYPAL_CLIENT =
  process.env.PAYPAL_CLIENT_ID

const PAYPAL_SECRET =
  process.env.PAYPAL_SECRET

const PAYPAL_API =
  "https://api-m.paypal.com"

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
          Authorization:
            `Basic ${auth}`,

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

    const { orderID } =
      req.body

    const accessToken =
      await getAccessToken()

    const response =
      await fetch(
        `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${accessToken}`
          }
        }
      )

    const data =
      await response.json()

    return res
      .status(response.status)
      .json(data)

  } catch (error) {

    console.error(error)

    return res.status(500).json({
      error:
        "paypal_capture_failed",

      details:
        error.message
    })
  }
}