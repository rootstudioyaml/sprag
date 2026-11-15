"""F2 experiment: bakes plush-fur sprites of the seated cast models with Cycles.

  Blender -b --factory-startup --python bake_fur.py -- --out DIR --keys cat,chick [--az=-35,-17,0,17,35]

For every species it grows short hair curves on the furry part of the body (the `chibi` mesh minus clothes,
plus a few flat coloured parts such as wings and tail tips), lights it with a world-fixed rig that copies the
office (warm sun, cool rim from behind, sky/ground ambient) and renders one orthographic frame per azimuth.
Frames share one pivot and one ortho scale, so a camera-facing quad in three.js lines up with the 3D model.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))  # tools/blender/sprites -> repository root
CAST = os.path.join(REPO, 'site', 'assets', 'scene', 'cast')
ELEV = math.degrees(math.atan2(16.6, math.hypot(20.0, 20.0)))  # office phi0: 30.41 degrees above the floor
AZ0 = 45.0  # office theta0
FURRY_FACE = ('wing', 'wingc', 'tailf', 'tailtip')  # flat coloured parts of the `face` mesh that get fur too


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True)
    p.add_argument('--keys', default='cat')
    p.add_argument('--az', default='-35,-17,0,17,35')
    p.add_argument('--px', type=int, default=768, help='render size per frame (downsampled to --cell)')
    p.add_argument('--cell', type=int, default=384)
    p.add_argument('--samples', type=int, default=96)
    p.add_argument('--ortho', type=float, default=1.9)
    p.add_argument('--pivot', type=float, default=0.55, help='pivot height on the model axis (model units)')
    p.add_argument('--count', type=int, default=320000, help='strands per species before masking')
    p.add_argument('--len', dest='length', type=float, default=0.036)
    p.add_argument('--radius', type=float, default=0.0030)
    p.add_argument('--jitter', type=float, default=0.42)
    p.add_argument('--lift', type=float, default=1.0, help='fur colour exponent, below 1 brightens (strands shadow each other)')
    p.add_argument('--root', type=float, default=0.70, help='root darkening of a strand')
    p.add_argument('--ysat', type=float, default=0.0, help='extra exponent for saturated yellows, which the hair BSDF pushes toward lime')
    p.add_argument('--sat', type=float, default=1.0, help='channel ratio exponent at constant value: the hair BSDF washes warm hues toward yellow-green')
    p.add_argument('--curl', type=float, default=0.25)
    p.add_argument('--shader', choices=['hair', 'diff'], default='hair')
    p.add_argument('--nofur', action='store_true')
    p.add_argument('--denoise', type=int, default=1)
    p.add_argument('--exposure', type=float, default=0.0)
    p.add_argument('--sun', type=float, default=2.4)
    p.add_argument('--rim', type=float, default=2.2)
    p.add_argument('--sky', type=float, default=0.55)
    p.add_argument('--tag', default='')
    p.add_argument('--extents', action='store_true', help='only print the projected extents, no render')
    p.add_argument('--maskdebug', action='store_true', help='paint clothes strands magenta')
    return p.parse_args(argv)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexlin(h):
    h = h.lstrip('#')
    return tuple(float(v) for v in srgb2lin([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]))


def oklab(lin):
    """linear sRGB (n,3) -> OKLab (n,3)"""
    m1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])
    m2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099], [0.0259040371, 0.7827717662, -0.8086757660]])
    lms = np.cbrt(np.clip(lin @ m1.T, 0, None))
    return lms @ m2.T


def setup_device(scene):
    cy = scene.cycles
    cy.device = 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == 'METAL']
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        if gpus:
            cy.device = 'GPU'
            return 'METAL GPU (%s)' % ', '.join(d.name for d in gpus)
    except Exception as e:
        print('GPU setup failed, using CPU:', e)
    return 'CPU'


def unit_dir(az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def aim(obj, direction):
    """point the object's -Z along `direction`"""
    obj.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()


