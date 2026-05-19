import express from "express"
import fetch from "node-fetch"
import cors from "cors"
import rateLimit from "express-rate-limit"

const app = express()

// -------------------------------
// 1. STRICT CORS (ONLY YOUR DOMAIN)
// -------------------------------
const allowedOrigins = [
  "https://bowslicegames-svg.github.io",
  "https://bowslicegames-svg.github.io/MinecraftWebClient"
]

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(new Error("Blocked: No origin"))
    if (allowedOrigins.includes(origin)) return cb(null, true)
    return cb(new Error("Blocked by CORS"))
  }
}))

// -------------------------------
// 2. ORIGIN + REFERER ENFORCEMENT
// -------------------------------
function enforceFrontend(req, res, next) {
  const origin = req.headers.origin || ""
  const referer = req.headers.referer || ""

  const allowed =
    origin.startsWith("https://bowslicegames-svg.github.io") ||
    referer.startsWith("https://bowslicegames-svg.github.io")

  if (!allowed) {
    return res.status(403).json({ error: "Forbidden: Invalid origin" })
  }

  next()
}

app.use(express.json())

// -------------------------------
// 3. RATE LIMITING (PREVENT ABUSE)
// -------------------------------
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
})

app.use("/auth", authLimiter)

// -------------------------------
// ENVIRONMENT VARIABLES
// -------------------------------
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REDIRECT_URI = process.env.REDIRECT_URI

const FRONTEND_RETURN = "https://bowslicegames-svg.github.io/MinecraftWebClient/"

// -------------------------------
// STEP 1: MICROSOFT LOGIN REDIRECT
// -------------------------------
app.get("/auth/login", enforceFrontend, (req, res) => {
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

// -------------------------------
// STEP 2: MICROSOFT CALLBACK
// -------------------------------
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
        `${FRONTEND_RETURN}?error=${encodeURIComponent(tokenJson.error_description)}`
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

// -------------------------------
// STEP 3: XBOX LIVE AUTH
// -------------------------------
app.post("/auth/xbl", enforceFrontend, async (req, res) => {
  const { access_token } = req.body
  if (!access_token) return res.status(400).json({ error: "Missing access_token" })

  try {
    const xblRes = await fetch("https://user.auth.xboxlive.com/user/authenticate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
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
    })

    const xblJson = await xblRes.json()
    res.json(xblJson)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Xbox Live auth failed" })
  }
})

// -------------------------------
// STEP 4: XSTS AUTH
// -------------------------------
app.post("/auth/xsts", enforceFrontend, async (req, res) => {
  const { xbl_token, uhs } = req.body

  if (!xbl_token || !uhs) {
    return res.status(400).json({ error: "Missing xbl_token or uhs" })
  }

  try {
    const xstsRes = await fetch("https://xsts.auth.xboxlive.com/xsts/authorize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        Properties: {
          SandboxId: "RETAIL",
          UserTokens: [xbl_token]
        },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT"
      })
    })

    const xstsJson = await xstsRes.json()
    res.json(xstsJson)

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "XSTS auth failed" })
  }
})

// -------------------------------
// STEP 5: MINECRAFT SERVICES AUTH
// -------------------------------
app.post("/auth/mc", enforceFrontend, async (req, res) => {
  const { xsts_token, uhs } = req.body

  if (!xsts_token || !uhs) {
    return res.status(400).json({ error: "Missing xsts_token or uhs" })
  }

  try {
    const mcRes = await fetch("https://api.minecraftservices.com/authentication/login_with_xbox", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        identityToken: `XBL3.0 x=${uhs};${xsts_token}`
      })
    })

    const mcJson = await mcRes.json()

    if (!mcJson.access_token) {
      return res.status(400).json({ error: "Minecraft auth failed", details: mcJson })
    }

    const profileRes = await fetch("https://api.minecraftservices.com/minecraft/profile", {
      headers: {
        "Authorization": `Bearer ${mcJson.access_token}`
      }
    })

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

// -------------------------------
// SERVER START
// -------------------------------
app.listen(process.env.PORT || 3000, () => {
  console.log("Auth backend running (locked down)")
})
