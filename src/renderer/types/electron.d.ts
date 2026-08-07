export {};

declare global {
  interface Window {
    electron?: {
      notify: (payload: { title: string; body: string }) => Promise<void>;
    };
  }
}
