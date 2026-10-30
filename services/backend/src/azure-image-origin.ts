/** Recognize the configured origin and its exact HTTPS MCAS browser alias. */
export function azureImageOriginAllowed(url: URL, base: URL): boolean {
  if (url.username || url.password || base.username || base.password) return false;
  return (
    url.origin === base.origin ||
    (base.protocol === "https:" &&
      url.protocol === "https:" &&
      url.hostname === `${base.hostname}.mcas.ms` &&
      url.port === base.port)
  );
}
