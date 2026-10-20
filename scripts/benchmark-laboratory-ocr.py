"""Offline Stage D.1 experiment, restricted to three hash-pinned synthetic scans.

Requires system pdftoppm, Tesseract (eng/osd) and Pillow. Never imported by the
clinical pipeline; never calls a model, application, database or external OCR.
python scripts/benchmark-laboratory-ocr.py --output work/laboratory-ocr-d1
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import time
import unicodedata

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "src/test/fixtures/laboratory-robustness-pdfs"
CASES = ("scan-degraded", "scan-rotated", "scan-partially-masked")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=45, check=False)


def canonical(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip().casefold()


def lines_from_tsv(raw):
    lines = {}
    # Tesseract TSV does not quote recognized text; a recognized quote must not
    # consume following rows as a multiline CSV field.
    for word in csv.DictReader(io.StringIO(raw), delimiter="\t", quoting=csv.QUOTE_NONE):
        if word.get("level") != "5" or not word.get("text", "").strip():
            continue
        key = tuple(word[k] for k in ("page_num", "block_num", "par_num", "line_num"))
        lines.setdefault(key, []).append({
            "text": word["text"],
            "confidence": float(word["conf"]),
            "box": [int(word[k]) for k in ("left", "top", "width", "height")],
        })
    return [{"text": " ".join(w["text"] for w in words), "words": words}
            for words in lines.values()]


def inspect(lines, masked):
    """Literal OCR evidence diagnostics, NOT structured extraction or verification.

    No normalization of units, synonym mapping, numeric repair or model output.
    Same-line association required. Portuguese accents count as recognition errors.
    """
    text_lines = [re.sub(r"\s+", " ", unicodedata.normalize("NFC", line["text"]))
                  for line in lines]
    tsh = [line for line in text_lines if re.search(r"\btsh\b", canonical(line))]
    anti = [line for line in text_lines if "anti-hcv" in canonical(line)]
    ferritina = [line for line in text_lines if "ferritina" in canonical(line)]
    result = {
        "tshNameFound": bool(tsh),
        "tshResultOnSameLine": any("0,55" in line for line in tsh),
        # Unit case/prefixes are significant. Never forgive M/m or I/l substitutions.
        "tshUnitOnSameLine": any(re.search(r"(?<![A-Za-z])mUI/L(?=[;\s]|$)", line)
                                 for line in tsh),
        "tshReferenceOnSameLine": any("0,4 - 4,0" in line for line in tsh),
        "antiHcvNameFound": bool(anti) if not masked else None,
        "antiHcvAccentedResultOnSameLine": any("não reagente" in canonical(line) for line in anti)
        if not masked else None,
        "ferritinaMentionFound": bool(ferritina) if masked else None,
        "maskedLineNumericTokenObserved": any(re.search(r"\d", line) for line in ferritina)
        if masked else None,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output == FIXTURES or FIXTURES in output.parents:
        raise ValueError("Never overwrite reference fixtures")
    output.mkdir(parents=True, exist_ok=True)
    hashes = json.loads((FIXTURES / "sha256.json").read_text())
    report = {
        "purpose": "SYNTHETIC_ONLY_OFFLINE_OCR_EXPERIMENT_NOT_CLINICAL_EVIDENCE",
        "source": "versioned_PDF_not_model_transcription",
        "scriptSha256": sha(Path(__file__).read_bytes()),
        "tesseractVersion": run(["tesseract", "--version"]).stdout.splitlines()[0],
        "languagesAvailable": run(["tesseract", "--list-langs"]).stdout.splitlines(),
        "languageUsed": "eng", "dpi": 150,
        "providerCalls": 0, "productionIntegration": False,
        "limitations": [
            "Only three synthetic scans, one degradation and one rotation.",
            "No Portuguese language data installed; accent errors must remain errors.",
            "Word confidence is not clinical correctness or a calibrated probability.",
            "Oracle rotation is known from the fixture, not inferred from the document.",
            "Literal same-line diagnostics are not structured extraction accuracy.",
            "Boxes refer to each transformed raster; no original-region mapping is claimed.",
        ],
        "records": [],
    }
    for case in CASES:
        original = FIXTURES / (case + ".pdf")
        digest = sha(original.read_bytes())
        if digest != hashes[case]:
            raise ValueError("SYNTHETIC_HASH_MISMATCH")
        case_dir = output / case
        case_dir.mkdir(exist_ok=True)
        start = time.perf_counter()
        raster = run(["pdftoppm", "-f", "1", "-singlefile", "-r", "150", "-png",
                      str(original), str(case_dir / "page-1")])
        if raster.returncode:
            raise RuntimeError("RASTERIZATION_FAILED")
        raster_ms = round((time.perf_counter() - start) * 1000)
        image_path = case_dir / "page-1.png"
        variants = [("automatic-layout", 3, 0), ("automatic-orientation", 1, 0),
                    ("single-block", 6, 0)]
        if case == "scan-rotated":
            variants.append(("oracle-unrotate", 6, -90))
        for name, psm, rotation in variants:
            source = image_path
            if rotation:
                source = case_dir / (name + ".png")
                with Image.open(image_path) as image:
                    image.rotate(rotation, expand=True, fillcolor="white").save(source)
            with Image.open(source) as image:
                dimensions = list(image.size)
            start = time.perf_counter()
            proc = run(["tesseract", str(source), "stdout", "-l", "eng", "--psm", str(psm), "tsv"])
            milliseconds = round((time.perf_counter() - start) * 1000)
            (case_dir / (name + ".tsv")).write_text(proc.stdout)
            lines = lines_from_tsv(proc.stdout) if proc.returncode == 0 else []
            report["records"].append({
                "caseId": case, "page": 1, "pdfSha256": digest,
                "rasterSha256": sha(source.read_bytes()), "rasterDimensions": dimensions,
                "variant": name, "psm": psm, "rotationDegrees": rotation,
                "rotationSource": "fixture_oracle" if rotation else "none",
                "rasterMilliseconds": raster_ms, "ocrMilliseconds": milliseconds,
                "exitCode": proc.returncode, "diagnostics": proc.stderr.strip(),
                "lines": lines, "literalDiagnostics": inspect(lines, case.endswith("masked")),
            })
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for record in report["records"]:
        print(record["caseId"], record["variant"], record["ocrMilliseconds"],
              json.dumps(record["literalDiagnostics"], ensure_ascii=False))


if __name__ == "__main__":
    main()
