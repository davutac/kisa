/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
  readonly MAIN_VITE_GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
