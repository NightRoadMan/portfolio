"""
Rebuild brain/data/ (brain_atlas.webp|png, brain_meta.json) at 1.0 mm from the Seri7 3D FLAIR series in BrainTM.

  python3 -m venv .venv && .venv/bin/pip install pydicom pylibjpeg pylibjpeg-openjpeg pylibjpeg-libjpeg numpy pillow scipy
  .venv/bin/python brain/tools/build_atlas.py <BrainTM>/Teletip-LET6252768/Seri7 <BrainTM>/cache brain/data 1.0

The scan is 0.94 x 0.94 mm in-plane with 1.5 mm sagittal slices, so 1.0 mm keeps the in-plane detail (BrainTM's own
build_volume.py resamples to 1.4 mm). The skull strip is BrainTM's HD-BET mask (cache/hdbet_mask.npy, on its 1.4 mm grid),
upsampled. Landmarks are computed as in build_volume.py, so the procedural vessels land where they did.
The raw DICOM series is private: it stays in BrainTM and is never copied into this repo.
"""
import glob, json, os, sys
import numpy as np, pydicom
from PIL import Image
from scipy import ndimage as ndi

SRC, CACHE, OUT, ISO = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
ds = sorted((pydicom.dcmread(f) for f in glob.glob(os.path.join(SRC, "*.dcm"))), key=lambda d: int(d.InstanceNumber))
raw = np.stack([d.pixel_array for d in ds]).astype(np.float32)          # (sagittal, row, col)
px = [float(v) for v in ds[0].PixelSpacing]
sag = abs(np.mean(np.diff([float(d.ImagePositionPatient[0]) for d in ds])))
raw = np.transpose(raw, (1, 2, 0))[::-1, ::-1, :]                        # (z inferior->superior, y posterior->anterior, x)
vol = np.clip(ndi.zoom(raw, np.array([px[0], px[1], sag]) / ISO, order=3), 0, None)

hd = np.load(os.path.join(CACHE, "hdbet_mask.npy"))                      # HD-BET mask on the 1.4 mm grid
mf = ndi.zoom(hd.astype(np.float32), np.array(vol.shape) / np.array(hd.shape), order=1)[:vol.shape[0], :vol.shape[1], :vol.shape[2]]
mf = np.pad(mf, [(0, a - b) for a, b in zip(vol.shape, mf.shape)])
mask = ndi.binary_fill_holes(ndi.gaussian_filter(mf, 0.6) > 0.5)
brain = vol * ndi.gaussian_filter(mask.astype(np.float32), 1.2 * 1.4 / ISO)

nz = np.argwhere(mask)
lo = np.maximum(nz.min(0) - round(4 * 1.4 / ISO), 0); hi = np.minimum(nz.max(0) + round(5 * 1.4 / ISO), np.array(brain.shape))
brain = brain[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
brain = np.clip(brain / np.percentile(brain[brain > 0], 99.5), 0, 1) ** 0.9
u8 = (brain * 255).astype(np.uint8)
Z, Y, X = u8.shape

cols = int(np.ceil(np.sqrt(Z))); rows = int(np.ceil(Z / cols))
atlas = np.zeros((rows * Y, cols * X), np.uint8)
for z in range(Z):
    r, c = divmod(z, cols); atlas[r * Y:(r + 1) * Y, c * X:(c + 1) * X] = u8[z][::-1]   # image row 0 = anterior
Image.fromarray(atlas).save(os.path.join(OUT, "brain_atlas.png"), optimize=True)
Image.fromarray(atlas).save(os.path.join(OUT, "brain_atlas.webp"), quality=85, method=6)

m = u8 > 40
zz, yy, xx = np.nonzero(m)
frac = lambda v, n: v / n - 0.5
mid_x = frac(xx.mean(), X)
col = m[:, :, int(round(xx.mean())) - 2:int(round(xx.mean())) + 3].any(axis=2)
y0 = int(yy.mean() + 0.15 * (yy.max() - yy.mean())); y1 = int(yy.mean() + 0.40 * (yy.max() - yy.mean()))
mins = [np.nonzero(col[:, y])[0].min() for y in range(y0, y1) if col[:, y].any()]
cow_z = float(np.clip(frac(np.median(mins), Z) + 0.02, -0.28, -0.05)) if mins else -0.12
cy, cx = np.nonzero(m[int((cow_z + 0.5) * Z)])
low = m[:max(4, int(0.06 * Z))]; lz, ly, lx = np.nonzero(low)
lm = {"midX": float(mid_x), "cow": [float(mid_x), float(frac(yy.max(), Y) - 0.40 * (yy.max() - yy.min()) / Y), cow_z],
      "halfWidthAtCow": float((cx.max() - cx.min()) / 2 / X) if len(cx) else 0.4,
      "stemXY": [float(frac(lx.mean(), X)), float(frac(ly.mean(), Y))] if len(lx) else [float(mid_x), -0.05],
      "top": float(frac(zz.max(), Z)), "bottom": float(frac(zz.min(), Z)), "front": float(frac(yy.max(), Y)), "back": float(frac(yy.min(), Y))}
meta = {"dims": [X, Y, Z], "tiles": [cols, rows], "voxelMm": ISO, "landmarks": lm,
        "axes": "x: left->right, y: posterior->anterior (image row 0 = anterior), z: inferior->superior"}
json.dump(meta, open(os.path.join(OUT, "brain_meta.json"), "w"), indent=2)
print("volume (z,y,x)", u8.shape, "atlas", atlas.shape, {f: os.path.getsize(os.path.join(OUT, f)) // 1024 for f in ("brain_atlas.png", "brain_atlas.webp")}, "KB")
