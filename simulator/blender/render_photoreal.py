"""
Photoreal Cycles render of the Palafang raft.

Usage (the `bpy` wheel, Python 3.13):
    python render_photoreal.py EXPORT_DIR ASSETS_DIR OUT_DIR
        [--set beach|sea] [--views hero,bow,...] [--samples 256] [--res 1920x1080]

EXPORT_DIR  what `node blender/export.cjs` writes (raft.glb, tex/, scene.json).
ASSETS_DIR  Poly Haven downloads (see blender/fetch_assets.sh): hdri/*.hdr, tex/*.jpg.

The geometry comes from the generator unchanged. This script only swaps the
viewer's materials for physically based ones built to match the reference
photos (weathered grey bamboo, pale split rattan, grey bark-free poles, white
synthetic stays, the woven bark sail), lights the scene with a real HDRI and
puts the raft either on a beach or afloat.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Matrix, Vector


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("export_dir")
    p.add_argument("assets_dir")
    p.add_argument("out_dir")
    p.add_argument("--set", default="beach", choices=["beach", "sea"])
    p.add_argument("--views", default="hero")
    p.add_argument("--samples", type=int, default=256)
    p.add_argument("--res", default="1920x1080")
    p.add_argument("--save-blend", action="store_true")
    p.add_argument("--sun-az", type=float, default=None, help="put the HDRI sun at this azimuth (deg, 0 = toward +x / bow, 90 = toward +y / port)")
    return p.parse_args(argv)


# ----------------------------------------------------------------------------- node helpers

class Nodes:
    def __init__(self, owner):
        owner.use_nodes = True
        self.nt = owner.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def new(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for k, v in props.items():
            if k.startswith("in_"):
                n.inputs[k[3:].replace("_", " ")].default_value = v
            else:
                setattr(n, k, v)
        n.location = (self.x, 0)
        self.x += 200
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    # small math helpers ------------------------------------------------------
    def math(self, op, a, b=None, clamp=False):
        n = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                self.link(v, n.inputs[i])
        return n.outputs[0]

    def mix(self, fac, a, b, blend="MIX"):
        n = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        for sock, v in ((n.inputs["Factor"], fac), (n.inputs["A"], a), (n.inputs["B"], b)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            elif isinstance(v, tuple):
                sock.default_value = (*v, 1.0) if len(v) == 3 else v
            else:
                self.link(v, sock)
        return n.outputs["Result"]

    def maprange(self, v, fmin, fmax, tmin, tmax, clamp=True):
        n = self.new("ShaderNodeMapRange", clamp=clamp)
        n.inputs["From Min"].default_value = fmin
        n.inputs["From Max"].default_value = fmax
        n.inputs["To Min"].default_value = tmin
        n.inputs["To Max"].default_value = tmax
        self.link(v, n.inputs["Value"])
        return n.outputs["Result"]

    def uv_scaled(self, su, sv, offset=(0, 0)):
        tc = self.new("ShaderNodeTexCoord")
        mp = self.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (su, sv, 1.0)
        mp.inputs["Location"].default_value = (offset[0], offset[1], 0)
        self.link(tc.outputs["UV"], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    def obj(self):
        return self.new("ShaderNodeTexCoord").outputs["Object"]

    def img(self, path, vec, non_color=False):
        t = self.new("ShaderNodeTexImage")
        img = bpy.data.images.load(path, check_existing=True)
        if non_color:
            img.colorspace_settings.name = "Non-Color"
        t.image = img
        t.interpolation = "Cubic"
        self.link(vec, t.inputs["Vector"])
        return t

    def noise(self, vec, scale, detail=4.0, rough=0.5, dim="3D"):
        n = self.new("ShaderNodeTexNoise", noise_dimensions=dim)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        if vec is not None:
            self.link(vec, n.inputs["Vector"])
        return n

    def ramp(self, fac, stops):
        r = self.new("ShaderNodeValToRGB")
        els = r.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for e, (pos, col) in zip(els, stops):
            e.position = pos
            e.color = (*col, 1.0)
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def bump(self, height, strength, distance, normal=None):
        b = self.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def normal_map(self, color, strength, space="TANGENT", uv=""):
        n = self.new("ShaderNodeNormalMap", space=space)
        n.inputs["Strength"].default_value = strength
        self.link(color, n.inputs["Color"])
        return n.outputs["Normal"]


def ao_grime(N, color, distance, strength):
    """Darken crevices and contact areas (dirt and shade collect there)."""
    ao = N.new("ShaderNodeAmbientOcclusion", samples=8, only_local=False)
    ao.inputs["Distance"].default_value = distance
    k = N.maprange(ao.outputs["AO"], 0.0, 1.0, 1.0 - strength, 1.0)
    kc = N.new("ShaderNodeCombineColor")
    for i in range(3):
        N.link(k, kc.inputs[i])
    return N.mix(1.0, color, kc.outputs[0], "MULTIPLY")


def srgb(c):
    """sRGB 0..255 triple -> linear 0..1."""
    def f(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


# ----------------------------------------------------------------------------- shaders

class Shaders:
    def __init__(self, export_dir, assets_dir):
        self.T = lambda name: os.path.join(export_dir, "tex", name + ".png")
        self.A = lambda name: os.path.join(assets_dir, "tex", name + ".jpg")
        self.G = lambda name: os.path.join(assets_dir, "gen", name + ".png")

    # Weathered bamboo, matched to the photos: neutral to warm grey, darker
    # grey-brown culms mixed in, silvery where sun-bleached, fine lengthwise
    # fibres and splits, dark mildew streaks, pale lichen specks.
    def bamboo(self, mat, palette="hull"):
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        bsdf = N.new("ShaderNodeBsdfPrincipled")
        oi = N.new("ShaderNodeObjectInfo")
        geo = N.new("ShaderNodeNewGeometry")
        vc = N.new("ShaderNodeVertexColor", layer_name="Color")
        # Per-culm base colour. Each culm is its own object (or its own island).
        rnd = N.math("ADD", oi.outputs["Random"], geo.outputs["Random Per Island"])
        rnd = N.math("FRACT", rnd)
        if palette == "rail":
            stops = [(0.0, srgb((178, 170, 150))), (0.5, srgb((196, 188, 168))), (1.0, srgb((170, 160, 138)))]
        elif palette == "mast":
            stops = [(0.0, srgb((176, 164, 140))), (1.0, srgb((188, 178, 158)))]
        elif palette == "keel":
            stops = [(0.0, srgb((150, 128, 98))), (0.6, srgb((132, 118, 98))), (1.0, srgb((118, 108, 96)))]
        else:
            stops = [
                (0.0, srgb((100, 92, 84))),    # dark grey-brown
                (0.3, srgb((136, 129, 120))),  # mid grey
                (0.62, srgb((158, 153, 144))), # light grey
                (0.86, srgb((128, 112, 92))),  # brownish
                (1.0, srgb((176, 152, 108))),  # fresh replacement, straw-tan
            ]
        base = N.ramp(rnd, stops)
        # Vertex colour from the generator: node lines, scorch, wet underside, cut ends.
        lum = N.new("ShaderNodeRGBToBW")
        N.link(vc.outputs["Color"], lum.inputs["Color"])
        vk = N.maprange(lum.outputs["Val"], 0.0, 0.24, 0.0, 1.0, clamp=False)
        vk = N.math("MINIMUM", vk, 1.6)
        base = N.mix(1.0, base, N.new("ShaderNodeCombineColor").outputs[0], "MULTIPLY") if False else base
        vkc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(vk, vkc.inputs[i])
        base = N.mix(1.0, base, vkc.outputs[0], "MULTIPLY")
        # Real weathered-wood detail, stretched along the culm (v = metres along, u = around).
        uvw = N.uv_scaled(0.45, 0.55, offset=(0.0, 0.0))
        wd = N.img(self.A("rough_wood_diff_2k"), uvw)
        wn = N.img(self.A("rough_wood_nor_gl_2k"), uvw, non_color=True)
        wr = N.img(self.A("rough_wood_rough_2k"), uvw, non_color=True)
        wbw = N.new("ShaderNodeRGBToBW")
        N.link(wd.outputs["Color"], wbw.inputs["Color"])
        detail = N.maprange(wbw.outputs["Val"], 0.05, 0.4, 0.55, 1.28)
        dc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(detail, dc.inputs[i])
        base = N.mix(1.0, base, dc.outputs[0], "MULTIPLY")
        # Fine lengthwise fibre streaks, light and dark.
        fb = N.noise(N.uv_scaled(60.0, 1.2), 4.0, 8.0, 0.65)
        fbv = N.maprange(fb.outputs["Fac"], 0.3, 0.7, 0.78, 1.18)
        fbc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(fbv, fbc.inputs[i])
        base = N.mix(1.0, base, fbc.outputs[0], "MULTIPLY")
        # Mid-scale streaks a few mm wide that read from a couple of metres away.
        ms = N.noise(N.uv_scaled(16.0, 0.6), 2.2, 5.0, 0.6)
        msv = N.maprange(ms.outputs["Fac"], 0.32, 0.68, 0.72, 1.2)
        msc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(msv, msc.inputs[i])
        base = N.mix(1.0, base, msc.outputs[0], "MULTIPLY")
        # Blue-black mildew blotches, elongated along the culm (as in the close-up photos).
        st = N.noise(N.uv_scaled(3.0, 0.9), 2.5, 6.0, 0.62)
        stm = N.maprange(st.outputs["Fac"], 0.5, 0.64, 0.0, 0.85)
        oi2 = N.new("ShaderNodeObjectInfo")
        amt = N.maprange(oi2.outputs["Random"], 0.0, 1.0, 0.3, 1.0)
        stm = N.math("MULTIPLY", stm, amt)
        base = N.mix(stm, base, srgb((44, 46, 54)), "MIX")
        # Grey-brown water stains in broad soft patches.
        ws = N.noise(N.uv_scaled(1.5, 0.35), 2.0, 3.0, 0.5)
        wsm = N.maprange(ws.outputs["Fac"], 0.45, 0.65, 0.0, 0.35)
        base = N.mix(wsm, base, srgb((96, 84, 70)), "MIX")
        # Sun-bleached silver on upward faces, in patches.
        nz = N.new("ShaderNodeSeparateXYZ")
        N.link(geo.outputs["Normal"], nz.inputs["Vector"])
        up = N.maprange(nz.outputs["Z"], 0.2, 0.95, 0.0, 1.0)
        pat = N.noise(N.obj(), 1.2, 4.0, 0.6)
        patm = N.maprange(pat.outputs["Fac"], 0.42, 0.62, 0.0, 1.0)
        bleach = N.math("MULTIPLY", up, patm)
        bleach = N.math("MULTIPLY", bleach, 0.5 if palette == "hull" else 0.3)
        base = N.mix(bleach, base, srgb((175, 172, 166)), "MIX")
        # Lichen and salt specks.
        sp = N.new("ShaderNodeTexVoronoi", feature="F1")
        sp.inputs["Scale"].default_value = 220.0
        N.link(N.obj(), sp.inputs["Vector"])
        spn = N.noise(N.obj(), 4.0, 2.0, 0.5)
        spm = N.maprange(sp.outputs["Distance"], 0.0, 0.16, 1.0, 0.0)
        spg = N.maprange(spn.outputs["Fac"], 0.5, 0.62, 0.0, 1.0)
        spk = N.math("MULTIPLY", spm, spg)
        spk = N.math("MULTIPLY", spk, up)
        base = N.mix(spk, base, srgb((205, 204, 196)), "MIX")
        base = ao_grime(N, base, 0.06, 0.5)
        N.link(base, bsdf.inputs["Base Color"])
        # Roughness: weathered skin is matte, with a little silica sheen left.
        rr = N.maprange(wr.outputs["Color"], 0.0, 1.0, 0.5, 0.85)
        N.link(rr, bsdf.inputs["Roughness"])
        bsdf.inputs["Specular IOR Level"].default_value = 0.4
        # Fine splits along the culm.
        sl = N.noise(N.uv_scaled(70.0, 0.25), 2.0, 2.0, 0.5)
        slm = N.maprange(sl.outputs["Fac"], 0.66, 0.7, 0.0, 1.0)
        nrm = N.normal_map(wn.outputs["Color"], 1.3)
        nrm = N.bump(slm, 0.7, 0.0015, nrm)
        N.link(nrm, bsdf.inputs["Normal"])
        N.link(bsdf.outputs[0], out.inputs["Surface"])

    # Grey bark-free natural poles and hewn timber, from Poly Haven rough_wood.
    def wood(self, mat, around=0.25, tint=(1.0, 1.0, 1.0), value=1.0, smooth=False, sat=0.55):
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        bsdf = N.new("ShaderNodeBsdfPrincipled")
        oi = N.new("ShaderNodeObjectInfo")
        geo = N.new("ShaderNodeNewGeometry")
        rnd = N.math("FRACT", N.math("ADD", oi.outputs["Random"], geo.outputs["Random Per Island"]))
        off = N.math("MULTIPLY", rnd, 7.31)
        tc = N.new("ShaderNodeTexCoord")
        mp = N.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (around, 0.8, 1.0)
        N.link(tc.outputs["UV"], mp.inputs["Vector"])
        comb = N.new("ShaderNodeCombineXYZ")
        N.link(off, comb.inputs["X"])
        N.link(off, comb.inputs["Y"])
        add = N.new("ShaderNodeVectorMath", operation="ADD")
        N.link(mp.outputs["Vector"], add.inputs[0])
        N.link(comb.outputs["Vector"], add.inputs[1])
        uv = add.outputs["Vector"]
        d = N.img(self.A("rough_wood_diff_2k"), uv)
        n = N.img(self.A("rough_wood_nor_gl_2k"), uv, non_color=True)
        r = N.img(self.A("rough_wood_rough_2k"), uv, non_color=True)
        hs = N.new("ShaderNodeHueSaturation")
        hs.inputs["Saturation"].default_value = sat
        hs.inputs["Value"].default_value = value
        N.link(d.outputs["Color"], hs.inputs["Color"])
        col = N.mix(1.0, hs.outputs["Color"], tint, "MULTIPLY")
        # Each pole a different weathering.
        var = N.maprange(rnd, 0.0, 1.0, 0.75, 1.2)
        vc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(var, vc.inputs[i])
        col = N.mix(1.0, col, vc.outputs[0], "MULTIPLY")
        col = ao_grime(N, col, 0.05, 0.5)
        N.link(col, bsdf.inputs["Base Color"])
        rr = N.maprange(r.outputs["Color"], 0.0, 1.0, 0.45 if smooth else 0.6, 0.75 if smooth else 0.95)
        N.link(rr, bsdf.inputs["Roughness"])
        N.link(N.normal_map(n.outputs["Color"], 0.6 if smooth else 1.2), bsdf.inputs["Normal"])
        N.link(bsdf.outputs[0], out.inputs["Surface"])

    # Flat split rattan: pale grey-tan, weathered; some fresh honey-tan strips.
    def rattan(self, mat):
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        bsdf = N.new("ShaderNodeBsdfPrincipled")
        geo = N.new("ShaderNodeNewGeometry")
        oi = N.new("ShaderNodeObjectInfo")
        rnd = N.math("FRACT", N.math("ADD", geo.outputs["Random Per Island"], oi.outputs["Random"]))
        base = N.ramp(rnd, [
            (0.0, srgb((150, 144, 132))),
            (0.45, srgb((176, 170, 156))),
            (0.8, srgb((160, 150, 128))),
            (0.9, srgb((178, 160, 124))),   # fresher replacement
            (1.0, srgb((186, 166, 128))),
        ])
        # Lengthwise fibres and grime (v runs along the strip in metres, u across).
        fib = N.noise(N.uv_scaled(30.0, 6.0), 4.0, 6.0, 0.7)
        fv = N.maprange(fib.outputs["Fac"], 0.3, 0.7, 0.72, 1.12)
        fc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(fv, fc.inputs[i])
        base = N.mix(1.0, base, fc.outputs[0], "MULTIPLY")
        grime = N.noise(N.obj(), 18.0, 4.0, 0.6)
        gm = N.maprange(grime.outputs["Fac"], 0.5, 0.75, 0.0, 0.45)
        base = N.mix(gm, base, srgb((70, 64, 56)), "MIX")
        # Rattan nodes every ~25 cm: darker, slightly raised.
        uvn = N.new("ShaderNodeTexCoord")
        sep = N.new("ShaderNodeSeparateXYZ")
        N.link(uvn.outputs["UV"], sep.inputs["Vector"])
        per = N.math("PINGPONG", N.math("ADD", sep.outputs["Y"], N.math("MULTIPLY", rnd, 0.3)), 0.13)
        node = N.maprange(per, 0.0, 0.006, 1.0, 0.0)
        base = N.mix(N.math("MULTIPLY", node, 0.5), base, srgb((90, 78, 60)), "MIX")
        base = ao_grime(N, base, 0.02, 0.6)
        N.link(base, bsdf.inputs["Base Color"])
        rgh = N.maprange(fib.outputs["Fac"], 0.3, 0.7, 0.4, 0.62)
        N.link(rgh, bsdf.inputs["Roughness"])
        bsdf.inputs["Specular IOR Level"].default_value = 0.45
        h = N.math("ADD", fib.outputs["Fac"], N.math("MULTIPLY", node, 0.6))
        N.link(N.bump(h, 0.35, 0.0006), bsdf.inputs["Normal"])
        N.link(bsdf.outputs[0], out.inputs["Surface"])

    # Modern white synthetic rope (the stays and sheets in the rigged photos).
    def rope(self, mat):
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        bsdf = N.new("ShaderNodeBsdfPrincipled")
        fib = N.noise(N.uv_scaled(40.0, 400.0), 3.0, 4.0, 0.6)
        fv = N.maprange(fib.outputs["Fac"], 0.3, 0.7, 0.8, 1.0)
        c = N.mix(1.0, srgb((214, 210, 200)), N.new("ShaderNodeCombineColor").outputs[0], "MIX") if False else None
        cc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(fv, cc.inputs[i])
        col = N.mix(1.0, srgb((205, 200, 190)), cc.outputs[0], "MULTIPLY")
        N.link(col, bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7
        bsdf.inputs["Sheen Weight"].default_value = 0.4
        bsdf.inputs["Subsurface Weight"].default_value = 0.15
        bsdf.inputs["Subsurface Radius"].default_value = (0.002, 0.002, 0.002)
        N.link(N.bump(fib.outputs["Fac"], 0.4, 0.0004), bsdf.inputs["Normal"])
        N.link(bsdf.outputs[0], out.inputs["Surface"])

    # Woven sea-hibiscus bark sail. In the rigged photos the mat reads as rows
    # of small rectangular blocks (the over-under of wide bark strips), tan
    # with darker and paler blocks, fibrous, with small light gaps.
    def sail(self, mat):
        # Woven bark strips in 2/2 twill: an image tile made by make_weave.py
        # (1 m square, UVs are in metres), weathered by large-scale noise.
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        bsdf = N.new("ShaderNodeBsdfPrincipled")
        vec = N.uv_scaled(1.0, 1.0)
        diff = N.img(self.G("sail_weave_diff"), vec)
        hgt = N.img(self.G("sail_weave_height"), vec, non_color=True)
        alp = N.img(self.G("sail_weave_alpha"), vec, non_color=True)
        col = diff.outputs["Color"]
        # Broad stains and sun fading, like the photos: darker brown patches
        # and paler bleached areas, streaking down the cloth.
        st = N.noise(N.uv_scaled(0.9, 0.35), 1.0, 5.0, 0.6)
        stm = N.maprange(st.outputs["Fac"], 0.5, 0.72, 0.0, 0.45)
        col = N.mix(stm, col, srgb((92, 66, 44)), "MULTIPLY")
        bl = N.noise(N.obj(), 0.8, 4.0, 0.55)
        blm = N.maprange(bl.outputs["Fac"], 0.48, 0.68, 0.0, 0.3)
        col = N.mix(blm, col, srgb((214, 196, 166)), "MIX")
        big = N.noise(N.obj(), 0.35, 2.0, 0.5)
        bv = N.maprange(big.outputs["Fac"], 0.3, 0.7, 0.88, 1.1)
        bc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(bv, bc.inputs[i])
        col = N.mix(1.0, col, bc.outputs[0], "MULTIPLY")
        N.link(col, bsdf.inputs["Base Color"])
        N.link(alp.outputs["Color"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 0.9
        bsdf.inputs["Sheen Weight"].default_value = 0.3
        N.link(N.bump(hgt.outputs["Color"], 0.8, 0.004), bsdf.inputs["Normal"])
        tr = N.new("ShaderNodeBsdfTranslucent")
        N.link(col, tr.inputs["Color"])
        mixs = N.new("ShaderNodeMixShader")
        mixs.inputs["Fac"].default_value = 0.25
        N.link(bsdf.outputs[0], mixs.inputs[1])
        N.link(tr.outputs[0], mixs.inputs[2])
        N.link(mixs.outputs[0], out.inputs["Surface"])

    # Woven split-bamboo deck mat: plain over-under, open weave with gaps.
    def deck(self, mat):
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        bsdf = N.new("ShaderNodeBsdfPrincipled")
        tc = N.new("ShaderNodeTexCoord")
        sep = N.new("ShaderNodeSeparateXYZ")
        N.link(tc.outputs["UV"], sep.inputs["Vector"])
        # Slight waviness so the strips are not ruler-straight.
        wob = N.noise(N.obj(), 3.0, 2.0, 0.5)
        wobv = N.math("MULTIPLY", N.math("SUBTRACT", wob.outputs["Fac"], 0.5), 0.012)
        pL, wL = 0.026, 0.020   # lengthwise strips: pitch, width (along x, stacked in y)
        pC, wC = 0.022, 0.016   # crosswise strips
        Xs = N.math("ADD", sep.outputs["X"], wobv)
        Ys = N.math("ADD", sep.outputs["Y"], wobv)
        iyL = N.math("FLOOR", N.math("DIVIDE", Ys, pL))
        fyL = N.math("FRACT", N.math("DIVIDE", Ys, pL))
        ixC = N.math("FLOOR", N.math("DIVIDE", Xs, pC))
        fxC = N.math("FRACT", N.math("DIVIDE", Xs, pC))
        inL = N.math("LESS_THAN", fyL, wL / pL)
        inC = N.math("LESS_THAN", fxC, wC / pC)
        par = N.math("MODULO", N.math("ADD", iyL, ixC), 2.0)
        par = N.math("ABSOLUTE", par)
        # Which strip shows: the lengthwise one where it is on top or where only it exists.
        showL = N.math("MAXIMUM", N.math("MULTIPLY", inL, N.math("SUBTRACT", 1.0, inC)), N.math("MULTIPLY", N.math("MULTIPLY", inL, inC), par))
        alpha = N.math("MAXIMUM", inL, inC)
        # Per-strip tone.
        wnL = N.new("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
        N.link(iyL, wnL.inputs["W"])
        wnC = N.new("ShaderNodeTexWhiteNoise", noise_dimensions="1D")
        N.link(N.math("ADD", ixC, 1000.0), wnC.inputs["W"])
        tone = N.mix(showL, wnC.outputs["Value"], wnL.outputs["Value"])
        tbw = N.new("ShaderNodeRGBToBW")
        N.link(tone, tbw.inputs["Color"])
        oi = N.new("ShaderNodeObjectInfo")
        panel = N.maprange(oi.outputs["Random"], 0.0, 1.0, 0.0, 1.0)
        t2 = N.math("FRACT", N.math("ADD", tbw.outputs["Val"], N.math("MULTIPLY", panel, 0.37)))
        col = N.ramp(t2, [
            (0.0, srgb((104, 96, 86))),
            (0.4, srgb((140, 134, 124))),
            (0.75, srgb((168, 160, 146))),
            (0.93, srgb((176, 160, 120))),
            (1.0, srgb((150, 150, 96))),  # an occasional greenish new strip
        ])
        # Strip profile: darker at the edges and where it dives under.
        profL = N.math("SINE", N.math("MULTIPLY", N.math("DIVIDE", fyL, wL / pL), math.pi))
        profC = N.math("SINE", N.math("MULTIPLY", N.math("DIVIDE", fxC, wC / pC), math.pi))
        prof = N.mix(showL, profC, profL)
        pbw = N.new("ShaderNodeRGBToBW")
        N.link(prof, pbw.inputs["Color"])
        pv = N.maprange(pbw.outputs["Val"], 0.0, 1.0, 0.55, 1.05)
        pc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(pv, pc.inputs[i])
        col = N.mix(1.0, col, pc.outputs[0], "MULTIPLY")
        fib = N.noise(N.uv_scaled(8.0, 120.0), 3.0, 4.0, 0.6)
        fv = N.maprange(fib.outputs["Fac"], 0.3, 0.7, 0.8, 1.1)
        fc = N.new("ShaderNodeCombineColor")
        for i in range(3):
            N.link(fv, fc.inputs[i])
        col = N.mix(1.0, col, fc.outputs[0], "MULTIPLY")
        N.link(col, bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.7
        N.link(alpha, bsdf.inputs["Alpha"])
        h = N.math("ADD", pbw.outputs["Val"], N.math("MULTIPLY", showL, 0.4))
        N.link(N.bump(h, 0.6, 0.002), bsdf.inputs["Normal"])
        N.link(bsdf.outputs[0], out.inputs["Surface"])

    def flat(self, mat, color, rough=0.9):
        N = Nodes(mat)
        out = N.new("ShaderNodeOutputMaterial")
        b = N.new("ShaderNodeBsdfPrincipled")
        b.inputs["Base Color"].default_value = (*color, 1)
        b.inputs["Roughness"].default_value = rough
        N.link(b.outputs[0], out.inputs["Surface"])


# ----------------------------------------------------------------------------- world and sets

def hdri_world(path, rotation_deg, strength=1.0):
    sc = bpy.context.scene
    world = bpy.data.worlds.new("HDRI")
    sc.world = world
    N = Nodes(world)
    out = N.new("ShaderNodeOutputWorld")
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(rotation_deg))
    N.link(tc.outputs["Generated"], mp.inputs["Vector"])
    env = N.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(path, check_existing=True)
    N.link(mp.outputs["Vector"], env.inputs["Vector"])
    bg = N.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    wb = N.new("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    wb.inputs["Factor"].default_value = 1.0
    wb.inputs["B"].default_value = (1.0, 0.96, 0.9, 1.0)
    N.link(env.outputs["Color"], wb.inputs["A"])
    N.link(wb.outputs["Result"], bg.inputs["Color"])
    N.link(bg.outputs[0], out.inputs["Surface"])
    return env.image


def hdri_sun_azimuth(img):
    """Azimuth (deg, Blender world, before rotation) and elevation of the brightest spot."""
    w, h = img.size
    small = img.copy()
    small.scale(256, 128)
    px = list(small.pixels)
    best, bi = -1.0, 0
    for i in range(0, len(px), 4):
        v = px[i] + px[i + 1] + px[i + 2]
        if v > best:
            best, bi = v, i // 4
    x, y = bi % 256, bi // 256
    u = (x + 0.5) / 256
    v = (y + 0.5) / 128
    # Blender equirect: u=0.5 looks along -y? For TexEnvironment, direction (x,y,z):
    # u = atan2(dir.y, -dir.x)/(2pi) + 0.5, v = atan2(dir.z, hypot(x,y))/pi + 0.5
    az = (u - 0.5) * 2 * math.pi
    el = (v - 0.5) * math.pi
    d = Vector((-math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    bpy.data.images.remove(small)
    return d


def sand_ground(S, assets, size=600.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = "Sand"
    m = bpy.data.materials.new("SandMat")
    N = Nodes(m)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / 4.5, 1 / 4.5, 1)
    N.link(tc.outputs["Object"], mp.inputs["Vector"])
    A = lambda n: os.path.join(assets, "tex", n + ".jpg")
    d = N.img(A("aerial_beach_01_diff_2k"), mp.outputs["Vector"])
    nm = N.img(A("aerial_beach_01_nor_gl_2k"), mp.outputs["Vector"], non_color=True)
    disp = N.img(A("aerial_beach_01_disp_2k"), mp.outputs["Vector"], non_color=True)
    # Match the HDRI's sand: warmer, a touch darker; broad patches; footprints as soft dents.
    hs = N.new("ShaderNodeHueSaturation")
    hs.inputs["Value"].default_value = 1.25
    hs.inputs["Saturation"].default_value = 0.8
    N.link(d.outputs["Color"], hs.inputs["Color"])
    col = N.mix(1.0, hs.outputs["Color"], srgb((255, 232, 198)), "MULTIPLY")
    big = N.noise(N.obj(), 0.08, 4.0, 0.6)
    bv = N.maprange(big.outputs["Fac"], 0.3, 0.7, 0.8, 1.1)
    bc = N.new("ShaderNodeCombineColor")
    for i in range(3):
        N.link(bv, bc.inputs[i])
    col = N.mix(1.0, col, bc.outputs[0], "MULTIPLY")
    N.link(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.95
    dents = N.new("ShaderNodeTexVoronoi", feature="SMOOTH_F1")
    dents.inputs["Scale"].default_value = 3.0
    N.link(N.obj(), dents.inputs["Vector"])
    dn = N.noise(N.obj(), 0.6, 3.0, 0.5)
    hgt = N.math("ADD", N.math("MULTIPLY", dents.outputs["Distance"], 1.0), N.math("MULTIPLY", dn.outputs["Fac"], 0.8))
    nrm = N.normal_map(nm.outputs["Color"], 0.35)
    nrm = N.bump(disp.outputs["Color"], 0.15, 0.01, nrm)
    nrm = N.bump(hgt, 0.6, 0.06, nrm)
    N.link(nrm, b.inputs["Normal"])
    N.link(b.outputs[0], out.inputs["Surface"])
    g.data.materials.append(m)
    return g


def ocean_surface(size=400.0):
    bpy.ops.mesh.primitive_plane_add(size=2)
    ocean = bpy.context.active_object
    ocean.name = "Ocean"
    mod = ocean.modifiers.new("Ocean", "OCEAN")
    mod.geometry_mode = "GENERATE"
    mod.resolution = 16
    mod.spatial_size = 50
    mod.repeat_x = 6
    mod.repeat_y = 6
    mod.wave_scale = 0.75
    mod.choppiness = 1.5
    mod.wind_velocity = 10
    mod.use_foam = True
    mod.foam_layer_name = "foam"
    mod.foam_coverage = 0.25
    mod.wave_alignment = 0.4
    mod.wave_direction = 0.6
    mod.time = 4.0
    mod.use_normals = True
    ocean.location = (-150, -150, 0)
    for p in ocean.data.polygons:
        p.use_smooth = True
    bpy.ops.mesh.primitive_plane_add(size=20000, location=(0, 0, -0.05))
    far = bpy.context.active_object
    far.name = "OceanFar"
    water = bpy.data.materials.new("Water")
    N = Nodes(water)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.01, 0.05, 0.06, 1)
    b.inputs["Roughness"].default_value = 0.07
    # Whitecaps from the ocean modifier's foam layer.
    fa = N.new("ShaderNodeAttribute", attribute_name="foam")
    fn = N.noise(N.obj(), 6.0, 6.0, 0.6)
    fm = N.math("MULTIPLY", N.maprange(fa.outputs["Fac"], 0.2, 0.9, 0.0, 1.0), N.maprange(fn.outputs["Fac"], 0.4, 0.65, 0.0, 1.0))
    foam = N.new("ShaderNodeBsdfDiffuse")
    foam.inputs["Color"].default_value = (0.8, 0.82, 0.82, 1)
    fmix = N.new("ShaderNodeMixShader")
    N.link(fm, fmix.inputs["Fac"])
    b.inputs["IOR"].default_value = 1.333
    b.inputs["Transmission Weight"].default_value = 1.0
    rip = N.noise(N.obj(), 1.4, 10.0, 0.6)
    rip2 = N.noise(N.obj(), 9.0, 6.0, 0.6)
    rip3 = N.noise(N.obj(), 0.25, 4.0, 0.55)
    rh = N.math("ADD", rip.outputs["Fac"], N.math("MULTIPLY", rip2.outputs["Fac"], 0.3))
    rh = N.math("ADD", rh, N.math("MULTIPLY", rip3.outputs["Fac"], 1.5))
    N.link(N.bump(rh, 0.5, 0.06), b.inputs["Normal"])
    vol = N.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.25, 0.6, 0.6, 1)
    vol.inputs["Density"].default_value = 0.9
    N.link(b.outputs[0], fmix.inputs[1])
    N.link(foam.outputs[0], fmix.inputs[2])
    N.link(fmix.outputs[0], out.inputs["Surface"])
    N.link(vol.outputs[0], out.inputs["Volume"])
    ocean.data.materials.append(water)
    far.data.materials.append(water)


# ----------------------------------------------------------------------------- main

def main():
    a = parse_args()
    meta = json.load(open(os.path.join(a.export_dir, "scene.json")))
    spec = meta["spec"]
    S = Shaders(a.export_dir, a.assets_dir)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(a.export_dir, "raft.glb"))

    # Gather the raft under one empty, bow along +x, centred.
    imported = [o for o in bpy.context.scene.objects]
    rig = bpy.data.objects.new("Raft", None)
    bpy.context.scene.collection.objects.link(rig)
    for o in imported:
        if o.parent is None:
            o.parent = rig
    rig.rotation_euler = (0, 0, -math.radians(spec["scene"]["heading_deg"]))
    bpy.context.view_layer.update()
    meshes = [o for o in imported if o.type == "MESH"]
    zs, xs, ys = [], [], []
    for o in meshes:
        mw = o.matrix_world
        vs = o.data.vertices
        for k in range(0, len(vs), max(1, len(vs) // 400)):
            w = mw @ vs[k].co
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    rig.location.x -= cx
    rig.location.y -= cy
    if a.set == "beach":
        # Hull bottom resting on (and pressed a little into) the sand.
        hull_z = min(zs)
        rig.location.z -= hull_z + 0.025
    else:
        # Afloat: a loaded bamboo raft swims low, culms about two-thirds under.
        bz = []
        for o in meshes:
            if not any(ms.material and ms.material.name.split(".")[0] == "bamboo" for ms in o.material_slots):
                continue
            mw = o.matrix_world
            vs = o.data.vertices
            for k in range(0, len(vs), max(1, len(vs) // 400)):
                bz.append((mw @ vs[k].co).z)
        rig.location.z -= (min(bz) if bz else min(zs)) + 0.105
        # A little heel to leeward and bow-down trim under sail.
        rig.rotation_euler = (math.radians(1.6), math.radians(0.6), rig.rotation_euler[2])
    bpy.context.view_layer.update()

    for m in list(bpy.data.materials):
        base = m.name.split(".")[0]
        if base == "bamboo":
            S.bamboo(m)
        elif base in ("mast", "rail", "keel"):
            S.bamboo(m, palette=base)
        elif base in ("branch",):
            S.wood(m, around=0.22, value=1.45, sat=0.25)
        elif base in ("wood", "log"):
            S.wood(m, around=0.7, value=0.95)
        elif base == "oar":
            S.wood(m, around=0.18, value=1.15, smooth=True)
        elif base == "rattan":
            S.rattan(m)
        elif base == "rope":
            S.rope(m)
        elif base == "sail":
            S.sail(m)
        elif base == "deck":
            S.deck(m)
        elif base == "crack":
            S.flat(m, (0.01, 0.009, 0.008))
    for o in meshes:
        for p in o.data.polygons:
            p.use_smooth = True
        # Rails and keels are bamboo too, but paler / warmer: detect by name of geometry later.

    sc = bpy.context.scene
    if a.set == "beach":
        img = hdri_world(os.path.join(a.assets_dir, "hdri", "spiaggia_di_mondello_4k.hdr"), rotation_deg=0, strength=1.0)
        sand_ground(S, a.assets_dir)
    else:
        img = hdri_world(os.path.join(a.assets_dir, "hdri", "qwantani_afternoon_puresky_4k.hdr"), rotation_deg=0, strength=1.0)
        ocean_surface()
    sun_dir = hdri_sun_azimuth(img)
    az0 = math.degrees(math.atan2(sun_dir.y, sun_dir.x))
    default_sun = a.sun_az if a.sun_az is not None else (95.0 if a.set == "beach" else 120.0)
    mapping = sc.world.node_tree.nodes["Mapping"]

    def set_sun(want):
        mapping.inputs["Rotation"].default_value = (0, 0, math.radians(want - az0))
        print("hdri sun az", round(az0, 1), "el", round(math.degrees(math.asin(sun_dir.z)), 1), "-> rotated to", want, flush=True)

    cy_ = sc.cycles
    sc.render.engine = "CYCLES"
    cy_.device = "CPU"
    cy_.samples = a.samples
    cy_.use_adaptive_sampling = True
    cy_.adaptive_threshold = 0.015
    cy_.use_denoising = True
    cy_.denoiser = "OPENIMAGEDENOISE"
    cy_.max_bounces = 8
    cy_.diffuse_bounces = 4
    cy_.glossy_bounces = 4
    cy_.transmission_bounces = 8
    cy_.transparent_max_bounces = 16
    cy_.caustics_reflective = False
    cy_.caustics_refractive = False
    cy_.blur_glossy = 1.0
    w, h = (int(v) for v in a.res.split("x"))
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    cam_data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.sensor_width = 36
    cam_data.clip_start = 0.02
    cam_data.clip_end = 30000

    views = camera_views(a.set, rig)
    os.makedirs(a.out_dir, exist_ok=True)
    if a.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out_dir, f"raft_{a.set}.blend"))
    for name in a.views.split(","):
        v = views[name]
        cam.location = Vector(v["pos"])
        tgt = Vector(v["target"])
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = v.get("lens", 35)
        cam_data.dof.use_dof = v.get("dof", False)
        cam_data.dof.focus_distance = (tgt - cam.location).length
        cam_data.dof.aperture_fstop = v.get("fstop", 5.6)
        sc.view_settings.exposure = v.get("exposure", 0.0)
        set_sun(a.sun_az if a.sun_az is not None else v.get("sun", default_sun))
        sc.render.filepath = os.path.join(a.out_dir, f"{a.set}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name, flush=True)


def camera_views(set_name, rig):
    """Cameras in Blender world metres. The raft is centred, bow toward +x, port toward +y."""
    L = 4.6  # half length, roughly
    z0 = 0.0 if set_name == "beach" else 0.0
    return {
        # Three-quarter view from off the port bow, eye height.
        "hero": {"sun": 25, "pos": (5.4, 6.0, 1.0), "target": (-0.8, 0.0, 2.6), "lens": 20},
        "side": {"pos": (0.0, 15.0, 1.6), "target": (0.0, 0.0, 2.6), "lens": 28},
        # Matches the rigged car-park photo: low, near the port quarter, bow to the left.
        "photo_side": {"pos": (1.2, 10.5, 1.2), "target": (0.4, 0.0, 3.0), "lens": 22},
        # Matches the new photo: from off the starboard bow, looking aft.
        "photo_bow": {"pos": (9.0, -6.5, 1.5), "target": (-0.5, 0.0, 3.2), "lens": 26},
        "stern3q": {"pos": (-9.0, -7.5, 1.7), "target": (0.0, 0.0, 2.0), "lens": 30},
        "bow": {"pos": (6.4, 2.2, 0.9), "target": (3.6, 0.2, 0.45), "lens": 35, "dof": True, "fstop": 4.0},
        "oarpost": {"pos": (-1.6, 2.4, 1.5), "target": (-3.1, 0.8, 0.5), "lens": 32, "dof": True, "fstop": 5.6, "sun": 60},
        # Looking down on a post from inboard, like reference photo 23.
        "oarpost_top": {"pos": (-2.6, -0.1, 1.9), "target": (-3.2, 0.75, 0.45), "lens": 30, "dof": True, "fstop": 5.6, "sun": 60},
        "rattan": {"pos": (-1.0, 1.55, 0.75), "target": (-1.5, 0.95, 0.38), "lens": 50, "dof": True, "fstop": 2.8, "sun": 80},
        "keel": {"pos": (-1.0, -2.6, 0.45), "target": (-2.8, -0.95, 0.2), "lens": 35, "dof": True, "fstop": 4.0, "sun": -100},
        "sailclose": {"pos": (2.5, 6.0, 2.6), "target": (-0.8, 0.0, 3.2), "lens": 35},
        # Matches reference photo 3: standing on the stern, looking forward along the deck.
        "deck": {"pos": (-5.4, -0.5, 1.75), "target": (2.0, 0.1, 0.35), "lens": 24, "sun": 150},
        "top": {"pos": (0.0, 0.01, 16.0), "target": (0.0, 0.0, 0.0), "lens": 35},
        # Afloat: low over the water off the port bow, and a longer lens from abeam.
        "sea_hero": {"pos": (-9.5, 10.0, 1.0), "target": (0.3, 0.0, 2.6), "lens": 28, "sun": 150},
        "sea_abeam": {"pos": (-2.0, 22.0, 1.4), "target": (0.0, 0.0, 2.8), "lens": 45, "sun": 70},
        "sea_stern": {"pos": (-12.0, -7.0, 1.1), "target": (0.0, 0.0, 2.4), "lens": 32, "sun": -60},
    }


if __name__ == "__main__":
    main()
