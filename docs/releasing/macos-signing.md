# macOS Code Signing and Notarization

Kisa's macOS builds are signed with a **Developer ID Application** certificate and notarized by Apple. Both steps are required: an unsigned `.app` is blocked by Gatekeeper, and `electron-updater` refuses to install an update whose bundle is not signed (Squirrel.Mac validates the signature before swapping the app).

Windows and Linux artifacts stay unsigned. `CSC_IDENTITY_AUTO_DISCOVERY` is set per matrix entry in `.github/workflows/release.yml` so only the macOS job looks for an identity.

## One-time setup

### 1. Certificate

Requires an Apple Developer Program membership ($99/yr).

1. In Xcode (Settings → Accounts → Manage Certificates) or on [developer.apple.com](https://developer.apple.com/account/resources/certificates), create a **Developer ID Application** certificate. Do not use "Apple Development" or "Mac App Distribution" — those cannot be notarized for distribution outside the App Store.
2. In Keychain Access, select the certificate _and_ its private key, right-click → Export, and save as `DeveloperID.p12` with a password.
3. Base64-encode it for GitHub:

   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```

Certificates expire after five years; the signature on already-notarized builds stays valid past expiry, but new builds need a fresh certificate.

### 2. App-specific password

At [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords, generate one for notarization. Your Team ID is the 10-character string in the Apple Developer account's Membership Details.

### 3. GitHub secrets

Add these under Settings → Secrets and variables → Actions:

| Secret                        | Value                                   |
| ----------------------------- | --------------------------------------- |
| `APPLE_CSC_LINK`              | base64 of `DeveloperID.p12`             |
| `APPLE_CSC_KEY_PASSWORD`      | password used when exporting the `.p12` |
| `APPLE_ID`                    | Apple ID email                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from step 2       |
| `APPLE_TEAM_ID`               | 10-character Team ID                    |

Until all five exist, the macOS job still succeeds — electron-builder logs `skipped macOS application code signing` and `skipped macOS notarization`, and ships an unsigned build.

An App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) is the alternative to the Apple-ID credentials and is preferred by electron-builder, but the key has to be materialized as a `.p8` file on the runner first. The Apple-ID path needs no extra workflow steps.

## Building signed locally

`pnpm build:mac` picks up the Developer ID certificate from your login keychain automatically. To notarize a local build, export the same variables the workflow uses:

```bash
APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx APPLE_TEAM_ID=XXXXXXXXXX pnpm build:mac
```

Notarization adds a few minutes per build — Apple's service has to accept the upload and return a ticket, which electron-builder then staples to the app.

## Verifying an artifact

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Kisa.app
```

```bash
spctl --assess --type execute --verbose /Applications/Kisa.app
```

The second command should print `accepted` and `source=Notarized Developer ID`. On a `.dmg`, `xcrun stapler validate Kisa-<version>-mac-arm64.dmg` confirms the notarization ticket was stapled.

## Entitlements

`build/entitlements.mac.plist` is applied to the app and inherited by helper processes. The three entitlements it grants (`allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`) are what V8 needs to run under the hardened runtime, which electron-builder enables by default for non-MAS builds and which notarization requires.
