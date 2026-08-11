const getPageContent = (oauthError: string | undefined) => {
  if (oauthError === undefined) {
    return {
      detail:
        "Google sent you back safely. You can close this tab and continue in Kisa.",
      title: "Return to Kisa",
    };
  }

  if (oauthError === "access_denied") {
    return {
      detail: "Nothing was changed. You can close this tab and return to Kisa.",
      title: "Sign-in canceled",
    };
  }

  return {
    detail:
      "Google could not complete sign-in. You can close this tab and try again in Kisa.",
    title: "Sign-in failed",
  };
};

export const renderGoogleAuthCallbackPage = (oauthError?: string): string => {
  const { detail, title } = getPageContent(oauthError);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${title} · Kisa</title>
    <style>
      :root {
        color-scheme: light dark;
        --background: #f5f5f3;
        --background-glow: rgba(255, 255, 255, 0.92);
        --card: rgba(255, 255, 255, 0.88);
        --card-border: rgba(23, 23, 23, 0.08);
        --foreground: #171717;
        --muted: #737373;
        --shadow: 0 24px 70px rgba(24, 24, 20, 0.1);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        min-height: 100%;
      }

      body {
        align-items: center;
        background:
          radial-gradient(circle at 50% 22%, var(--background-glow), transparent 42%),
          var(--background);
        color: var(--foreground);
        display: flex;
        font-family:
          Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        padding: 32px 20px;
        text-rendering: optimizeLegibility;
      }

      .card {
        animation: arrive 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        backdrop-filter: blur(18px);
        background: var(--card);
        border: 1px solid var(--card-border);
        border-radius: 28px;
        box-shadow: var(--shadow);
        max-width: 430px;
        overflow: hidden;
        padding: 34px;
        width: 100%;
      }

      .brand {
        align-items: center;
        display: flex;
        font-size: 15px;
        font-weight: 650;
        gap: 10px;
        letter-spacing: -0.01em;
      }

      .brand-mark {
        align-items: center;
        background: var(--foreground);
        border-radius: 11px;
        color: var(--background);
        display: flex;
        height: 34px;
        justify-content: center;
        width: 34px;
      }

      .brand-mark svg {
        height: 19px;
        width: 19px;
      }

      .eyebrow {
        color: var(--muted);
        font-size: 13px;
        font-weight: 580;
        letter-spacing: 0.02em;
        margin: 52px 0 8px;
      }

      h1 {
        font-size: clamp(28px, 7vw, 34px);
        font-weight: 680;
        letter-spacing: -0.045em;
        line-height: 1.08;
        margin: 0;
      }

      .detail {
        color: var(--muted);
        font-size: 16px;
        letter-spacing: -0.012em;
        line-height: 1.55;
        margin: 16px 0 0;
        max-width: 34ch;
      }

      .hint {
        align-items: center;
        border-top: 1px solid var(--card-border);
        color: var(--muted);
        display: flex;
        font-size: 13px;
        gap: 8px;
        margin: 34px -34px -34px;
        padding: 18px 34px 20px;
      }

      .hint-dot {
        background: currentColor;
        border-radius: 50%;
        height: 5px;
        opacity: 0.5;
        width: 5px;
      }

      @keyframes arrive {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --background: #111111;
          --background-glow: rgba(52, 52, 49, 0.44);
          --card: rgba(29, 29, 28, 0.9);
          --card-border: rgba(255, 255, 255, 0.09);
          --foreground: #f5f5f4;
          --muted: #a3a3a3;
          --shadow: 0 28px 80px rgba(0, 0, 0, 0.38);
        }
      }

      @media (max-width: 480px) {
        body {
          padding: 18px;
        }

        .card {
          border-radius: 24px;
          padding: 28px;
        }

        .eyebrow {
          margin-top: 44px;
        }

        .hint {
          margin: 30px -28px -28px;
          padding: 17px 28px 19px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .card {
          animation: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="card" aria-labelledby="page-title">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 7.5 12 13l8-5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M5.75 5h12.5A1.75 1.75 0 0 1 20 6.75v10.5A1.75 1.75 0 0 1 18.25 19H5.75A1.75 1.75 0 0 1 4 17.25V6.75A1.75 1.75 0 0 1 5.75 5Z" stroke="currentColor" stroke-width="1.8" />
          </svg>
        </span>
        <span>Kisa</span>
      </div>

      <p class="eyebrow">Google sign-in</p>
      <h1 id="page-title">${title}</h1>
      <p class="detail">${detail}</p>

      <div class="hint">
        <span class="hint-dot" aria-hidden="true"></span>
        This tab is no longer needed
      </div>
    </main>
  </body>
</html>`;
};
