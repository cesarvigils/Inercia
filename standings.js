
const RANGE = "5. Mayo Canada!A15:Z"
const ICONO_T =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia%20Casco%20REV2.png?alt=media&token=18016ad1-2185-48c6-a9e5-500f2a6fb9db"
const ICONO_S =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia%20Casco%20REV2.png?alt=media&token=18016ad1-2185-48c6-a9e5-500f2a6fb9db"
const leaderboard =
  document.getElementById("leaderboard")

const COLUMNAS = {

  nombre: 2, // C
    genero: 5, // F

  horas: 6,  // G
  tiempo: 7  // H

}

async function loadStandings() {

  try {

const url = "/api/standings"
    const response =
      await fetch(url)

    const data =
      await response.json()

    if (!data.values) return

    leaderboard.innerHTML = ""

    data.values.forEach((driver, index) => {

      const nombre =
        driver[COLUMNAS.nombre]

      const horas =
        driver[COLUMNAS.horas]

      const tiempo =
        driver[COLUMNAS.tiempo]

      if (!nombre || nombre.trim() === "") {
        return
      }

      let nombreFinal = nombre

      if (nombreFinal.includes("(T)")) {

        nombreFinal =
          nombreFinal.replace(
            "(T)",
            `<img src="${ICONO_T}" class="driver-tag-icon">`
          )
      }

      if (nombreFinal.includes("(S)")) {

        nombreFinal =
          nombreFinal.replace(
            "(S)",
            `<img src="${ICONO_S}" class="driver-tag-icon">`
          )
      }

      const row =
        document.createElement("div")

      row.classList.add("driver-row")

      if (index === 0) {
        row.classList.add("top-driver")
      }

      row.innerHTML = `

        <div class="position">
          #${index + 1}
        </div>

        <div class="driver-info">

          <h3>
            ${nombreFinal}
          </h3>

        </div>

        <div class="lap-time">
          ${horas || "-"}
        </div>

        <div class="gap">
          ${tiempo || "-"}
        </div>

      `

      leaderboard.appendChild(row)

    })

  } catch (error) {

    console.error(error)

  }

}

loadStandings()
setInterval(loadStandings, 4000)