def setup_scene(a):
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
        for item in list(coll):
            coll.remove(item)
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    cy.samples = a.samples
    cy.use_adaptive_sampling = False
    cy.use_denoising = bool(a.denoise)
    if a.denoise:
        cy.denoiser = 'OPENIMAGEDENOISE'
        cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
        cy.denoising_prefilter = 'ACCURATE'
    cy.max_bounces = 12
    cy.diffuse_bounces = 4
    cy.glossy_bounces = 6
    cy.transmission_bounces = 12
    cy.transparent_max_bounces = 16
    cy.sample_clamp_indirect = 6.0
    cy.film_exposure = 2.0 ** a.exposure
    scene.cycles_curves.shape = 'RIBBONS'
    scene.cycles_curves.subdivisions = 2
    scene.render.film_transparent = True
    scene.render.use_persistent_data = True  # only the camera moves between the frames of a species: keep the curve BVH
    scene.render.resolution_x = scene.render.resolution_y = a.px
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    device = setup_device(scene)

    # ambient: the office hemisphere (sky '#f3f1ff', ground '#e8dcc4') as a vertical gradient
    world = bpy.data.worlds.new('office-sky')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 1.0
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = hexlin('#e8dcc4') + (1.0,)
    mix.inputs['B'].default_value = hexlin('#f3f1ff') + (1.0,)
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = a.sky
    scene.world = world

    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = a.ortho
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def sun(name, hexcol, strength, from_three, angle_deg):
        d = bpy.data.lights.new(name, 'SUN')
        d.color = hexlin(hexcol)
        d.energy = strength
        d.angle = math.radians(angle_deg)
        o = bpy.data.objects.new(name, d)
        scene.collection.objects.link(o)
        x, y, z = from_three  # three.js (x, y up, z) -> Blender (x, -z, y)
        aim(o, -Vector((x, -z, y)))
        return o

    # world-fixed, like the office: the camera turns, the lights stay
    sun('key', '#fff0d4', a.sun, (8, 18, 6), 28.0)       # office sun, softened into a studio key
    sun('rim', '#e6ecff', a.rim, (-10, 10, -10), 18.0)   # office rim from behind the default camera
    return scene, cam, device


