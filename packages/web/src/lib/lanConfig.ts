/** Fixed LAN base URL from config/lan.env (via next.config env). */
export function getPublicLanBaseUrl(): string {
  const host = process.env.NEXT_PUBLIC_LAN_HOST || "192.168.1.100";
  const port = process.env.NEXT_PUBLIC_LAN_PORT || "3000";
  return `http://${host}:${port}`;
}

export function getPublicLanProjectsUrl(): string {
  return `${getPublicLanBaseUrl()}/projects`;
}
