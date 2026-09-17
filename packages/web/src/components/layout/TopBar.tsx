"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/basePath";

export function TopBar() {
  const router = useRouter();

  return (
    <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/80 backdrop-blur-xl px-6">
      {/* 品牌 Logo：高度 20px，与项目/登录页统一 */}
      <button
        onClick={() => router.push("/projects")}
        className="flex items-center gap-2 text-lg font-bold text-foreground hover:opacity-80"
      >
        <Image
          src={withBasePath("/brand-logo.png")}
          alt="开源画布"
          width={36}
          height={20}
          className="h-5 w-auto object-contain"
          priority
          unoptimized
        />
        <span className="text-primary">开源</span>
        <span>画布</span>
      </button>
    </header>
  );
}
