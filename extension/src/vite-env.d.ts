/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTEMARK_SYNC_API_URL?: string;
  readonly VITE_CODERSNEXUS_LOGIN_URL?: string;
  readonly VITE_EXTENSION_AUTH_TOKEN_URL?: string;
}

declare module '*.css?inline' {
  const content: string;
  export default content;
}
