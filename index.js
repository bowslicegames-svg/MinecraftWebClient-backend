import express from "express"
import fetch from "node-fetch"
import cors from "cors"

const app = express()
app.use(cors())
app.use(express.json())

// Environment variables from Render
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REDIRECT_URI = process.env.REDIRECT_URI

// Step 1: Redirect user to Microsoft login
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

// Step 2: Microsoft redirects back here with ?code=
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
    res.json(tokenJson)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Auth failed" })
  }
})

// Step 3: Exchange Microsoft access token for Xbox Live token
app.post("/auth/xbl", async (req, res) => {
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

// Step 4: Exchange Xbox Live token for XSTS token
app.post("/auth/xsts", async (req, res) => {
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

// Keep server alive on Render
app.listen(process.env.PORT || 3000, () => {
  console.log("Auth backend running")
})
