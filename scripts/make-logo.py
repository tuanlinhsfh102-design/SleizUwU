"""Generate Sleiz Vietsub default logo (transparent PNG)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = "/home/z/my-project/apps/web/public/logo-sleiz.png"
OUT_DEFAULT = "/home/z/my-project/data/storage/logo-sleiz-default.png"
os.makedirs(os.path.dirname(OUT_DEFAULT), exist_ok=True)

W, H = 480, 180
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded rectangle background — deep violet gradient feel
# Use a vibrant violet (#8b5cf6) with subtle darker outline
pad = 8
# Outer subtle border
draw.rounded_rectangle([pad, pad, W - pad, H - pad], radius=22,
                       fill=(139, 92, 246, 235), outline=(76, 29, 149, 255), width=2)
# Inner darker band (top stripe) for depth
draw.rounded_rectangle([pad + 4, pad + 4, W - pad - 4, pad + 36], radius=12,
                       fill=(76, 29, 149, 200))

# Find suitable fonts
font_paths = [
    "/usr/share/fonts/truetype/chinese/NotoSansSC-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
font_path = next((p for p in font_paths if os.path.exists(p)), None)

if font_path:
    font_big = ImageFont.truetype(font_path, 56)
    font_small = ImageFont.truetype(font_path, 28)
else:
    font_big = ImageFont.load_default()
    font_small = ImageFont.load_default()

# "Sleiz" - large brand text
brand = "Sleiz"
bbox = draw.textbbox((0, 0), brand, font=font_big)
bw = bbox[2] - bbox[0]
bh = bbox[3] - bbox[1]
draw.text(((W - bw) / 2 - bbox[0], 50 - bbox[1] + 6), brand,
          font=font_big, fill=(255, 255, 255, 255))

# "VIETSUB" - smaller subtitle text with letter-spacing
sub = "V I E T S U B"
bbox2 = draw.textbbox((0, 0), sub, font=font_small)
sw = bbox2[2] - bbox2[0]
draw.text(((W - sw) / 2 - bbox2[0], 120 - bbox2[1]), sub,
          font=font_small, fill=(245, 222, 179, 255))  # wheat color

# Small decorative dot
draw.ellipse([W - 30, 14, W - 14, 30], fill=(252, 211, 77, 255))

img.save(OUT, "PNG")
img.save(OUT_DEFAULT, "PNG")
print(f"Logo saved: {OUT}")
print(f"Default copy: {OUT_DEFAULT}")
print(f"Size: {os.path.getsize(OUT)} bytes")
