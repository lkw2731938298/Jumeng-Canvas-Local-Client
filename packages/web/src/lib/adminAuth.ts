/** 开源本地版默认关闭管理鉴权；勿依赖云端后台。 */
export const isAdminAuthDisabled =
  process.env.NEXT_PUBLIC_ADMIN_AUTH_DISABLED !== "false";
