"""Android launcher icons from the web app's own artwork (../icon-512*.png).

Run from mobile/ after changing the icon:  python3 scripts/make-icons.py

- ic_launcher_foreground (adaptive icon, Android 8+): icon-512-maskable.png
  scaled to the full 108dp layer. Its stumps and wordmark sit inside the
  66dp circle every launcher mask keeps.
- ic_launcher (Android 7): icon-512.png, the rounded square.
- ic_launcher_round (Android 7.1 round launchers): the maskable art in a circle.
The adaptive icon's background colour is res/values/ic_launcher_background.xml.
Also writes store/play-icon-512.png, the 512x512 store listing icon.
"""
import os
from PIL import Image, ImageDraw

MOBILE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.dirname(MOBILE)
RES = os.path.join(MOBILE, "android", "app", "src", "main", "res")
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

maskable = Image.open(os.path.join(WEB, "icon-512-maskable.png")).convert("RGBA")
rounded = Image.open(os.path.join(WEB, "icon-512.png")).convert("RGBA")

def circle(img):
    size = img.size[0] * 4
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = img.copy()
    out.putalpha(mask.resize(img.size, Image.LANCZOS))
    return out

round_art = circle(maskable)
for name, scale in DENSITIES.items():
    d = os.path.join(RES, "mipmap-" + name)
    os.makedirs(d, exist_ok=True)
    fg, legacy = round(108 * scale), round(48 * scale)
    maskable.resize((fg, fg), Image.LANCZOS).save(os.path.join(d, "ic_launcher_foreground.png"), optimize=True)
    rounded.resize((legacy, legacy), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"), optimize=True)
    round_art.resize((legacy, legacy), Image.LANCZOS).save(os.path.join(d, "ic_launcher_round.png"), optimize=True)

store = os.path.join(MOBILE, "store")
os.makedirs(store, exist_ok=True)
maskable.convert("RGB").save(os.path.join(store, "play-icon-512.png"), optimize=True)
print("make-icons: launcher icons in res/mipmap-*, store/play-icon-512.png")
