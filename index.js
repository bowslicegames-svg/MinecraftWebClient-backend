import express from "express"
import fetch from "node-fetch"
import cors from "cors"

const app = express()
app.use(express.json())

// -----------------------------
// CONFIG
// -----------------------------
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REDIRECT_URI = "https://minecraftwebclient-backend.onrender.com/auth/callback"

const FRONTEND = "https://bowslicegames-svg.github.io"

// -----------------------------
// CORS — allow ONLY your GitHub Pages
// -----------------------------
app.use((req, res, next) => {
  const origin = req.headers.origin

  if (!origin) return next()

  if (origin === FRONTEND) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    return next()
  }

  return res.status(403).json({ error: "Forbidden: Invalid origin" })
})

// -----------------------------
// Microsoft Login Redirect
// -----------------------------
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

// -----------------------------
// Microsoft OAuth Callback
// -----------------------------
app.get("/auth/callback", async (req, res) => {
  const code = req.query.code

  if (!code) {
    return res.redirect(
      FRONTEND + "/MinecraftWebClient/?error=missing_code"
    )
  }

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

    if (!tokenJson.access_token) {
      return res.redirect(
        FRONTEND +
          "/MinecraftWebClient/?error=" +
          encodeURIComponent(JSON.stringify(tokenJson))
      )
    }

    const encoded = encodeURIComponent(JSON.stringify(tokenJson))

    return res.redirect(
      FRONTEND + "/MinecraftWebClient/?ms_token=" + encoded
    )
  } catch (err) {
    console.error(err)
    return res.redirect(
      FRONTEND + "/MinecraftWebClient/?error=callback_failure"
    )
  }
})

// -----------------------------
// Xbox Live Authentication
// -----------------------------
app.post("/auth/xbl", async (req, res) => {
  const { access_token } = req.body

  try {
    const xblRes = await fetch(
      "https://user.auth.xboxlive.com/user/authenticate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RelyingParty: "http://auth.xboxlive.com",
          TokenType: "JWT",
          Properties: {
            AuthMethod: "RPS",
            SiteName: "user.auth.xboxlive.com",
            RpsTicket: `d=${access_token}`
          }
        })
      }
    )

    const xblJson = await xblRes.json()
    res.json(xblJson)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "XBL auth failed" })
  }
})

// -----------------------------
// XSTS Authorization
// -----------------------------
app.post("/auth/xsts", async (req, res) => {
  const { xbl_token, uhs } = req.body

  try {
    const xstsRes = await fetch(
      "https://xsts.auth.xboxlive.com/xsts/authorize",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          RelyingParty: "rp://api.minecraftservices.com/",
          TokenType: "JWT",
          Properties: {
            SandboxId: "RETAIL",
            UserTokens: [xbl_token]
          }
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

// -----------------------------
// Minecraft Authentication
// -----------------------------
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
      return res.status(400).json({
        error: "Minecraft auth failed",
        details: mcJson
      })
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

// -----------------------------
app.listen(3000, () => console.log("Backend running"))
