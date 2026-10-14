"""Renders the Font Hive mark to resources/icon.png and resources/icon.ico (needs Pillow)."""
import os
from PIL import Image, ImageDraw

S = 2048
BG, FG = (15, 15, 16, 255), (234, 223, 200, 255)

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=BG)

k = S * 0.62 / 24  # logo spans x 5..27 / y 3..28 of a 32-unit box
ox, oy = S / 2 - 16 * k, S / 2 - 15.5 * k


def pt(x, y):
    return (ox + x * k, oy + y * k)


hexagon = [pt(16, 3), pt(27, 9.3), pt(27, 21.7), pt(16, 28), pt(5, 21.7), pt(5, 9.3)]
w = int(S * 0.045)
for a, b in zip(hexagon, hexagon[1:] + hexagon[:1]):
    d.line([a, b], fill=FG, width=w)
d.line([pt(5, 9.3), pt(16, 15.7), pt(27, 9.3)], fill=FG, width=w)
d.line([pt(16, 15.7), pt(16, 28)], fill=FG, width=w)
for x, y in hexagon + [pt(16, 15.7)]:
    d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=FG)

os.makedirs('resources', exist_ok=True)
png = img.resize((512, 512), Image.LANCZOS)
png.save('resources/icon.png')
png.save('resources/icon.ico', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
