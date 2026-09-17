/**
 * 错误编码 → 中文说明（前端展示用；开源本地版多数码不会走到）。
 */
export const ERROR_CODE_MAP: Record<string, string> = {
  UNAUTHORIZED: "未登录或登录已失效，请重新登录",
  FORBIDDEN: "无权访问该资源",
  ADMIN_REQUIRED: "需要管理员权限",
  ADMIN_PERMISSION_DENIED: "当前账号缺少该后台功能权限",
  SUPER_ADMIN_PROTECTED: "不能修改超级管理员的角色、状态或权限",
  REGISTRATION_DISABLED: "当前已关闭注册",
  USER_NOT_REGISTERED: "该手机号尚未注册，请先注册",
  PHONE_ALREADY_REGISTERED: "该手机号已注册，请直接登录",
  PHONE_NOT_REGISTERED: "该手机号尚未注册",
  INVALID_PHONE: "请输入有效的 11 位手机号",
  INVALID_PASSWORD: "手机号或密码错误",
  LOGIN_LOCKED: "密码错误次数过多，请稍后再试",
  WEAK_PASSWORD: "密码至少 8 位，且必须包含字母、数字和特殊字符",
  PASSWORD_TOO_SHORT: "密码至少 6 位",
  SMS_CODE_REQUIRED: "请先获取并填写短信验证码",
  INVALID_SMS_SCENE: "无效的验证码场景",
  PHONE_LOCKED: "请求过于频繁，请稍后再试",
  SMS_COOLDOWN: "验证码发送过于频繁，请稍后再试",
  IP_RATE_LIMITED: "请求过于频繁，请稍后再试",
  INVALID_CODE: "验证码错误",
  CODE_EXPIRED: "验证码已过期",
  SMS_LOCKED: "验证码错误次数过多，请稍后再试",
  INVALID_PROJECT_ID: "项目 ID 无效",
  PROJECT_NOT_FOUND: "项目不存在或无权访问",
  PROJECT_CREATE_COOLDOWN: "新建过快，请稍后再试",
  PROJECT_CREATE_DAILY_LIMIT: "今日新建项目已达上限",
  WORKFLOW_NOT_FOUND: "工作流不存在",
  REVISION_CONFLICT: "工作流已被其他会话更新，请刷新后重试",
  STORAGE_WRITE_FAILED: "工作流或媒体存储失败",
  PRICING_CHANGED: "价格已更新，请确认后重试",
  INSUFFICIENT_CREDITS: "算力不足，请充值后再试",
  CREDIT_RESERVE_FAILED: "算力预扣失败，请稍后重试",
  ACTIVITY_CLAIM_LIMIT: "已领取过",
  CLAIM_IN_PROGRESS: "领取处理中",
  ACTIVITY_CONFIG_ERROR: "活动配置错误：缺少模型",
  ACTIVITY_NOT_ELIGIBLE: "未满足活动领取条件",
  ACTIVITY_NOT_CLAIMABLE: "活动当前不可领取",
  ACTIVITY_INVALID_CLAIM_RULES: "活动领取条件配置无效",
  RATE_LIMITED: "生成请求过于频繁，请稍后再试",
  MODEL_UNAVAILABLE: "所选模型不可用",
  CONTENT_REQUIRED: "请填写生成内容",
  PROMPT_SENSITIVE_BLOCKED: "提示词包含违规内容，请修改后重试",
  SENSITIVE_WORD_EXISTS: "该敏感词已存在",
  SENSITIVE_WORD_NOT_FOUND: "敏感词不存在",
  GENERATION_FAILED: "生成任务失败",
  ACCESS_DENIED: "无权访问该文件",
  OBJECT_NOT_FOUND: "文件不存在",
  UPSTREAM_ERROR: "上游 AI 服务异常",
  UPSTREAM_HTTP_ERROR: "上游服务 HTTP 请求失败",
  NOT_CONFIGURED: "上游 API 密钥未配置",
  SUBMIT_ERROR: "上游任务提交失败",
  POLL_ERROR: "上游任务状态查询失败",
  TASK_FAILED: "上游生成任务失败",
  TIMEOUT: "上游生成任务超时",
  EMPTY_OUTPUT: "任务完成但未返回有效结果",
  MISSING_TASK_ID: "上游未返回任务 ID",
  INVALID_TASK_ID: "上游任务 ID 无效",
  INVALID_MEDIA: "参考图/音视频无效或不可访问",
  INVALID_ROUTE: "未知的上游生成路由",
  DOWNLOAD_FAILED: "媒体文件下载失败",
  DOWNLOAD_TOO_LARGE: "媒体文件过大",
  DASHSCOPE_ERROR: "百炼/万相 API 返回错误",
  TTS_ERROR: "语音合成失败",
  INVALID_ID: "ID 格式无效",
  NOT_FOUND: "资源不存在",
  INVALID_DATETIME: "日期时间筛选格式无效",
  EXPORT_TOO_LARGE: "导出条数超过上限，请缩小筛选范围",
  INVALID_PRICING_MODE: "计价模式无效",
  INVALID_COST_PRICE: "成本价格式无效",
  REDIS_UNAVAILABLE: "缓存服务暂不可用，请稍后重试",
  CREDITS_DISABLED: "算力系统未启用",
  DIRECT_RECHARGE_DISABLED: "开源本地版不支持在线充值",
  PAYMENT_NOT_CONFIGURED: "在线支付暂不可用，请稍后再试",
  SUBSCRIPTION_IN_PROGRESS: "订阅处理中，请稍后再试",
  SMS_REDIS_UNAVAILABLE: "短信验证码服务暂不可用，请稍后重试",
  CAPTCHA_REQUIRED: "请先完成滑动验证",
  CAPTCHA_INVALID: "滑动验证未通过，请重试",
  CAPTCHA_EXPIRED: "验证码已过期，请刷新后重试",
  CAPTCHA_TICKET_INVALID: "验证凭证无效或已使用，请重新验证",
  CAPTCHA_LOCKED: "验证错误次数过多，请稍后再试",
  CAPTCHA_REDIS_UNAVAILABLE: "验证码服务暂不可用，请稍后重试",
  ACCOUNT_DISABLED: "账号已被禁用，请联系管理员",
  JOB_NOT_FOUND: "生成任务不存在",
  ASSET_NOT_FOUND: "资产不存在",
  UPLOAD_RATE_LIMITED: "上传过于频繁，请稍后再试",
  COVER_INVALID_TYPE: "仅支持 JPG、PNG、GIF、WebP、BMP 封面图片",
  VIDEO_REF_INACCESSIBLE: "参考视频无法访问，请确认 OSS 已配置且视频已上传",
  MULTIMODAL_MODEL_REQUIRED: "参考图片/视频生文需要使用支持多模态的豆包 Pro 模型",
  LLM_REQUEST_FAILED: "大模型请求失败",
  DIRECTOR_SCENE_NOT_FOUND: "导演场景不存在",
  INVALID_GENERATION_OPTIONS: "生成选项无效",
  INVALID_FILE_TYPE: "不允许的文件类型",
  MODEL_BUNDLE_EMPTY: "至少上传一个模型文件",
  MODEL_BUNDLE_NO_MAIN: "模型包中需要包含 .gltf 或 .glb 主文件",
  STORAGE_QUOTA_EXCEEDED: "云存储空间不足，请删除素材或开通会员",
  INVALID_STORAGE_QUOTA: "存储配额配置无效",
  INVALID_FILENAME: "文件名无效",
  CONFLICT: "操作冲突，请稍后重试",
};

