import express from "express"
import fetch from "node-fetch"
import cors from "cors"

const app = express()

// ✅ CORS: allow your GitHub Pages + local dev
const allowedOrigins = [
  "https://bowslicegames-svg.github.io",
  "http://localhost:5173",
  "http://localhost:4173"
]

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin)
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type")
  }
  if (req.method === "OPTIONS") return res.sendStatus(200)
  next()
})

app.use(express.json())

// 🔐 Environment variables from Render
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REDIRECT_URI = process.env.REDIRECT_URI

// 🌐 Where the user should be sent after login
const FRONTEND_RETURN = "https://bowslicegames-svg.github.io/MinecraftWebClient/"

// STEP 1: Redirect user to Microsoft login
app.get("/auth/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "XboxLive.signin offline_access"
  })

  res.redirect(
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?" +
      params.toString()
  )
})

// STEP 2: Microsoft redirects back here with ?code=
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code
  if (!code) return res.status(400).send("Missing code")

  try {
    const tokenRes = await fetch(
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI
        })
      }
    )

    const tokenJson = await tokenRes.json()

    if (tokenJson.error) {
      return res.redirect(
        `${FRONTEND_RETURN}?error=${encodeURIComponent(
          tokenJson.error_description || tokenJson.error
        )}`
      )
    }

    const redirectUrl =
      `${FRONTEND_RETURN}?ms_token=` +
      encodeURIComponent(JSON.stringify(tokenJson))

    return res.redirect(redirectUrl)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Auth failed" })
  }
})

// STEP 3: Exchange Microsoft access token for Xbox Live token
app.post("/auth/xbl", async (req, res) => {
  const { access_token } = req.body
  if (!access_token)
    return res.status(400).json({ error: "Missing access_token" })

  try {
    const xblRes = await fetch(
      "https://user.auth.xboxlive.com/user/authenticate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          Properties: {
            AuthMethod: "RPS",
            SiteName: "user.auth.xboxlive.com",
            RpsTicket: `d=${access_token}`
          },
          RelyingParty: "http://auth.xboxlive.com",
          TokenType: "JWT"
        })
      }
    )

    const xblJson = await xblRes.json()
    res.json(xblJson)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Xbox Live auth failed" })
  }
})

// STEP 4: Exchange Xbox Live token for XSTS token
app.post("/auth/xsts", async (req, res) => {
  const { xbl_token, uhs } = req.body

  if (!xbl_token || !uhs) {
    return res.status(400).json({ error: "Missing xbl_token or uhs" })
  }

  try {
    const xstsRes = await fetch(
      "https://xsts.auth.xboxlive.com/xsts/authorize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          Properties: {
            SandboxId: "RETAIL",
            UserTokens: [xbl_token]
          },
          RelyingParty: "rp://api.minecraftservices.com/",
          TokenType: "JWT"
        })
      }
    )

    const xstsJson = await xstsRes.json()
    res.json(xstsJson)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "XSTS auth failed" })
  }
})

// STEP 5: Exchange XSTS token for Minecraft Services token
app.post("/auth/mc", async (req, res) => {
  const { xsts_token, uhs } = req.body

  if (!xsts_token || !uhs) {
    return res.status(400).json({ error: "Missing xsts_token or uhs" })
  }

  const identityToken = `XBL3.0 x=${uhs};${xsts_token}`
  console.log("identityToken:", identityToken)

  try {
    const mcRes = await fetch(
      "https://api.minecraftservices.com/authentication/login_with_xbox",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ identityToken })
      }
    )

    const mcJson = await mcRes.json()

    if (!mcJson.access_token) {
      return res
        .status(400)
        .json({ error: "Minecraft auth failed", details: mcJson })
    }

    const profileRes = await fetch(
      "https://api.minecraftservices.com/minecraft/profile",
      {
        headers: {
          Authorization: `Bearer ${mcJson.access_token}`
        }
      }
    )

    const profileJson = await profileRes.json()

    res.json({
      mc_access_token: mcJson.access_token,
      profile: profileJson
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Minecraft Services auth failed" })
  }
})

// =========================
//  VM + INPUT CONTROL API
// =========================

// Your VM's public IP (for now this is YOUR Oracle VM)
const VM_IP = process.env.VM_IP
const VM_INPUT_URL = `http://${VM_IP}:47990/input` // example agent endpoint

async function sendToVm(path, payload) {
  if (!VM_IP) {
    console.error("VM_IP not set")
    return
  }
  try {
    await fetch(`${VM_INPUT_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    console.error("VM input error:", err)
  }
}

// --- Movement ---
app.post("/move", async (req, res) => {
  const { x, y } = req.body || {}
  await sendToVm("move", { x: x || 0, y: y || 0 })
  res.sendStatus(200)
})

// --- Look ---
app.post("/look", async (req, res) => {
  const { dx, dy } = req.body || {}
  await sendToVm("look", { dx: dx || 0, dy: dy || 0 })
  res.sendStatus(200)
})

// --- Key press ---
app.post("/key", async (req, res) => {
  const { key } = req.body || {}
  if (key) await sendToVm("key", { key })
  res.sendStatus(200)
})

// --- Text input ---
app.post("/text", async (req, res) => {
  const { text } = req.body || {}
  if (text) await sendToVm("text", { text })
  res.sendStatus(200)
})

// --- VM control (Phase 2 stub) ---
app.post("/vm/start", async (req, res) => {
  res.json({ status: "stub", message: "VM start not implemented yet" })
})

app.get("/vm/status", async (req, res) => {
  res.json({ status: "stub", message: "VM status not implemented yet" })
})

// =========================
//  ORACLE CONFIG (stub)
// =========================

// In-memory demo store (per-process). Replace with DB later.
let oracleConfigEncrypted = null

app.post("/oracle/config", (req, res) => {
  const { config } = req.body || {}
  if (!config) return res.status(400).json({ error: "Missing config" })

  // For now, just store raw. Later: encrypt + per-user.
  oracleConfigEncrypted = config
  console.log("Received OCI config (length):", config.length)

  res.json({ ok: true })
})

app.get("/oracle/config/status", (req, res) => {
  res.json({ saved: !!oracleConfigEncrypted })
})

// Keep server alive on Render
app.listen(process.env.PORT || 3000, () => {
  console.log("Auth backend running")
})