def mesh_arrays(o):
    me = o.data
    me.calc_loop_triangles()
    nv, nl, ntri = len(me.vertices), len(me.loops), len(me.loop_triangles)
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    m = np.array(o.matrix_world, dtype=np.float64)
    rot, tr = m[:3, :3], m[:3, 3]
    co = co.reshape(nv, 3).astype(np.float64) @ rot.T + tr
    tv = np.empty(ntri * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', tv)
    tl = np.empty(ntri * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('loops', tl)
    tm = np.empty(ntri, dtype=np.int32)
    me.loop_triangles.foreach_get('material_index', tm)
    cn = np.empty(nl * 3, dtype=np.float32)
    me.corner_normals.foreach_get('vector', cn)
    cn = cn.reshape(nl, 3).astype(np.float64) @ np.linalg.inv(rot)  # (R^-1)^T applied on the right
    cn /= np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-9)
    uv = None
    if me.uv_layers:
        uv = np.empty(nl * 2, dtype=np.float32)
        try:
            me.uv_layers[0].uv.foreach_get('vector', uv)
        except Exception:
            me.uv_layers[0].data.foreach_get('uv', uv)
        uv = uv.reshape(nl, 2).astype(np.float64)
    return dict(co=co, tv=tv.reshape(ntri, 3), tl=tl.reshape(ntri, 3), tm=tm, cn=cn, uv=uv, mats=[s.material for s in o.material_slots])


def skin_image(mat):
    for nd in mat.node_tree.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image and any(l.to_socket.name == 'Base Color' for l in nd.outputs['Color'].links):
            return nd.image
    return None


def image_linear(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return srgb2lin(px.reshape(h, w, 4)[..., :3])


def sample_tex(tex, uv):
    h, w = tex.shape[:2]
    x = uv[:, 0] * w - 0.5
    y = uv[:, 1] * h - 0.5
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    x1, y1 = (x0 + 1) % w, (y0 + 1) % h
    x0 %= w
    y0 %= h
    return (tex[y0, x0] * (1 - fx) + tex[y0, x1] * fx) * (1 - fy) + (tex[y1, x0] * (1 - fx) + tex[y1, x1] * fx) * fy


def neck_height(face):
    """Top of the neck band, from the eye highlights (same rule as tools/blender/lift_heads.py)."""
    wi = [i for i, m in enumerate(face['mats']) if m and m.name.split('.')[0] == 'white']
    if not wi:
        return None
    vs = np.unique(face['tv'][np.isin(face['tm'], wi)])
    hv = face['co'][vs]
    ze = float(np.median(hv[:, 2]))
    u = float(np.percentile(hv[:, 0], 95) - np.percentile(hv[:, 0], 5)) / 0.26
    return ze - 0.27 * u, ze - 0.13 * u


def sample_surface(rng, co, tv, tl, cn, uv, n):
    p0, p1, p2 = co[tv[:, 0]], co[tv[:, 1]], co[tv[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(p1 - p0, p2 - p0), axis=1)
    total = float(area.sum())
    idx = rng.choice(len(tv), size=n, p=area / total)
    r1, r2 = rng.random(n), rng.random(n)
    s = np.sqrt(r1)
    b = np.stack([1 - s, s * (1 - r2), s * r2], axis=1)
    pos = p0[idx] * b[:, :1] + p1[idx] * b[:, 1:2] + p2[idx] * b[:, 2:3]
    nrm = cn[tl[idx, 0]] * b[:, :1] + cn[tl[idx, 1]] * b[:, 1:2] + cn[tl[idx, 2]] * b[:, 2:3]
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
    uvs = None
    if uv is not None:
        uvs = uv[tl[idx, 0]] * b[:, :1] + uv[tl[idx, 1]] * b[:, 1:2] + uv[tl[idx, 2]] * b[:, 2:3]
    return pos, nrm, uvs, idx, total


def clothes_mask(lab, z, neck_top):
    """True where a body sample wears clothes: below the neck and in a colour the head never shows."""
    head = lab[z > neck_top]
    if len(head) < 100:
        return np.zeros(len(lab), dtype=bool)
    q = 0.035
    keys, counts = np.unique(np.round(head / q).astype(np.int64), axis=0, return_counts=True)
    pal = keys[counts >= max(8, int(0.002 * len(head)))].astype(np.float64) * q
    body = np.where(z <= neck_top)[0]
    wgt = np.array([0.45, 1.0, 1.0])  # lightness counts less: the bake carries soft shading
    out = np.zeros(len(lab), dtype=bool)
    for s in range(0, len(body), 20000):
        ix = body[s:s + 20000]
        d = np.linalg.norm((lab[ix][:, None, :] - pal[None, :, :]) * wgt, axis=2).min(axis=1)
        out[ix] = d > 0.055
    return out


def build_fur(a, key, body, face, rng):
    """Returns (points (n,P,3), radius (n,P), colour (n,3) linear, stats)."""
    P = 5
    skin = next(m for m in body['mats'] if m and m.name.split('.')[0] == 'skin')
    tex = image_linear(skin_image(skin))
    pos, nrm, uvs, _, area = sample_surface(rng, body['co'], body['tv'], body['tl'], body['cn'], body['uv'], a.count)
    col = sample_tex(tex, uvs)
    neck = neck_height(face)
    cloth = clothes_mask(oklab(col), pos[:, 2], neck[1]) if neck else np.zeros(len(pos), dtype=bool)
    stats = dict(area=round(area, 3), body_roots=int(len(pos)), clothes=int(cloth.sum()), neck=[round(v, 3) for v in neck] if neck else None)
    near_cloth = np.ones(len(pos))
    if cloth.any():
        kd = KDTree(int(cloth.sum()))
        for j, pc in enumerate(pos[cloth][::1]):
            kd.insert(pc, j)
        kd.balance()
        reach_c = 0.034
        for i in np.where(~cloth)[0]:
            dd = kd.find(pos[i])[2]
            if dd < reach_c:
                near_cloth[i] = max(0.0, (dd - 0.016) / (reach_c - 0.016))
    if a.maskdebug:
        col = np.where(cloth[:, None], np.array([[1.0, 0.0, 1.0]]), col)
    else:
        keep0 = ~cloth & (near_cloth > 0.0)
        pos, nrm, col, near_cloth = pos[keep0], nrm[keep0], col[keep0], near_cloth[keep0]
    stats['near_clothes_cut'] = int((near_cloth <= 0.0).sum()) if a.maskdebug else int((~cloth).sum() - len(pos))

    # furry flat parts of the face mesh (wings, tail tips): fur in the material colour
    furry_idx = [i for i, m in enumerate(face['mats']) if m and m.name.split('.')[0] in FURRY_FACE]
    hard = ~np.isin(face['tm'], furry_idx)
    if furry_idx:
        sel = ~hard
        ftv, ftl = face['tv'][sel], face['tl'][sel]
        p0, p1, p2 = face['co'][ftv[:, 0]], face['co'][ftv[:, 1]], face['co'][ftv[:, 2]]
        farea = float((0.5 * np.linalg.norm(np.cross(p1 - p0, p2 - p0), axis=1)).sum())
        n2 = int(a.count * farea / area)
        if n2 > 0:
            fpos, fnrm, _, fidx, _ = sample_surface(rng, face['co'], ftv, ftl, face['cn'], None, n2)
            fm = face['tm'][sel][fidx]
            base = np.array([list(face['mats'][i].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)[:3] if i in furry_idx else [1, 1, 1] for i in range(len(face['mats']))])
            pos, nrm, col = np.vstack([pos, fpos]), np.vstack([nrm, fnrm]), np.vstack([col, base[fm]])
            near_cloth = np.concatenate([near_cloth, np.ones(n2)])
            stats['face_roots'] = int(n2)

    n = len(pos)
    # strand direction: the normal, jittered, leaning a little downward (gravity comb)
    jit = rng.normal(size=(n, 3)) * a.jitter
    d0 = nrm + jit - nrm * np.sum(jit * nrm, axis=1, keepdims=True) * 0.6
    d0 /= np.maximum(np.linalg.norm(d0, axis=1, keepdims=True), 1e-9)
    length = a.length * (0.62 + 0.76 * rng.random(n)) * (0.35 + 0.65 * near_cloth)

    # keep fur off the hard parts (eyes, nose, mouth, whiskers, hats, glasses, spines)
    hv = face['tv'][hard]
    if len(hv):
        bvh = BVHTree.FromPolygons([tuple(v) for v in face['co'].tolist()], [tuple(t) for t in hv.tolist()], all_triangles=True)
        fac = np.ones(n)
        margin, reach = 0.006, 0.050
        for i in range(n):
            p = Vector(pos[i])
            hit = bvh.ray_cast(p, Vector(d0[i]), length[i] * 1.6)
            if hit[0] is not None:
                fac[i] = 0.0
                continue
            near = bvh.find_nearest(p, reach)
            if near[0] is not None:
                fac[i] = max(0.0, (near[3] - margin) / (reach - margin))
        length *= fac ** 0.8
    keep = length > a.length * 0.12
    pos, nrm, col, d0, length = pos[keep], nrm[keep], col[keep], d0[keep], length[keep]
    n = len(pos)
    stats['strands'] = int(n)

    comb = np.array([0.0, 0.0, -1.0])
    bend = comb[None, :] - d0 * (d0 @ comb)[:, None]  # the part of gravity across the strand
    curl = rng.normal(size=(n, 3)) * a.curl
    t = np.linspace(0.0, 1.0, P)[None, :, None]
    pts = pos[:, None, :] + length[:, None, None] * (d0[:, None, :] * t + (0.38 * bend + curl)[:, None, :] * t * t)
    pts[:, 0, :] -= nrm * 0.002  # roots sit just under the skin
    rad = a.radius * (0.85 + 0.3 * rng.random(n))[:, None] * np.linspace(1.0, 0.28, P)[None, :]
    col = np.clip(col, 1e-4, 1) ** a.lift
    mx = col.max(axis=1, keepdims=True)
    srt = np.sort(col, axis=1)
    yellow = np.clip((srt[:, 1:2] / mx - 0.6) / 0.15, 0, 1) * (1 - srt[:, 0:1] / mx) ** 2  # strong yellows only: creams have little chroma, oranges a low middle channel
    col = mx * (col / mx) ** (a.sat + a.ysat * yellow)  # more saturation at the same value
    col = np.clip(col * (0.93 + 0.14 * rng.random(n))[:, None], 0, 1)
    return pts, rad, col, stats


def fur_material(a):
    mat = bpy.data.materials.new('fur')
    mat.use_nodes = True
    nt = mat.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_type = 'GEOMETRY'
    attr.attribute_name = 'fur_col'
    info = nt.nodes.new('ShaderNodeHairInfo')
    ramp = nt.nodes.new('ShaderNodeMix')  # darker and warmer roots, lighter tips
    ramp.data_type = 'RGBA'
    ramp.inputs['A'].default_value = (a.root * 1.12, a.root * 0.97, a.root * 0.82, 1.0)
    ramp.inputs['B'].default_value = (1.10, 1.09, 1.07, 1.0)
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(info.outputs['Intercept'], ramp.inputs['Factor'])
    nt.links.new(attr.outputs['Color'], mul.inputs['A'])
    nt.links.new(ramp.outputs['Result'], mul.inputs['B'])
    if a.shader == 'hair':
        h = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
        h.parametrization = 'COLOR'
        h.inputs['Roughness'].default_value = 0.62
        h.inputs['Radial Roughness'].default_value = 0.85
        h.inputs['Coat'].default_value = 0.0
        h.inputs['IOR'].default_value = 1.45
        h.inputs['Random Roughness'].default_value = 0.15
        nt.links.new(mul.outputs['Result'], h.inputs['Color'])
        nt.links.new(h.outputs['BSDF'], out.inputs['Surface'])
    else:
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        b.inputs['Roughness'].default_value = 0.85
        b.inputs['Specular IOR Level'].default_value = 0.25
        b.inputs['Sheen Weight'].default_value = 0.5
        b.inputs['Sheen Roughness'].default_value = 0.45
        tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
        mx = nt.nodes.new('ShaderNodeMixShader')
        mx.inputs['Fac'].default_value = 0.32
        nt.links.new(mul.outputs['Result'], b.inputs['Base Color'])
        nt.links.new(mul.outputs['Result'], tr.inputs['Color'])
        nt.links.new(b.outputs['BSDF'], mx.inputs[1])
        nt.links.new(tr.outputs['BSDF'], mx.inputs[2])
        nt.links.new(mx.outputs['Shader'], out.inputs['Surface'])
    return mat


def make_curves(pts, rad, col, mat):
    n, P = pts.shape[:2]
    hc = bpy.data.hair_curves.new('fur')
    hc.add_curves([P] * n)
    hc.attributes['position'].data.foreach_set('vector', pts.astype(np.float32).ravel())
    r = hc.attributes.new('radius', 'FLOAT', 'POINT')
    r.data.foreach_set('value', rad.astype(np.float32).ravel())
    c = hc.attributes.new('fur_col', 'FLOAT_COLOR', 'CURVE')
    c.data.foreach_set('color', np.concatenate([col, np.ones((n, 1))], axis=1).astype(np.float32).ravel())
    hc.materials.append(mat)
    obj = bpy.data.objects.new('fur', hc)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def tune_materials():
    """Plush toy look for everything that is not fur."""
    for mt in bpy.data.materials:
        if not mt.node_tree:
            continue
        b = mt.node_tree.nodes.get('Principled BSDF')
        if b is None:
            continue
        name = mt.name.split('.')[0]
        for nd in mt.node_tree.nodes:
            if nd.type == 'NORMAL_MAP':
                nd.inputs['Strength'].default_value = 0.55  # same as castLook on the site
        if name == 'skin':  # under the fur, and the clothes
            b.inputs['Roughness'].default_value = 0.92
            b.inputs['Sheen Weight'].default_value = 0.35
            b.inputs['Sheen Roughness'].default_value = 0.5
            b.inputs['Subsurface Weight'].default_value = 0.12
            b.inputs['Subsurface Radius'].default_value = (0.9, 0.5, 0.35)
            b.inputs['Subsurface Scale'].default_value = 0.04
        elif name == 'eye':
            b.inputs['Roughness'].default_value = 0.30
            b.inputs['Coat Weight'].default_value = 0.4
            b.inputs['Coat Roughness'].default_value = 0.08
        elif name == 'white':
            b.inputs['Emission Color'].default_value = (1, 1, 1, 1)
            b.inputs['Emission Strength'].default_value = 0.7
        elif name in ('nose', 'beak'):
            b.inputs['Roughness'].default_value = 0.38
            b.inputs['Subsurface Weight'].default_value = 0.25
            b.inputs['Subsurface Radius'].default_value = (1.0, 0.4, 0.3)
            b.inputs['Subsurface Scale'].default_value = 0.03
        elif name == 'acc_gold':
            b.inputs['Metallic'].default_value = 1.0
            b.inputs['Roughness'].default_value = 0.28
        elif name == 'acc_lens':
            b.inputs['Roughness'].default_value = 0.08
            b.inputs['Coat Weight'].default_value = 1.0
        elif name.startswith('acc_'):
            b.inputs['Roughness'].default_value = 0.8
            b.inputs['Sheen Weight'].default_value = 0.5
        elif name.startswith('spine'):
            b.inputs['Roughness'].default_value = 0.55


def clear_species(keep):
    for o in list(bpy.data.objects):
        if o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.hair_curves, bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)


def load_rgba(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]  # top row first


def shrink(px, f):
    """f x f box filter in premultiplied space, returned with straight alpha."""
    if f == 1:
        return px
    pm = px.copy()
    pm[..., :3] *= pm[..., 3:4]
    h, w = pm.shape[:2]
    small = pm.reshape(h // f, f, w // f, f, 4).mean(axis=(1, 3))
    al = small[..., 3:4]
    rgb = np.where(al > 1e-6, small[..., :3] / np.maximum(al, 1e-6), 0.0)
    return np.concatenate([np.clip(rgb, 0, 1), al], axis=-1)


def write_png(path, px):
    h, w = px.shape[:2]
    img = bpy.data.images.new('sheet', w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(px[::-1].astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def main():
    a = parse_args()
    keys = [k for k in a.keys.split(',') if k]
    rels = [float(v) for v in a.az.split(',')]
    os.makedirs(a.out, exist_ok=True)
    scene, cam, device = setup_scene(a)
    print('F2 device:', device, 'samples:', a.samples, 'px:', a.px, 'cell:', a.cell, 'elev: %.2f' % ELEV, flush=True)
    keep = {o.name for o in bpy.data.objects}
    pivot = Vector((0.0, 0.0, a.pivot))
    mat = fur_material(a)
    mat.use_fake_user = True
    meta = dict(cell=a.cell, ortho=a.ortho, pivot=a.pivot, elev=ELEV, az0=AZ0, rel=rels, species={})
    for key in keys:
        t0 = time.time()
        rng = np.random.default_rng(abs(hash(key)) % (2 ** 31) if False else sum(ord(ch) * (i + 7) for i, ch in enumerate(key)))
        bpy.ops.import_scene.gltf(filepath=os.path.join(CAST, key + '.glb'))
        objs = {o.name: o for o in bpy.data.objects if o.name not in keep and o.type == 'MESH'}
        body, face = mesh_arrays(objs['chibi']), mesh_arrays(objs['face'])
        allv = np.vstack([body['co'], face['co']])
        ext = {}
        for rel in rels:
            az = math.radians(AZ0 + rel)
            el = math.radians(ELEV)
            right = np.array([math.cos(az), math.sin(az), 0.0])
            up = np.array([-math.sin(az) * math.sin(el), math.cos(az) * math.sin(el), math.cos(el)])
            q = allv - np.array(pivot)
            ext[rel] = [float((q @ right).min()), float((q @ right).max()), float((q @ up).min()), float((q @ up).max())]
        worst = max(max(abs(v) for v in e) for e in ext.values())
        print('F2 %-9s extents worst %.3f (half cell %.3f) zmin %.3f zmax %.3f' % (key, worst, a.ortho / 2, allv[:, 2].min(), allv[:, 2].max()), {k: [round(x, 2) for x in v] for k, v in ext.items()}, flush=True)
        meta['species'][key] = dict(zmin=float(allv[:, 2].min()), zmax=float(allv[:, 2].max()), worst=worst)
        if a.extents:
            clear_species(keep)
            continue
        tune_materials()
        t_fur = time.time()
        if not a.nofur:
            pts, rad, col, stats = build_fur(a, key, body, face, rng)
            make_curves(pts, rad, col, mat)
            print('F2 %-9s fur %s in %.1fs' % (key, json.dumps(stats), time.time() - t_fur), flush=True)
        frames = []
        frame_s = []
        t_render = time.time()
        for i, rel in enumerate(rels):
            cam.location = pivot + unit_dir(AZ0 + rel, ELEV) * 12.0
            aim(cam, pivot - cam.location)
            png = os.path.join(a.out, '%s%s_a%d.png' % (key, a.tag, i))
            scene.render.filepath = png
            t1 = time.time()
            bpy.ops.render.render(write_still=True)
            frame_s.append(round(time.time() - t1, 1))
            print('F2 %-9s frame %d rel %+.0f %.1fs' % (key, i, rel, time.time() - t1), flush=True)
            frames.append(shrink(load_rgba(png), a.px // a.cell))
        render_s = time.time() - t_render
        sheet = np.concatenate(frames, axis=1)
        sheet_png = os.path.join(a.out, '%s%s.png' % (key, a.tag))
        write_png(sheet_png, sheet)
        meta['species'][key].update(render_s=round(render_s, 1), frame_s=frame_s, fur_s=round(t_render - t_fur, 1), total_s=round(time.time() - t0, 1), png=os.path.getsize(sheet_png), strands=stats.get('strands') if not a.nofur else 0)
        print('F2 %-9s done: render %.1fs total %.1fs sheet %d bytes' % (key, render_s, time.time() - t0, os.path.getsize(sheet_png)), flush=True)
        with open(os.path.join(a.out, 'sheet%s.json' % a.tag), 'w') as f:  # rewritten after every species, so a stopped run keeps its numbers
            json.dump(meta, f, indent=1)
        clear_species(keep)
    if not a.extents:
        with open(os.path.join(a.out, 'sheet%s.json' % a.tag), 'w') as f:
            json.dump(meta, f, indent=1)


main()
