"""Deterministic, synthetic-only raster specimens. Requires Pillow; never uses clinical files."""
from pathlib import Path
import json
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

directory = Path(__file__).resolve().parents[1] / "src/test/fixtures/laboratory-robustness-pdfs"
directory.mkdir(parents=True, exist_ok=True)
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(font_path, 34)
small = ImageFont.truetype(font_path, 23)

def page(masked=False):
    image = Image.new("L", (1600, 1100), 255)
    draw = ImageDraw.Draw(image)
    draw.text((65, 55), "DOCUMENTO SINTÉTICO — SOMENTE TESTE", font=font, fill=20)
    draw.text((65, 115), "SEM PACIENTE REAL — SEM CAMADA TEXTUAL", font=small, fill=60)
    draw.text((65, 250), "TSH: 0,55 mUI/L; Referência: 0,4 - 4,0", font=font, fill=15)
    if masked:
        # The value is not drawn at all: no hidden original result or recoverable PDF text.
        draw.text((65, 355), "Ferritina:", font=font, fill=15)
        draw.rectangle((255, 350, 400, 405), fill=15)
        draw.text((430, 355), "ng/mL", font=font, fill=15)
        draw.text((65, 475), "Valor coberto no documento; não inferir número.", font=small, fill=60)
    else:
        draw.text((65, 355), "Anti-HCV: Não reagente", font=font, fill=15)
        draw.text((65, 415), "Referência: Não reagente", font=font, fill=15)
    draw.text((65, 950), "Arquivo sintético gerado por código; proibido uso clínico.", font=small, fill=80)
    return image

clean = page()
degraded = clean.resize((800, 550), Image.Resampling.BILINEAR)
degraded = degraded.filter(ImageFilter.GaussianBlur(radius=0.45))
degraded = ImageEnhance.Contrast(degraded).enhance(0.72)
rng = random.Random(17012026)
pixels = degraded.load()
for y in range(degraded.height):
    for x in range(degraded.width):
        pixels[x, y] = min(255, max(0, pixels[x, y] + rng.randrange(-15, 16)))
degraded.save(directory / "scan-degraded.png", optimize=False)
degraded.transpose(Image.Transpose.ROTATE_90).save(directory / "scan-rotated.png", optimize=False)
page(masked=True).save(directory / "scan-partially-masked.png", optimize=False)
spec = {
    "classification": "SYNTHETIC_ONLY_NO_REAL_PATIENT_DATA",
    "generator": "scripts/generate-laboratory-robustness-rasters.py",
    "font": "DejaVuSans.ttf",
    "seed": 17012026,
    "degradation": {"originalPixels": [1600, 1100], "downsamplePixels": [800, 550], "blurRadius": 0.45, "contrast": 0.72, "noiseRangeInclusive": [-15, 15]},
    "rotationDegrees": 90,
    "sources": {
        "scan-degraded.png": {"legible": [{"name": "TSH", "result": "0,55", "unit": "mUI/L", "reference": "0,4 - 4,0"}, {"name": "Anti-HCV", "result": "Não reagente", "reference": "Não reagente"}]},
        "scan-rotated.png": {"sameLegibleContentAs": "scan-degraded.png", "rotationDegrees": 90},
        "scan-partially-masked.png": {"legible": [{"name": "TSH", "result": "0,55", "unit": "mUI/L", "reference": "0,4 - 4,0"}], "unreadable": [{"name": "Ferritina", "unit": "ng/mL", "result": None}], "mask": "value never drawn; raster rectangle only"}
    }
}
(directory / "raster-spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n")
print("Generated three synthetic raster specimens; no external APIs.")
