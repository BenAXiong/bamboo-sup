"""
Photoreal Cycles render of the raft exported from the beauty scene.

Usage (Blender's Python, or the `bpy` wheel):
    python render_raft.py EXPORT_DIR OUT_DIR [--views hero,rattan] [--samples 128]
                          [--res 1600x900] [--no-env]

EXPORT_DIR holds what `exportForBlender()` in simulator/scene produces:
    raft.glb      the raft, metres, y up, at its floating draft and heading
    tex/*.png     the procedural textures painted by the scene
    scene.json    camera views (Three.js world space), the raft spec, the FOV

The raft geometry comes from the generator unchanged. This script only adds
what a path tracer does better: physically based shaders for bamboo, rattan,
rope and the woven bark sail, an ocean, a beach and seabed, a coastal range and
a physical sky, then renders the requested views.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector


# ----------------------------------------------------------------------------- args

def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("export_dir")
    p.add_argument("out_dir")
    p.add_argument("--views", default="hero,rattan,bow")
    p.add_argument("--samples", type=int, default=128)
    p.add_argument("--res", default="1600x900")
    p.add_argument("--no-env", action="store_true", help="skip beach and hills (faster close-ups)")
    p.add_argument("--save-blend", action="store_true")
    return p.parse_args(argv)


def three_to_blender(v):
    """Three.js world (x, y up, z) -> Blender (x, y, z up)."""
    return Vector((v[0], -v[2], v[1]))


# ----------------------------------------------------------------------------- node helpers

class Nodes:
    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
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
        self.x += 220
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)


def image(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def tex(N, path, scale=(1.0, 1.0), non_color=False):
    uv = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale[0], scale[1], 1.0)
    N.link(uv.outputs["UV"], mp.inputs["Vector"])
    t = N.new("ShaderNodeTexImage")
    t.image = image(path, non_color)
    t.interpolation = "Cubic"
    N.link(mp.outputs["Vector"], t.inputs["Vector"])
    return t


def obj_coords(N, *nodes):
    """Drive procedural textures from object-space metres instead of the bounding box."""
    tc = N.new("ShaderNodeTexCoord")
    for n in nodes:
        N.link(tc.outputs["Object"], n.inputs["Vector"])


def saturate(N, color, s=1.3, v=1.0):
    hs = N.new("ShaderNodeHueSaturation", in_Saturation=s, in_Value=v)
    N.link(color, hs.inputs["Color"])
    return hs.outputs["Color"]


def mul(N, a, b):
    m = N.new("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
    m.inputs["Factor"].default_value = 1.0
    N.link(a, m.inputs["A"])
    if isinstance(b, (tuple, list)):
        m.inputs["B"].default_value = (*b, 1.0)
    else:
        N.link(b, m.inputs["B"])
    return m.outputs["Result"]


# ----------------------------------------------------------------------------- raft shaders

def shade_bamboo(mat, T, dark=1.0):
    N = Nodes(mat)
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    col = N.new("ShaderNodeVertexColor", layer_name="Color")
    img = tex(N, T("bamboo_color"))
    base = mul(N, col.outputs["Color"], img.outputs["Color"])
    if dark != 1.0:
        base = mul(N, base, (dark, dark, dark))
    base = saturate(N, base, 1.45)
    # Fibre streaks along the culm (v runs along it) and fine dark specks.
    uvc = N.new("ShaderNodeTexCoord")
    sc_ = N.new("ShaderNodeMapping")
    sc_.inputs["Scale"].default_value = (40.0, 1.5, 1.0)
    N.link(uvc.outputs["UV"], sc_.inputs["Vector"])
    fib = N.new("ShaderNodeTexNoise", in_Scale=6.0, in_Detail=6.0, in_Roughness=0.7)
    N.link(sc_.outputs["Vector"], fib.inputs["Vector"])
    fibv = N.new("ShaderNodeMapRange", in_To_Min=0.82, in_To_Max=1.12)
    N.link(fib.outputs["Fac"], fibv.inputs["Value"])
    base = mul(N, base, fibv.outputs["Result"])
    speck = N.new("ShaderNodeTexVoronoi", in_Scale=220.0)
    obj_coords(N, speck)
    spk = N.new("ShaderNodeMapRange", in_From_Min=0.0, in_From_Max=0.08, in_To_Min=0.55, in_To_Max=1.0)
    N.link(speck.outputs["Distance"], spk.inputs["Value"])
    base = mul(N, base, spk.outputs["Result"])
    # Fine pores and silica sheen: the peeled surface is satin, not matte.
    pores = N.new("ShaderNodeTexNoise", in_Scale=900.0, in_Detail=2.0)
    obj_coords(N, pores)
    rough = N.new("ShaderNodeMapRange", in_To_Min=0.38, in_To_Max=0.62)
    N.link(pores.outputs["Fac"], rough.inputs["Value"])
    N.link(base, bsdf.inputs["Base Color"])
    N.link(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.32
    bmp_img = tex(N, T("bamboo_bump"), non_color=True)
    b1 = N.new("ShaderNodeBump", in_Strength=0.35, in_Distance=0.0015)
    N.link(bmp_img.outputs["Color"], b1.inputs["Height"])
    b2 = N.new("ShaderNodeBump", in_Strength=0.12, in_Distance=0.0004)
    N.link(pores.outputs["Fac"], b2.inputs["Height"])
    b3 = N.new("ShaderNodeBump", in_Strength=0.2, in_Distance=0.0006)
    N.link(fib.outputs["Fac"], b3.inputs["Height"])
    N.link(b2.outputs["Normal"], b3.inputs["Normal"])
    N.link(b1.outputs["Normal"], b2.inputs["Normal"])
    N.link(b3.outputs["Normal"], bsdf.inputs["Normal"])
    N.link(bsdf.outputs[0], out.inputs["Surface"])


def shade_rattan(mat, T):
    N = Nodes(mat)
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    img = tex(N, T("rattan_color"), scale=(1, 1 / 0.3))
    base = mul(N, img.outputs["Color"], (0.5, 0.31, 0.11))
    # Each strip a slightly different shade, as split rattan always is.
    geo = N.new("ShaderNodeNewGeometry")
    var = N.new("ShaderNodeMapRange", in_To_Min=0.7, in_To_Max=1.15)
    N.link(geo.outputs["Random Per Island"], var.inputs["Value"])
    base = mul(N, base, var.outputs["Result"])
    N.link(base, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.32
    bsdf.inputs["Coat Weight"].default_value = 0.4
    bsdf.inputs["Coat Roughness"].default_value = 0.25
    # Rattan skin is glossy with fine lengthwise ribs.
    ribs = N.new("ShaderNodeTexWave", wave_type="BANDS", bands_direction="X", in_Scale=60.0, in_Distortion=2.0, in_Detail=3.0)
    bmp = N.new("ShaderNodeBump", in_Strength=0.25, in_Distance=0.0006)
    N.link(ribs.outputs["Fac"], bmp.inputs["Height"])
    N.link(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    N.link(bsdf.outputs[0], out.inputs["Surface"])


def shade_rope(mat, T):
    N = Nodes(mat)
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    fib = tex(N, T("rope_bump"), scale=(3, 1 / 0.02), non_color=True)
    base = N.new("ShaderNodeMapRange", in_To_Min=0.55, in_To_Max=1.0)
    N.link(fib.outputs["Color"], base.inputs["Value"])
    c = mul(N, base.outputs["Result"], (0.21, 0.15, 0.085))
    N.link(c, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Sheen Weight"].default_value = 0.25
    bsdf.inputs["Sheen Roughness"].default_value = 0.5
    bmp = N.new("ShaderNodeBump", in_Strength=0.6, in_Distance=0.0008)
    N.link(fib.outputs["Color"], bmp.inputs["Height"])
    N.link(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    N.link(bsdf.outputs[0], out.inputs["Surface"])


def shade_sail(mat, T):
    N = Nodes(mat)
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    img = tex(N, T("sail_color"), scale=(1 / 0.6, 1 / 0.6))
    N.link(img.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Sheen Weight"].default_value = 0.3
    bmp_img = tex(N, T("sail_bump"), scale=(1 / 0.6, 1 / 0.6), non_color=True)
    bmp = N.new("ShaderNodeBump", in_Strength=0.8, in_Distance=0.004)
    N.link(bmp_img.outputs["Color"], bmp.inputs["Height"])
    N.link(bmp.outputs["Normal"], bsdf.inputs["Normal"])
    # Bark cloth glows a little when the sun is behind it.
    tr = N.new("ShaderNodeBsdfTranslucent")
    N.link(img.outputs["Color"], tr.inputs["Color"])
    mix = N.new("ShaderNodeMixShader", in_Fac=0.18)
    N.link(bsdf.outputs[0], mix.inputs[1])
    N.link(tr.outputs[0], mix.inputs[2])
    N.link(mix.outputs[0], out.inputs["Surface"])


# ----------------------------------------------------------------------------- environment

def shoreline(x, offshore):
    # Same bays as environment.ts, in Blender's frame (inland is +y).
    return offshore + 6 * math.sin(x / 70) + 3 * math.sin(x / 23 + 1.3)


def smooth(x, a, b):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def grid_object(name, x0, x1, y0, y1, nx, ny, height):
    verts, faces = [], []
    for j in range(ny + 1):
        y = y0 + (y1 - y0) * j / ny
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            verts.append((x, y, height(x, y)))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def build_environment(spec, with_land=True):
    offshore = spec["scene"]["offshore_m"]

    # Ocean: real wave spectrum near the raft, a flat sheet to the horizon.
    bpy.ops.mesh.primitive_plane_add(size=2)
    ocean = bpy.context.active_object
    ocean.name = "Ocean"
    mod = ocean.modifiers.new("Ocean", "OCEAN")
    mod.geometry_mode = "GENERATE"
    mod.resolution = 14
    mod.spatial_size = 40
    mod.repeat_x = 8
    mod.repeat_y = 8
    mod.wave_scale = 0.35 * spec["scene"]["wave_strength"]
    mod.choppiness = 0.9
    mod.wind_velocity = 6
    mod.wave_alignment = 0.3
    mod.wave_direction = 0.8
    mod.time = 3.0
    mod.use_normals = True
    ocean.location = (-160, -160, 0)
    for p in ocean.data.polygons:
        p.use_smooth = True

    bpy.ops.mesh.primitive_plane_add(size=8000, location=(0, 0, -0.02))
    far = bpy.context.active_object
    far.name = "OceanFar"

    water = bpy.data.materials.new("Water")
    N = Nodes(water)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.02, 0.09, 0.1, 1)
    b.inputs["Roughness"].default_value = 0.02
    b.inputs["IOR"].default_value = 1.333
    b.inputs["Transmission Weight"].default_value = 1.0
    ripple = N.new("ShaderNodeTexNoise", in_Scale=3.0, in_Detail=8.0, in_Roughness=0.6)
    bmp = N.new("ShaderNodeBump", in_Strength=0.08, in_Distance=0.02)
    N.link(ripple.outputs["Fac"], bmp.inputs["Height"])
    N.link(bmp.outputs["Normal"], b.inputs["Normal"])
    N.link(b.outputs[0], out.inputs["Surface"])
    ocean.data.materials.append(water)
    far.data.materials.append(water)

    if not with_land:
        bed = grid_object("Seabed", -200, 200, -200, 60, 40, 26, lambda x, y: -4.0)
        bed.data.materials.append(sand_material())
        return

    def ground(x, y):
        q = y - shoreline(x, offshore)
        if q < 0:
            h = q * 0.045 - max(0.0, -q - 60) * 0.05
            h += 0.08 * math.sin(-y * 0.9 + x * 0.12) * min(1.0, -q / 10)
        else:
            h = q * 0.055 + 0.6 * smooth(q, 22, 32) + min(14.0, max(0.0, q - 55) * 0.3)
        return h

    beach = grid_object("Beach", -900, 900, -400, 140, 360, 200, ground)
    beach.data.materials.append(sand_material())

    def hill(x, y):
        q = y - shoreline(x, offshore)
        n = 0.5 + 0.5 * math.sin(x / 310.0) * math.cos(x / 173.0 + 0.7)
        ridge = 1 - abs(math.sin(x / 260.0 + math.sin(x / 97.0)))
        return 14 + smooth(q, 500, 1500) * (140 + 300 * ridge + 120 * n)

    hills = grid_object("Hills", -3000, 3000, 120, 2600, 300, 120, hill)
    hills.data.materials.append(hill_material())


def sand_material():
    m = bpy.data.materials.get("Sand")
    if m:
        return m
    m = bpy.data.materials.new("Sand")
    N = Nodes(m)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    N.link(geo.outputs["Position"], sep.inputs["Vector"])
    # Wet band above the waterline, absorption darkening below it.
    wet = N.new("ShaderNodeMapRange", in_From_Min=0.05, in_From_Max=0.45, in_To_Min=0.0, in_To_Max=1.0)
    N.link(sep.outputs["Z"], wet.inputs["Value"])
    ramp = N.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.09, 0.08, 0.065, 1)
    els[1].position, els[1].color = 1.0, (0.24, 0.215, 0.17, 1)
    N.link(wet.outputs["Result"], ramp.inputs["Fac"])
    deep = N.new("ShaderNodeMapRange", in_From_Min=0.0, in_From_Max=-5.0)
    N.link(sep.outputs["Z"], deep.inputs["Value"])
    mix = N.new("ShaderNodeMix", data_type="RGBA")
    mix.inputs["B"].default_value = (0.02, 0.07, 0.07, 1)
    N.link(deep.outputs["Result"], mix.inputs["Factor"])
    N.link(ramp.outputs["Color"], mix.inputs["A"])
    grain = N.new("ShaderNodeTexNoise", in_Scale=300.0, in_Detail=2.0)
    pebbles = N.new("ShaderNodeTexVoronoi", in_Scale=22.0)
    patches = N.new("ShaderNodeTexNoise", in_Scale=0.15, in_Detail=4.0)
    obj_coords(N, grain, pebbles, patches)
    gmul = N.new("ShaderNodeMapRange", in_To_Min=0.8, in_To_Max=1.1)
    N.link(grain.outputs["Fac"], gmul.inputs["Value"])
    col = mul(N, mix.outputs["Result"], gmul.outputs["Result"])
    # Each pebble its own grey: East Coast beaches are mixed sand and stones.
    stone = N.new("ShaderNodeMapRange", in_To_Min=0.55, in_To_Max=1.25)
    N.link(pebbles.outputs["Color"], stone.inputs["Value"])
    col = mul(N, col, stone.outputs["Result"])
    pmul = N.new("ShaderNodeMapRange", in_To_Min=0.75, in_To_Max=1.15)
    N.link(patches.outputs["Fac"], pmul.inputs["Value"])
    col = mul(N, col, pmul.outputs["Result"])
    N.link(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.92
    bm = N.new("ShaderNodeBump", in_Strength=0.4, in_Distance=0.003)
    N.link(grain.outputs["Fac"], bm.inputs["Height"])
    bm2 = N.new("ShaderNodeBump", in_Strength=0.3, in_Distance=0.01)
    N.link(pebbles.outputs["Distance"], bm2.inputs["Height"])
    N.link(bm.outputs["Normal"], bm2.inputs["Normal"])
    N.link(bm2.outputs["Normal"], b.inputs["Normal"])
    N.link(b.outputs[0], out.inputs["Surface"])
    return m


def hill_material():
    m = bpy.data.materials.new("Hills")
    N = Nodes(m)
    out = N.new("ShaderNodeOutputMaterial")
    b = N.new("ShaderNodeBsdfPrincipled")
    canopy = N.new("ShaderNodeTexNoise", in_Scale=0.12, in_Detail=12.0, in_Roughness=0.7)
    obj_coords(N, canopy)
    ramp = N.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].color = (0.006, 0.016, 0.006, 1)
    els[1].color = (0.05, 0.085, 0.025, 1)
    els[0].position = 0.35
    els[1].position = 0.7
    N.link(canopy.outputs["Fac"], ramp.inputs["Fac"])
    # Aerial perspective: fade toward the haze colour with distance from the camera.
    cam = N.new("ShaderNodeCameraData")
    haze = N.new("ShaderNodeMapRange", in_From_Min=200.0, in_From_Max=3500.0, in_To_Min=0.0, in_To_Max=0.85)
    N.link(cam.outputs["View Distance"], haze.inputs["Value"])
    mix = N.new("ShaderNodeMix", data_type="RGBA")
    mix.inputs["B"].default_value = (0.2, 0.25, 0.32, 1)
    N.link(haze.outputs["Result"], mix.inputs["Factor"])
    N.link(ramp.outputs["Color"], mix.inputs["A"])
    N.link(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 1.0
    bm = N.new("ShaderNodeBump", in_Strength=0.6)
    N.link(canopy.outputs["Fac"], bm.inputs["Height"])
    N.link(bm.outputs["Normal"], b.inputs["Normal"])
    em = N.new("ShaderNodeEmission", in_Strength=1.0)
    N.link(mix.outputs["Result"], em.inputs["Color"])
    sh = N.new("ShaderNodeMixShader")
    N.link(haze.outputs["Result"], sh.inputs["Fac"])
    N.link(b.outputs[0], sh.inputs[1])
    N.link(em.outputs[0], sh.inputs[2])
    N.link(sh.outputs[0], out.inputs["Surface"])
    return m


def build_sky(spec):
    el = math.radians(spec["scene"]["sun_elevation_deg"])
    az = math.radians(spec["scene"]["sun_azimuth_deg"])
    # Three.js sun: setFromSphericalCoords(1, 90-el, az) -> Blender frame.
    phi = math.pi / 2 - el
    d3 = (math.sin(phi) * math.sin(az), math.cos(phi), math.sin(phi) * math.cos(az))
    sun_dir = three_to_blender(d3).normalized()

    sc = bpy.context.scene
    world = bpy.data.worlds.new("Sky")
    sc.world = world
    N = Nodes(world)
    out = N.new("ShaderNodeOutputWorld")
    bg = N.new("ShaderNodeBackground", in_Strength=0.3)
    sky = N.new("ShaderNodeTexSky", sky_type="MULTIPLE_SCATTERING")
    sky.sun_elevation = el
    # Measured: rotation 0 puts the sun toward +y, 90 degrees toward +x.
    sky.sun_rotation = math.atan2(sun_dir.x, sun_dir.y)
    sky.sun_disc = False  # the sun lamp provides direct light; a disc too would double it
    sky.air_density = 1.2
    sky.aerosol_density = 2.5
    N.link(sky.outputs[0], bg.inputs["Color"])
    N.link(bg.outputs[0], out.inputs["Surface"])

    light = bpy.data.lights.new("Sun", "SUN")
    light.energy = 3.6
    light.angle = math.radians(0.6)
    w = min(1.0, spec["scene"]["sun_elevation_deg"] / 35)
    light.color = (1.0, 0.8 + 0.18 * w, 0.62 + 0.34 * w)
    ob = bpy.data.objects.new("Sun", light)
    sc.collection.objects.link(ob)
    ob.rotation_euler = sun_dir.to_track_quat("Z", "Y").to_euler()


# ----------------------------------------------------------------------------- main

def main():
    a = parse_args()
    meta = json.load(open(os.path.join(a.export_dir, "scene.json")))
    spec = meta["spec"]
    T = lambda name: os.path.join(a.export_dir, "tex", name + ".png")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(a.export_dir, "raft.glb"))

    for m in list(bpy.data.materials):
        base = m.name.split(".")[0]
        if base == "bamboo":
            shade_bamboo(m, T)
        elif base == "wood":
            shade_bamboo(m, T, dark=0.55)
        elif base == "rattan":
            shade_rattan(m, T)
        elif base == "rope":
            shade_rope(m, T)
        elif base == "sail":
            shade_sail(m, T)
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            for p in ob.data.polygons:
                p.use_smooth = True

    build_environment(spec, with_land=not a.no_env)
    build_sky(spec)

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = a.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 10
    cy.transmission_bounces = 8
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    w, h = (int(v) for v in a.res.split("x"))
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    sc.view_settings.exposure = 0.0

    cam_data = bpy.data.cameras.new("Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.sensor_fit = "VERTICAL"
    cam_data.clip_start = 0.02
    cam_data.clip_end = 20000

    os.makedirs(a.out_dir, exist_ok=True)
    if a.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out_dir, "raft.blend"))

    for name in a.views.split(","):
        v = meta["views"][name]
        pos = three_to_blender(v["pos"])
        tgt = three_to_blender(v["target"])
        cam.location = pos
        cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
        close = (tgt - pos).length < 3
        cam_data.angle_y = math.radians(30 if close else meta.get("fov", 38))
        cam_data.dof.use_dof = close
        cam_data.dof.focus_distance = (tgt - pos).length
        cam_data.dof.aperture_fstop = 2.8
        sc.render.filepath = os.path.join(a.out_dir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", name, flush=True)


if __name__ == "__main__":
    main()
