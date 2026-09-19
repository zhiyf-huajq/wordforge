# -*- coding: utf-8 -*-
"""生成「词匠」APK 图标：传统 mipmap（Android 7 及以下）+ 自适应前景（Android 8+）

底色取应用默认主题 dawn 的主色，从亮蓝渐变到深蓝；中央一个白色「词」字。
自适应前景缩到 50% —— 系统会把前景裁进约 66% 的安全区，画满会被切掉边缘。
"""
import os
from PIL import Image, ImageDraw, ImageFont

# 项目根 = 本脚本所在目录（_dev/）的上一级。
# 不要写死绝对路径 —— 那样别人 clone 下来根本跑不了，还会把你的用户名和目录结构
# 一并公开到仓库里。
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "apk-src", "res")
FONTS = [r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc",
         r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\Deng.ttf"]

HI = (0x4a, 0x7c, 0xf7)
LO = (0x2b, 0x55, 0xcc)
SS = 4
GLYPH = "词"

_picked = None


def font(size):
    global _picked
    if _picked is None:
        for f in FONTS:
            if os.path.exists(f):
                try:
                    ImageFont.truetype(f, 24)
                    _picked = f
                    break
                except Exception:
                    pass
        if _picked is None:
            raise RuntimeError("找不到可用的中文字体，请检查 FONTS 列表")
    return ImageFont.truetype(_picked, size)


def grad(size):
    """垂直渐变底（顶部亮、底部略深）"""
    strip = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        strip.putpixel((0, y), tuple(
            int(HI[i] + (LO[i] - HI[i]) * t) for i in range(3)))
    return strip.resize((size, size))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_glyph(img, S, ratio):
    d = ImageDraw.Draw(img)
    d.text((S / 2, S / 2), GLYPH, font=font(int(S * ratio)),
           fill=(255, 255, 255, 255), anchor="mm")


def icon_square(size):
    """传统图标：圆角矩形底 + 白色「词」"""
    S = size * SS
    base = grad(S).convert("RGBA")
    draw_glyph(base, S, 0.58)
    base.putalpha(rounded_mask(S, int(S * 0.23)))
    return base.resize((size, size), Image.LANCZOS)


def icon_fg(size):
    """自适应前景：透明底 + 白色「词」"""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_glyph(img, S, 0.50)
    return img.resize((size, size), Image.LANCZOS)


LEGACY = [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]
FG = [("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)]

for d, px in LEGACY:
    p = os.path.join(RES, "mipmap-" + d)
    os.makedirs(p, exist_ok=True)
    f = os.path.join(p, "ic_launcher.png")
    icon_square(px).save(f)
    print("legacy  %-8s %3dpx  %s" % (d, px, os.path.getsize(f)))

for d, px in FG:
    p = os.path.join(RES, "mipmap-" + d)
    os.makedirs(p, exist_ok=True)
    f = os.path.join(p, "ic_launcher_fg.png")
    icon_fg(px).save(f)
    print("fg      %-8s %3dpx  %s" % (d, px, os.path.getsize(f)))

print("字体: " + str(_picked))
print("OK")
