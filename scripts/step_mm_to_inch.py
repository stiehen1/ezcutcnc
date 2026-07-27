#!/usr/bin/env python
"""
Convert the millimetre STEP masters to genuine INCH files.

Why this is not a text substitution
-----------------------------------
The previous "- IN" export was a header relabel: it declared
CONVERSION_BASED_UNIT('INCH') while leaving every coordinate in millimetres,
so CAD packages multiplied by 25.4 and a 1/2" endmill measured 12.70".

The obvious fix -- divide the numbers by 25.4 -- is a trap. These files are
B-rep with B-splines, and B_SPLINE_*_WITH_KNOTS records carry TWO kinds of
number in the same syntactic position: length knots (must scale) and angular
knots in radians from circular parameterisations (must NOT scale). Measured
across a 150-file sample: angular knots appear only inside RATIONAL complex
entities, but 212 RATIONAL records also carry length knots -- so entity type
does not decide it and any regex heuristic will silently corrupt surfaces.
Rational weights and DIRECTION unit vectors must also never be touched.

So the conversion is delegated to OpenCASCADE, which parses the schema and
knows which values are lengths. We read the shape, apply a true geometric
scale of 1/25.4, and write with write.step.unit = INCH.

Usage:
  python scripts/step_mm_to_inch.py convert   # write the inch catalogue
  python scripts/step_mm_to_inch.py verify    # re-read output, assert sane
"""

import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor

from OCP.STEPControl import STEPControl_Reader, STEPControl_AsIs
from OCP.STEPCAFControl import STEPCAFControl_Reader, STEPCAFControl_Writer
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFApp import XCAFApp_Application
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

BASE = Path(r"C:\Users\scott\OneDrive\Desktop\STEP-Normalized_Master")
SRC = BASE / "STEP_Normalized Files (Z axis) - MM"
DST = BASE / "STEP_Normalized Files (Z axis) - INCH_TRUE"

MM_PER_INCH = 25.4
# A solid carbide endmill: nothing in this catalogue exceeds ~8in / ~205mm.
MAX_INCH = 12.0


def read_shape(path: Path):
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone:
        raise RuntimeError("read failed")
    reader.TransferRoots()
    return reader.OneShape()


def raw_max_coord(text: str) -> float:
    """Largest absolute 3D CARTESIAN_POINT value as literally written.

    Deliberately ignores the declared unit -- this is the magnitude a CAD
    package multiplies by the conversion factor, so it is the number that
    exposes a header/geometry mismatch.

    Only 3-tuples count. A 2-tuple CARTESIAN_POINT is a pcurve point in a
    surface's PARAMETER space, where the first value is an angle in radians
    and the second a length parameter; those are not model coordinates and
    are correctly left unscaled by a unit conversion. Counting them made this
    check report a correctly-converted file as "still mm-magnitude".
    """
    biggest = 0.0
    start = 0
    while (i := text.find("CARTESIAN_POINT('',(", start)) != -1:
        j = text.find(")", i)
        if j == -1:
            break
        parts = text[i + 20 : j].split(",")
        start = j
        if len(parts) != 3:
            continue
        for part in parts:
            try:
                v = abs(float(part))
            except ValueError:
                continue
            if v > biggest:
                biggest = v
    return biggest


def count_colours(text: str) -> int:
    """Number of distinct COLOUR_RGB values declared in a STEP file.

    These tools are two-tone (grey shank, cyan flute length); losing them makes
    the model import as flat grey. Counted distinctly rather than by occurrence
    because the writer may legitimately renumber or share entities.
    """
    found = set()
    start = 0
    while (i := text.find("COLOUR_RGB(", start)) != -1:
        j = text.find(")", i)
        if j == -1:
            break
        vals = text[i + 11 : j].split(",")[-3:]
        try:
            found.add(tuple(round(float(v), 6) for v in vals))
        except ValueError:
            pass
        start = j
    return len(found)


def bbox_max(shape) -> float:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    xa, ya, za, xb, yb, zb = box.Get()
    return max(abs(v) for v in (xa, ya, za, xb, yb, zb))


