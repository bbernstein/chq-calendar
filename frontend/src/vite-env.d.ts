/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_RECAPTCHA_SITE_KEY: string;
  readonly VITE_ENABLE_PUBLISHER_FEEDS: string;
  readonly VITE_APP_VERSION: string;
  /** 'true' reads published data from frontend/public/data/ instead of the CDN. See src/lib/dataSource.ts. */
  readonly VITE_LOCAL_DATA: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
