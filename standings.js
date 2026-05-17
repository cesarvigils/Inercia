const RANGE =
  "5. Mayo Canada!A15:Z"

const ICONO_TEAM =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia%20Casco%20REV2.png?alt=media&token=18016ad1-2185-48c6-a9e5-500f2a6fb9db"

let leaderboard =
  document.getElementById("leaderboard")

const categorySelect =
  document.getElementById("category-select")

const dropdownWrapper =
  document.querySelector(
    ".standings-dropdown"
  )

let currentFilter =
  categorySelect.value

const COLUMNAS = {

  nombre: 2, // C
  team: 4,   // E
  genero: 5, // F
  tiempo: 7  // H

}

categorySelect.onchange = () => {

  currentFilter =
    categorySelect.value

  if (currentFilter === "TEAM") {

    dropdownWrapper.classList.add(
      "team-selected"
    )

  } else {

    dropdownWrapper.classList.remove(
      "team-selected"
    )

  }

  loadStandings()

}

if (currentFilter === "TEAM") {

  dropdownWrapper.classList.add(
    "team-selected"
  )

}

function parseTime(time) {

  if (!time)
    return Infinity

  const parts =
    time.split(":")

  if (parts.length < 2)
    return Infinity

  const minutes =
    parseInt(parts[0])

  const seconds =
    parseFloat(parts[1])

  return (minutes * 60) + seconds

}

function formatGap(gap) {

  if (gap <= 0) {
    return "LEADER"
  }

  return `+${gap.toFixed(3)}`

}

async function loadStandings() {

  try {

    const url =
      "/api/standings"

    const response =
      await fetch(url)

    const data =
      await response.json()

    if (!data.values) return

    let drivers = []

    data.values.forEach((driver) => {

      const nombre =
        driver[COLUMNAS.nombre]

      const team =
        (driver[COLUMNAS.team] || "")
        .trim()
        .toUpperCase()

      const genero =
        (driver[COLUMNAS.genero] || "")
        .trim()
        .toUpperCase()

      const tiempo =
        driver[COLUMNAS.tiempo]

      if (!nombre || nombre.trim() === "") {
        return
      }

      if (!tiempo || tiempo.trim() === "") {
        return
      }

      const esTeamInercia =
        team === "TEAM"

      // FILTROS

      if (
        currentFilter === "ALL"
      ) {

        // mostrar todos

      }

      else if (
        currentFilter === "M"
      ) {

        if (genero !== "M") {
          return
        }

      }

      else if (
        currentFilter === "F"
      ) {

        if (genero !== "F") {
          return
        }

      }

      else if (
        currentFilter === "TEAM"
      ) {

        if (!esTeamInercia) {
          return
        }

      }

      let nombreFinal =
        nombre

      if (esTeamInercia) {

        nombreFinal = `

          <img
            src="${ICONO_TEAM}"
            class="driver-tag-icon">

          ${nombre}

        `

      }

      drivers.push({

        nombreFinal,
        tiempo,

        parsedTime:
          parseTime(tiempo)

      })

    })

    drivers.sort((a, b) =>
      a.parsedTime - b.parsedTime
    )

    const leaderTime =
      drivers[0]?.parsedTime || 0

    const fragment =
      document.createDocumentFragment()

    drivers.forEach((driver, index) => {

      const gap =
        driver.parsedTime - leaderTime

      const row =
        document.createElement("div")

      row.classList.add(
        "driver-row"
      )

      if (index === 0) {

        row.classList.add(
          "top-driver"
        )

      }

      row.innerHTML = `

        <div class="position">
          #${index + 1}
        </div>

        <div class="driver-info">

          <h3>
            ${driver.nombreFinal}
          </h3>

        </div>

        <div class="lap-time">
          ${driver.tiempo}
        </div>

        <div class="gap">
          ${formatGap(gap)}
        </div>

      `

      fragment.appendChild(row)

    })

    leaderboard.replaceChildren(
      ...fragment.children
    )

  }

  catch (error) {

    console.error(error)

  }

}

loadStandings()

setInterval(
  loadStandings,
  3000
)