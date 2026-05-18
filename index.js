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

// KEEP SERVER ALIVE — this is what Render needs
app.listen(process.env.PORT || 3000, () => {
  console.log("Auth backend running")
})

