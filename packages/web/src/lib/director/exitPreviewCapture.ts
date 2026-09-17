/**
 * 导演台退出时回写节点封面：StageView 注册捕获，Header「返回画布」调用。
 * 用模块级回调避免 Header 与 View 为兄弟组件时层层传 ref。
 */

type ExitPreviewCaptureFn = () => Promise<void>;

let exitPreviewCapture: ExitPreviewCaptureFn | null = null;

export function registerDirectorExitPreviewCapture(fn: ExitPreviewCaptureFn | null) {
  exitPreviewCapture = fn;
}

export async function runDirectorExitPreviewCapture() {
  if (!exitPreviewCapture) return;
  await exitPreviewCapture();
}