export function normalizeErrorCode(code: string | null | undefined): string | null {
  if (!code?.trim()) return null;
  return code.trim().toUpperCase().replace(/-/g, "_");
}

export function getErrorMessageZh(code: string | null | undefined, fallback?: string): string | undefined {
  const normalized = normalizeErrorCode(code);
  if (normalized && ERROR_CODE_MAP[normalized]) {
    return ERROR_CODE_MAP[normalized];
  }
  return fallback;
}

export function resolveErrorMessage(detail: unknown, fallback?: string): string {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const rec = detail as Record<string, unknown>;
    const mapped = getErrorMessageZh(
      rec.code != null ? String(rec.code) : undefined,
      rec.message != null ? String(rec.message) : undefined
    );
    if (mapped) return mapped;
  }
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  return fallback || "操作失败，请稍后重试";
}

/**
 * 后端字段名（含 alias）→ 中文标签，用于把 422 校验错误翻译成可读提示。
 * 覆盖会员套餐、算力活动等管理端表单常见字段。
 */
const VALIDATION_FIELD_LABELS: Record<string, string> = {
  // 会员套餐
  code: "Code",
  name: "名称",
  monthlyCredits: "每期赠送算力",
  storageGb: "额外存储(GiB)",
  periodDays: "账期天数",
  priceCents: "标价(分)",
  sortOrder: "排序",
  // 算力活动
  title: "活动标题",
  amount: "赠送算力",
  creditType: "算力类型",
  modelName: "模型 name",
  validDays: "有效天数",
  startsAt: "开始时间",
  endsAt: "结束时间",
  perUserLimit: "每人可领次数",
  totalQuota: "总名额",
};

/** 把单条 FastAPI 校验错误（type/ctx/msg）翻译成中文约束说明。 */
function describeValidationConstraint(item: {
  type?: string;
  msg?: string;
  ctx?: Record<string, unknown>;
}): string {
  const ctx = item.ctx ?? {};
  switch (item.type) {
    case "greater_than_equal":
      return `需 ≥ ${ctx.ge}`;
    case "greater_than":
      return `需 > ${ctx.gt}`;
    case "less_than_equal":
      return `需 ≤ ${ctx.le}`;
    case "less_than":
      return `需 < ${ctx.lt}`;
    case "missing":
      return "为必填项";
    case "int_parsing":
    case "int_type":
      return "需填写整数";
    case "float_parsing":
    case "float_type":
      return "需填写数字";
    case "string_type":
      return "格式无效";
    case "datetime_parsing":
    case "datetime_type":
      return "时间格式无效";
    default:
      return item.msg || "取值无效";
  }
}

/**
 * 解析 422 校验错误（ApiError.content.errors）为可读中文提示，例如：
 * “参数校验失败（账期天数 需 ≤ 3650；每期赠送算力 需 ≥ 0）”。
 * 非 422 或无结构化错误时返回 null，调用方回退到通用 message。
 */
export function formatValidationError(err: unknown, fallback = "参数校验失败"): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: number; code?: string | null; content?: unknown };
  const isValidation = e.status === 422 || normalizeErrorCode(e.code) === "VALIDATION_ERROR";
  if (!isValidation) return null;
  const content = e.content as { errors?: unknown } | undefined;
  const errors = content?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;

  const parts: string[] = [];
  for (const raw of errors.slice(0, 3)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as {
      loc?: unknown[];
      msg?: string;
      type?: string;
      ctx?: Record<string, unknown>;
    };
    const loc = Array.isArray(item.loc) ? item.loc : [];
    const fieldKey = String(loc[loc.length - 1] ?? "");
    const label = VALIDATION_FIELD_LABELS[fieldKey] || fieldKey || "参数";
    parts.push(`${label} ${describeValidationConstraint(item)}`);
  }
  if (parts.length === 0) return fallback;
  return `${fallback}（${parts.join("；")}）`;
}
