/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the backend, e.g. https://debol-api.onrender.com. Left unset the app talks
   *  to its own host, which is what the Vite dev proxy and a same-origin deployment rely on. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