def convert_one(name: str):
    """Scale one file mm -> inch. Returns (name, ok, detail)."""
    try:
        src = SRC / name

        # Use the CAF (attribute) reader/writer, not STEPControl_Writer. The
        # plain writer transfers geometry ONLY and silently drops STYLED_ITEM /
        # PRESENTATION_STYLE_ASSIGNMENT / COLOUR_RGB, which is what gives these
        # tools their two-tone shank-vs-LOC colouring in CAD.
        app = XCAFApp_Application.GetApplication_s()
        doc = TDocStd_Document(TCollection_ExtendedString("MDTV-XCAF"))
        app.NewDocument(TCollection_ExtendedString("MDTV-XCAF"), doc)

        reader = STEPCAFControl_Reader()
        reader.SetColorMode(True)
        reader.SetNameMode(True)
        reader.SetLayerMode(True)
        if reader.ReadFile(str(src)) != IFSelect_RetDone:
            raise RuntimeError("read failed")
        if not reader.Transfer(doc):
            raise RuntimeError("CAF transfer failed")

        out = DST / name
        writer = STEPCAFControl_Writer()
        writer.SetColorMode(True)
        writer.SetNameMode(True)
        writer.SetLayerMode(True)

        # Order matters. The `write.step.*` statics are not registered until a
        # STEP writer has been constructed -- SetCVal_s returns False and does
        # nothing if called first, leaving the default MM and silently emitting
        # a millimetre file. Construct, THEN set the unit, THEN transfer.
        #
        # Do NOT pre-scale the geometry to compensate. OCCT holds shapes in mm
        # internally and this setting makes the writer convert on output,
        # emitting inch coordinates AND the 25.4 conversion factor together.
        # Scaling by 1/25.4 as well double-converts, reproducing the exact
        # FreeCAD defect this script exists to fix.
        if not Interface_Static.SetCVal_s("write.step.unit", "INCH"):
            raise RuntimeError("could not set write.step.unit")
        Interface_Static.SetIVal_s("write.step.schema", 214)

        if not writer.Transfer(doc, STEPControl_AsIs):
            raise RuntimeError("CAF write-transfer failed")
        if writer.Write(str(out)) != IFSelect_RetDone:
            raise RuntimeError("write failed")

        shape = read_shape(src)  # for the dimension checks below

        want = bbox_max(shape)  # source size, in mm

        # Check 1 -- semantic. Re-read through the kernel, which applies the
        # declared unit. OCCT normalises to mm, so a correct inch file comes
        # back at the ORIGINAL mm magnitude. This catches a wrong or missing
        # conversion factor.
        back = bbox_max(read_shape(out))
        if want > 0 and abs(back - want) / want > 0.001:
            raise RuntimeError(f"roundtrip {back:.4f}mm != source {want:.4f}mm")

        text = out.read_text(errors="ignore")
        if "CONVERSION_BASED_UNIT('INCH'" not in text:
            raise RuntimeError("output does not declare INCH")

        # Check 2 -- literal. Read the raw numbers on disk. Check 1 alone would
        # pass a file whose header and coordinates are consistently WRONG in
        # the same direction; this asserts the coordinates are inch-magnitude,
        # which is what a CAD package actually shows the customer.
        raw = raw_max_coord(text)
        expect = want / MM_PER_INCH
        if raw > MAX_INCH:
            raise RuntimeError(f"coords still mm-magnitude ({raw:.2f})")
        if expect > 0 and abs(raw - expect) / expect > 0.01:
            raise RuntimeError(f"coord {raw:.4f}in != expected {expect:.4f}in")

        # Check 3 -- presentation. The first pass used STEPControl_Writer and
        # silently dropped every COLOUR_RGB, so the tools imported plain grey
        # and only turned up when the file was opened in Fusion. Assert the
        # colours survived, and that we did not lose any.
        src_colours = count_colours(src.read_text(errors="ignore"))
        out_colours = count_colours(text)
        if out_colours < src_colours:
            raise RuntimeError(f"lost colour: {src_colours} -> {out_colours}")

        return (name, True, f"{expect:.3f}in {out_colours}col")
    except Exception as e:  # noqa: BLE001 - report, never abort the batch
        return (name, False, str(e)[:120])


def convert():
    DST.mkdir(parents=True, exist_ok=True)
    names = sorted(p.name for p in SRC.glob("*.step"))
    print(f"converting {len(names)} files\n  {SRC}\n  -> {DST}\n")

    ok = 0
    failed = []
    with ProcessPoolExecutor() as pool:
        for i, (name, good, detail) in enumerate(
            pool.map(convert_one, names, chunksize=8), 1
        ):
            if good:
                ok += 1
            else:
                failed.append((name, detail))
            if i % 100 == 0 or i == len(names):
                print(f"\r  {i}/{len(names)}  ok={ok} failed={len(failed)}", end="")

    print(f"\n\nconverted {ok} / {len(names)}   failed {len(failed)}")
    for n, d in failed[:25]:
        print(f"  x {n}: {d}")
    return 1 if failed else 0


def verify(sample_size: int = 60):
    """Independent check: parse the OUTPUT and confirm inch magnitudes."""
    names = sorted(p.name for p in DST.glob("*.step"))
    if not names:
        print("no output files -- run convert first")
        return 1
    step = max(1, len(names) // sample_size)
    sample = names[::step][:sample_size]

    good = bad = 0
    for name in sample:
        text = (DST / name).read_text(errors="ignore")
        declares = "CONVERSION_BASED_UNIT('INCH'" in text
        # For a true inch file these are inch numbers, inside MAX_INCH.
        raw = raw_max_coord(text)
        if declares and 0 < raw <= MAX_INCH:
            good += 1
        else:
            bad += 1
            why = "no INCH header" if not declares else f"max coord {raw:.2f} too big"
            print(f"  x {name}: {why}")

    print(f"\nsampled {len(sample)}:  good {good} | bad {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "convert"
    if cmd == "convert":
        sys.exit(convert())
    elif cmd == "verify":
        sys.exit(verify())
    else:
        print(f"unknown command: {cmd}  (convert | verify)")
        sys.exit(1)
