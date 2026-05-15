export default async function handler(req, res) {

  const SHEET_ID = process.env.SHEET_ID
  const API_KEY = process.env.GOOGLE_API_KEY
  const RANGE = "5. Mayo Canada!A15:Z"

  try {

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`
    )

    const data = await response.json()

    res.status(200).json(data)

  } catch (error) {

    res.status(500).json({
      error: error.message
    })

  }

}