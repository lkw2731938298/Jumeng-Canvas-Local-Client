/**
 * 开源本地版：本包恒为本地单用户模式（无登录 / 无后台 / 无算力云端）。
 * 不再依赖环境变量开关，避免漏设导致商业页可达。
 */
export const isLocalDesktop = true;

export const LOCAL_USER = {
  id: "local-user",
  phone: "00000000000",
  displayName: "本地用户",
} as const;
