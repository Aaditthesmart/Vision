/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electron?: {
    toggleOverlay: () => void;
    setClickThrough: (enabled: boolean) => void;
  };
}
