# -*- coding: utf-8 -*-
"""从画布顶栏品牌图 public/brand/logo.png 生成 Windows 图标与 NSIS 安装界面素材。

输出到 packages/desktop/build/：
- icon.ico / icon.png（exe / 快捷方式 / 安装目录图标）
- installerSidebar.bmp / uninstallerSidebar.bmp（164×314）
- installerHeader.bmp（150×57）
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
SRC = BUILD / "brand-source.png"
# 与 JmBrandMark 同源：packages/web/public/brand/logo.png
WEB_LOGO = ROOT.parent / "web" / "public" / "brand" / "logo.png"

# 品牌色（与 logo 红橙黄渐变一致）
BG = (12, 12, 14, 255)
BG2 = (28, 22, 20, 255)
ACCENT_TOP = (220, 48, 40)
ACCENT_MID = (255, 140, 40)
ACCENT_BOT = (255, 210, 60)
TEXT = (245, 245, 247, 255)
MUTED = (168, 168, 176, 255)


def load_brand() -> Image.Image:
    if not SRC.is_file():
        raise FileNotFoundError(f"缺少品牌源图: {SRC}")
    im = Image.open(SRC).convert("RGBA")
    # 去掉接近纯黑的底，方便贴到安装界面
    # 抠掉接近纯黑的底，方便贴到安装界面
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8 or (r < 28 and g < 28 and b < 28):
                px[x, y] = (r, g, b, 0)
    return im


def upscale_brand(brand: Image.Image, target: int) -> Image.Image:
    """高质量放大到约 target 边长（保持比例）。"""
    w, h = brand.size
    scale = target / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    # 多级放大，减轻锯齿
    cur = brand
    while max(cur.size) * 2 < max(nw, nh):
        cur = cur.resize((cur.width * 2, cur.height * 2), Image.Resampling.LANCZOS)
        cur = cur.filter(ImageFilter.SMOOTH_MORE)
    cur = cur.resize((nw, nh), Image.Resampling.LANCZOS)
    # 轻微锐化，图标更清晰
    cur = ImageEnhance.Sharpness(cur).enhance(1.25)
    return cur


def make_square_icon(brand: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    # 轻微径向暖色晕光
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx = cy = size // 2
    for i, alpha in enumerate((40, 24, 12)):
        r = int(size * (0.42 - i * 0.08))
        gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*ACCENT_MID, alpha))
    canvas = Image.alpha_composite(canvas, glow.filter(ImageFilter.GaussianBlur(radius=size // 10)))

    logo = upscale_brand(brand, int(size * 0.72))
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.paste(logo, (x, y), logo)
    return canvas


def write_ico(brand: Image.Image) -> None:
    """写入多尺寸 ICO（Windows 资源管理器 / 快捷方式需要完整尺寸集）。"""
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [make_square_icon(brand, s).convert("RGBA") for s in sizes]
    ico_path = BUILD / "icon.ico"
    # 以最大图为主，其余作为 ICO 内嵌尺寸
    imgs[-1].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=imgs[:-1],
    )
    imgs[-1].save(BUILD / "icon.png", format="PNG")
    print(f"[ok] {ico_path} sizes={sizes}")


def vertical_gradient(size: tuple[int, int], top, mid, bot) -> Image.Image:
    w, h = size
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        t = y / max(1, h - 1)
        if t < 0.5:
            u = t * 2
            c = tuple(int(top[i] + (mid[i] - top[i]) * u) for i in range(3))
        else:
            u = (t - 0.5) * 2
            c = tuple(int(mid[i] + (bot[i] - mid[i]) * u) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return im


def try_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_sidebar(brand: Image.Image) -> Image.Image:
    """NSIS MUI 左侧栏 164×314，24-bit BMP。"""
    w, h = 164, 314
    base = Image.new("RGB", (w, h), BG[:3])
    draw = ImageDraw.Draw(base)

    # 背景纵向微渐变
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(BG[i] + (BG2[i] - BG[i]) * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=c)

    # 顶部品牌色条
    bar = vertical_gradient((w, 6), ACCENT_TOP, ACCENT_MID, ACCENT_BOT)
    base.paste(bar, (0, 0))

    # Logo
    logo = upscale_brand(brand, 96)
    lx = (w - logo.width) // 2
    ly = 48
    # 柔光底
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((lx - 18, ly - 12, lx + logo.width + 18, ly + logo.height + 20), fill=(*ACCENT_MID, 36))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    base = Image.alpha_composite(base.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(base)
    base.paste(logo.convert("RGB"), (lx, ly), logo)

    # 文案
    title_font = try_font(18, bold=True)
    sub_font = try_font(12)
    title = "聚梦无限画布"
    # 居中测宽
    tb = draw.textbbox((0, 0), title, font=title_font)
    tw = tb[2] - tb[0]
    draw.text(((w - tw) // 2, ly + logo.height + 28), title, font=title_font, fill=TEXT[:3])

    sub = "本地 · 无限画布"
    sb = draw.textbbox((0, 0), sub, font=sub_font)
    sw = sb[2] - sb[0]
    draw.text(((w - sw) // 2, ly + logo.height + 56), sub, font=sub_font, fill=MUTED[:3])

    # 底部细渐变线 + 版本提示区
    line = vertical_gradient((w - 32, 3), ACCENT_TOP, ACCENT_MID, ACCENT_BOT)
    base.paste(line, (16, h - 52))
    tip_font = try_font(11)
    tip = "安装向导"
    tipb = draw.textbbox((0, 0), tip, font=tip_font)
    tipw = tipb[2] - tipb[0]
    draw.text(((w - tipw) // 2, h - 36), tip, font=tip_font, fill=MUTED[:3])

    return base.convert("RGB")


def make_header(brand: Image.Image) -> Image.Image:
    """目录页顶栏 150×57。"""
    w, h = 150, 57
    im = Image.new("RGB", (w, h), (248, 248, 250))
    draw = ImageDraw.Draw(im)
    # 左侧品牌色竖条
    bar = vertical_gradient((4, h), ACCENT_TOP, ACCENT_MID, ACCENT_BOT)
    im.paste(bar, (0, 0))

    logo = upscale_brand(brand, 36)
    im.paste(logo.convert("RGB"), (14, (h - logo.height) // 2), logo)

    font = try_font(13, bold=True)
    draw.text((14 + logo.width + 10, 12), "聚梦无限画布", font=font, fill=(28, 28, 32))
    sfont = try_font(10)
    draw.text((14 + logo.width + 10, 32), "选择安装位置", font=sfont, fill=(110, 110, 118))
    return im


def sync_brand_source() -> None:
    """用画布 /brand/logo.png 覆盖 build/brand-source.png。"""
    BUILD.mkdir(parents=True, exist_ok=True)
    if not WEB_LOGO.is_file():
        raise FileNotFoundError(f"缺少画布品牌图: {WEB_LOGO}")
    shutil.copy2(WEB_LOGO, SRC)
    print(f"[ok] brand-source ← {WEB_LOGO}")


def main() -> None:
    sync_brand_source()
    brand = load_brand()
    write_ico(brand)
    sidebar = make_sidebar(brand)
    sidebar.save(BUILD / "installerSidebar.bmp", format="BMP")
    sidebar.save(BUILD / "uninstallerSidebar.bmp", format="BMP")
    header = make_header(brand)
    header.save(BUILD / "installerHeader.bmp", format="BMP")
    print(f"[ok] sidebar/header → {BUILD}")


if __name__ == "__main__":
    main()
