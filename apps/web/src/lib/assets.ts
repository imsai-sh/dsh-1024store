// Resolves public/ assets against the configured Vite base so sub-path deployments work.
export function publicAsset(name: string): string {
  return import.meta.env.BASE_URL + name
}
