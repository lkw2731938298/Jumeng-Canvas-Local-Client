import { apiFetch } from "./client";
import type { SsoLoginResponse, User } from "@/types/workflow";

export type SmsAuthScene = "user_register" | "user_login" | "password_reset" | "admin_login";

export interface SmsCodeSendResult {
  ok: boolean;
  maskedPhone: string;
  code: string;
  scene: string;
}

export interface AuthConfig {
  registrationEnabled: boolean;
  captchaEnabled: boolean;
  captchaPasswordAfterFailures: number;
}

export interface CaptchaChallenge {
  captchaId: string;
  /** 滑动拼图背景图（含缺口） */
  backgroundImage: string;
  /** 可拖动拼图块 */
  sliderImage: string;
  puzzleY: number;
  imageWidth: number;
  imageHeight: number;
  sliderSize: number;
  /** 背景主题 id（aurora/crystal/neon…） */
  themeId?: string;
  /** 主题点缀色，用于滑轨/手柄 */
  themeAccent?: string;
  expiresIn: number;
  /** 兼容旧字段 */
  imageBase64?: string;
  /** 开发模式：目标水平偏移（像素字符串） */
  answer: string;
}

export interface CaptchaVerifyResult {
  captchaTicket: string;
  expiresIn: number;
}

export interface CaptchaStatus {
  captchaEnabled: boolean;
  requiredForPasswordLogin: boolean;
  failCount: number;
  threshold: number;
}

export function getAuthConfig() {
  return apiFetch<AuthConfig>("/api/v1/auth/config", { skipAuth: true });
}

export function fetchCaptcha() {
  return apiFetch<CaptchaChallenge>("/api/v1/auth/captcha", { skipAuth: true });
}

export function verifyCaptcha(payload: {
  captchaId: string;
  slideX: number;
  phone: string;
  scene: SmsAuthScene | string;
}) {
  return apiFetch<CaptchaVerifyResult>("/api/v1/auth/captcha/verify", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}

export function getCaptchaStatus(phone: string) {
  const q = encodeURIComponent(phone.replace(/\D/g, ""));
  return apiFetch<CaptchaStatus>(`/api/v1/auth/captcha/status?phone=${q}`, {
    skipAuth: true,
  });
}

export function sendAuthCode(phone: string, scene: SmsAuthScene, captchaTicket?: string) {
  return apiFetch<SmsCodeSendResult>("/api/v1/auth/send-code", {
    method: "POST",
    body: JSON.stringify({
      phone,
      scene,
      captchaTicket: captchaTicket || undefined,
    }),
    skipAuth: true,
  });
}

export function register(
  phone: string,
  password: string,
  code: string,
  displayName?: string,
  inviteCode?: string
) {
  return apiFetch<SsoLoginResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      phone,
      password,
      code,
      display_name: displayName,
      inviteCode: inviteCode || undefined,
    }),
    skipAuth: true,
  });
}

export function login(phone: string, password: string, captchaTicket?: string, smsCode?: string) {
  return apiFetch<SsoLoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      phone,
      password,
      captchaTicket: captchaTicket || undefined,
      // 异地登录时携带短信验证码完成二次校验
      smsCode: smsCode || undefined,
    }),
    skipAuth: true,
  });
}

export function loginSms(phone: string, code: string) {
  return apiFetch<SsoLoginResponse>("/api/v1/auth/login-sms", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
    skipAuth: true,
  });
}

export type AdminLoginPayload = {
  phone: string;
  password: string;
  smsCode: string;
};

/** 管理后台登录：手机号 + 密码 + 短信验证码。 */
export function adminLogin(payload: AdminLoginPayload) {
  return apiFetch<SsoLoginResponse>("/api/v1/auth/admin-login", {
    method: "POST",
    body: JSON.stringify({
      phone: payload.phone,
      password: payload.password,
      smsCode: payload.smsCode,
    }),
    skipAuth: true,
  });
}

export function resetPassword(phone: string, code: string, password: string) {
  return apiFetch<SsoLoginResponse>("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ phone, code, password }),
    skipAuth: true,
  });
}

export function getSession() {
  return apiFetch<SsoLoginResponse>("/api/v1/auth/session");
}

export function logout() {
  return apiFetch<{ ok: boolean }>("/api/v1/auth/logout", {
    method: "POST",
  });
}

export function getMe() {
  return apiFetch<User>("/api/v1/auth/me");
}
