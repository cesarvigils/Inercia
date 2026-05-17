const RANGE = "5. Mayo Canada!A15:Z"

const ICONO_TEAM =
  "https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2FTeam%20Inercia%20Casco%20REV2.png?alt=media&token=18016ad1-2185-48c6-a9e5-500f2a6fb9db"

const leaderboard = document.getElementById("leaderboard")
const categorySelect = document.getElementById("category-select")
const dropdownWrapper = document.querySelector(".standings-dropdown")

const COLUMNAS = {
  nombre: 2, // C
  team: 4,   // E
  genero: 5, // F
  tiempo: 7  // H
}

let currentFilter = categorySelect ? categorySelect.value : "ALL"

function updateDropdownState() {
  if (!dropdownWrapper) return

  if (currentFilter === "TEAM") {
    dropdownWrapper.classList.add("team-selected")
  } else {
    dropdownWrapper.classList.remove("team-selected")
  }
}

if (categorySelect) {
  categorySelect.addEventListener("change", () => {
    currentFilter = categorySelect.value
    updateDropdownState()
    loadStandings()
  })
}

updateDropdownState()

function parseTime(time) {
  if (!time) return Infinity

  const cleanTime = String(time).trim()
  const parts = cleanTime.split(":")

  if (parts.length !== 2) return Infinity

  const minutes = Number(parts[0])
  const seconds = Number(parts[1])

  if (Number.isNaN(minutes) || Number.isNaN(seconds)) {
    return Infinity
  }

  return minutes * 60 + seconds
}

function formatGap(gap) {
  if (!Number.isFinite(gap)) return "-"
  if (gap <= 0) return "LEADER"

  return `+${gap.toFixed(3)}`
}

async function loadStandings() {
  try {
    if (!leaderboard) return

    const response = await fetch("/api/standings")
    const data = await response.json()

    if (!data.values) return

    const drivers = []

    data.values.forEach((driver) => {
      const nombre = driver[COLUMNAS.nombre]
      const tiempo = driver[COLUMNAS.tiempo]

      if (!nombre || !String(nombre).trim()) return
      if (!tiempo || !String(tiempo).trim()) return

      const team = String(driver[COLUMNAS.team] || "")
        .trim()
        .toUpperCase()

      const genero = String(driver[COLUMNAS.genero] || "")
        .trim()
        .toUpperCase()

      const esTeamInercia = team === "TEAM"

      if (currentFilter === "M" && genero !== "M") return
      if (currentFilter === "F" && genero !== "F") return
      if (currentFilter === "TEAM" && !esTeamInercia) return

      const nombreLimpio = String(nombre).trim()

      const nombreFinal = esTeamInercia
        ? `
          <img
            src="${ICONO_TEAM}"
            class="driver-tag-icon"
            alt="Team Inercia">
          ${nombreLimpio}
        `
        : nombreLimpio

      drivers.push({
        nombreFinal,
        tiempo: String(tiempo).trim(),
        parsedTime: parseTime(tiempo)
      })
    })

    drivers.sort((a, b) => a.parsedTime - b.parsedTime)

    const leaderTime = drivers[0]?.parsedTime ?? Infinity
    const fragment = document.createDocumentFragment()

    drivers.forEach((driver, index) => {
      const gap = driver.parsedTime - leaderTime
      const row = document.createElement("div")

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

    leaderboard.replaceChildren(...fragment.children)
  } catch (error) {
    console.error(error)
  }
}

loadStandings()
setInterval(loadStandings, 3600000)