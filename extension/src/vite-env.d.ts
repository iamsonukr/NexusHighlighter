/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOTEMARK_SYNC_API_URL?: string;
}

declare module '*.css?inline' {
  const content: string;
  export default content;
}
