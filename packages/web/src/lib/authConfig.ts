import { isLocalDesktop } from "@/lib/localDesktop";

/** 开源本地版强制免登录；其它构建仅在显式关闭开关时才要求登录。 */
export const isAuthRelaxed =
  isLocalDesktop || process.env.NEXT_PUBLIC_ADMIN_AUTH_DISABLED !== "false";
