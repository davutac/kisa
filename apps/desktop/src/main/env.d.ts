// Build-time settings electron-vite writes into the main process's bundle:
// variables prefixed `MAIN_VITE_` from `apps/desktop/.env*` files or the
// shell. See `apps/desktop/.env.example`.

interface ImportMetaEnv {
  /** Kisa's Microsoft Entra Application (client) ID, for Microsoft sign-in. */
  readonly MAIN_VITE_MICROSOFT_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
