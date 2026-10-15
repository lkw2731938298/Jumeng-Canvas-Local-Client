"use client";

import { useEffect, useId, useState } from "react";
import { MessageCircleQuestion, X } from "lucide-react";

/** 顶栏「问题反馈」：弹窗展示开源群 + 聚梦画布交流群二维码 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        className="jm-top-feedback"
        type="button"
        title="问题反馈"
        onClick={() => setOpen(true)}
      >
        <MessageCircleQuestion size={15} strokeWidth={1.8} aria-hidden="true" />
        <span>问题反馈</span>
      </button>

      {open ? (
        <div
          className="jm-feedback-overlay"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="jm-feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="jm-feedback-head">
              <h2 id={titleId}>问题反馈</h2>
              <p>扫码加入交流群，反馈问题或获取帮助</p>
              <button
                type="button"
                className="jm-feedback-close"
                aria-label="关闭"
                onClick={() => setOpen(false)}
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </header>
            <div className="jm-feedback-grid">
              <figure className="jm-feedback-card">
                {/* 开源画布交流群二维码 */}
                <img
                  src="/huabu/feedback/opensource-qq.jpg"
                  alt="开源画布交流群二维码"
                  draggable={false}
                />
              </figure>
              <figure className="jm-feedback-card">
                {/* 聚梦画布交流群（群号 870365376） */}
                <img
                  src="/huabu/feedback/jumeng-qq.png"
                  alt="聚梦画布交流群二维码，群号 870365376"
                  draggable={false}
                />
              </figure>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
