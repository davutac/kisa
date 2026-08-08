# Google auth worker

Cloudflare Worker deployed with Alchemy that completes Google OAuth and hands credentials to the desktop app without placing Google tokens in a redirect URL.

## Configure

Create a Google OAuth **Web application** client and set its authorized redirect URI to the exact value of `GOOGLE_REDIRECT_URI`. Copy `.env.example` to `.env` and fill in:

- `GOOGLE_CLIENT_ID`: Google OAuth web client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth web client secret.
- `GOOGLE_REDIRECT_URI`: public worker callback, ending in `/oauth/google/callback`.
- `APP_REDIRECT_URIS`: comma-separated exact allowlist of app callback URIs.

## Run

```sh
pnpm --dir apps/auth-worker dev
pnpm --dir apps/auth-worker deploy
```

Alchemy handles Cloudflare authentication and infrastructure state. The first command may provision Cloudflare resources before starting the local Worker.

## OAuth contract

The app generates a PKCE verifier and S256 challenge, then opens:

```text
GET /oauth/google/start?redirect_uri=kisa%3A%2F%2Foauth%2Fgoogle%2Fcallback&code_challenge=<challenge>&code_challenge_method=S256
```

The worker signs the redirect URI, PKCE challenge, and creation time into Google's `state` parameter. After Google authorization, it validates that state and redirects to the allowlisted app URI with Google's short-lived, one-time authorization `code` and the PKCE challenge as an `attempt` identifier. The identifier lets the app match callbacks when several login flows are open. The app sends that code back with the matching verifier:

```http
POST /oauth/google/exchange
Content-Type: application/json

{"code":"<one-time-code>","codeVerifier":"<pkce-verifier>"}
```

The successful response matches `@repo/gmail`'s authorization handoff:

```json
{
  "accessToken": "...",
  "expiresAt": 1786032000000,
  "refreshToken": "...",
  "scopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send"
  ]
}
```

The signed OAuth state and the app's matching login attempt expire after ten minutes. Google authorization codes are short-lived and can only be exchanged once.
