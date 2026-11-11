"""Builds the town props (trees, pine, bush, street lamp) procedurally and exports them as one glb.

Run it with Blender 5.2.3 in the background (see tools/blender/README.md):

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python tools/blender/props_town.py -- --out site/assets/scene/props/town-props.glb \
    --preview /tmp/townq/props-preview.png

The glb holds nine mesh objects whose names the page looks up (tree_round_trunk, tree_round_canopy, ...).
Geometry is in meters with +Y up and the origin at the center of the base. Colors live in COLOR_0 only:
canopies and the lamp head carry a grey ambient occlusion value (the page tints them per instance),
trunks and the lamp pole carry a fixed color multiplied by the occlusion. No textures, no materials.
"""
import argparse
import math
import os
import random
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
DEFAULT_OUT = os.path.join(ROOT, 'site', 'assets', 'scene', 'props', 'town-props.glb')

SEED = 20261111
AO_MIN = 0.55
TRUNK_HEX = '#8a6a4a'
POLE_HEX = '#5b5668'
BUDGET = {'canopy': 1200, 'stem': 300, 'bush': 600}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--out', default=DEFAULT_OUT)
    p.add_argument('--preview', default='', help='PNG path for the 1600x600 preview (skipped when empty)')
    p.add_argument('--samples', type=int, default=96)
    p.add_argument('--device', choices=['auto', 'cpu', 'gpu'], default='auto')
    return p.parse_args(argv)


def hex_linear(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# ---------------------------------------------------------------- scene helpers

def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
        for item in list(coll):
            coll.remove(item)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_from_bm(name, bm):
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def new_object(name, me):
    me.name = name
    obj = bpy.data.objects.new(name, me)
    return link(obj)


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def apply_modifier(obj, kind, **props):
    mod = obj.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(mod, k, v)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    obj.modifiers.clear()
    old = obj.data
    obj.data = me
    bpy.data.meshes.remove(old)
    me.name = obj.name
    me.shade_smooth()


def coords(me):
    import numpy as np
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    return co.reshape(n, 3)


def set_coords(me, co):
    me.vertices.foreach_set('co', co.ravel())
    me.update()


def flatten_bottom(obj, z_plane, k):
    co = coords(obj.data)
    low = co[:, 2] < z_plane
    co[low, 2] = z_plane + (co[low, 2] - z_plane) * k
    set_coords(obj.data, co)


def fit_bbox(obj, width, z0, z1):
    """Scale x/y together to `width` (x extent), z to [z0, z1] and center x/y on the origin."""
    co = coords(obj.data)
    lo, hi = co.min(axis=0), co.max(axis=0)
    sxy = width / (hi[0] - lo[0])
    sz = (z1 - z0) / (hi[2] - lo[2])
    co[:, 0] = (co[:, 0] - (lo[0] + hi[0]) / 2.0) * sxy
    co[:, 1] = (co[:, 1] - (lo[1] + hi[1]) / 2.0) * sxy
    co[:, 2] = (co[:, 2] - lo[2]) * sz + z0
    set_coords(obj.data, co)


# ---------------------------------------------------------------- primitive builders

def finish_part(bm, start):
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)[start:])


def tube(bm, pts, radii, segs, cap_start=True, cap_end=True):
    start = len(bm.faces)
    pts = [Vector(p) for p in pts]
    tans = []
    for i in range(len(pts)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        tans.append((b - a).normalized())
    ref = Vector((0, 1, 0)) if abs(tans[0].y) < 0.9 else Vector((1, 0, 0))
    n = tans[0].cross(ref).normalized()
    rings = []
    for p, t, r in zip(pts, tans, radii):
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n)
        rings.append([bm.verts.new(p + (n * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs)) * r)
                      for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    for ring, p, flag, ofs in ((rings[0], pts[0], cap_start, Vector((0, 0, 0))),
                               (rings[-1], pts[-1], cap_end, tans[-1] * radii[-1] * 0.6)):
        if flag:
            c = bm.verts.new(p + ofs)
            for k in range(segs):
                bm.faces.new((ring[k], ring[(k + 1) % segs], c))
    finish_part(bm, start)


def lathe(bm, profile, segs, cx=0.0, cy=0.0):
    """Revolves (r, z) points about the vertical axis. First and last point sit on the axis (r == 0)."""
    start = len(bm.faces)
    rows = []
    for r, z in profile:
        if r == 0:
            rows.append([bm.verts.new((cx, cy, z))])
        else:
            rows.append([bm.verts.new((cx + r * math.cos(2 * math.pi * k / segs), cy + r * math.sin(2 * math.pi * k / segs), z))
                         for k in range(segs)])
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[k2], b[k]))
            elif len(b) == 1:
                bm.faces.new((a[k], a[k2], b[0]))
            else:
                bm.faces.new((a[k], a[k2], b[k2], b[k]))
    finish_part(bm, start)


def blobs_to_bm(blobs, u=32, v=20):
    bm = bmesh.new()
    for cx, cy, cz, rx, ry, rz in blobs:
        try:
            res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
        except TypeError:
            res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, diameter=1.0)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Diagonal((rx, ry, rz, 1.0)), verts=res['verts'])
    return bm


# ---------------------------------------------------------------- props

def make_canopy(name, blobs, voxel, smooth_a, flat, fit, budget, smooth_b=2):
    obj = new_object(name, mesh_from_bm(name, blobs_to_bm(blobs)))
    apply_modifier(obj, 'REMESH', mode='VOXEL', voxel_size=voxel, adaptivity=0.0, use_smooth_shade=True)
    if flat:
        flatten_bottom(obj, flat[0], flat[1])
    apply_modifier(obj, 'SMOOTH', factor=0.9, iterations=smooth_a)
    apply_modifier(obj, 'TRIANGULATE', quad_method='BEAUTY')
    target = budget * 0.93
    ratio = min(1.0, target / tri_count(obj))
    for _ in range(8):
        keep = obj.data.copy()
        apply_modifier(obj, 'DECIMATE', decimate_type='COLLAPSE', ratio=ratio)
        if tri_count(obj) <= budget:
            bpy.data.meshes.remove(keep)
            break
        obj.data, tmp = keep, obj.data
        bpy.data.meshes.remove(tmp)
        ratio *= 0.93
    apply_modifier(obj, 'SMOOTH', factor=0.5, iterations=smooth_b)
    fit_bbox(obj, *fit)
    return obj


def trunk_curve(height, base_r, top_r, bend, ts):
    pts, radii = [], []
    for t in ts:
        pts.append((bend * math.sin(t * math.pi * 1.1) * 0.5 + bend * 0.3 * t, bend * 0.4 * t * (1 - t), t * height))
        radii.append(top_r + (base_r - top_r) * (1 - t) * 0.55 + (base_r - top_r) * 0.45 * math.exp(-t * 12))
    return pts, radii


def make_trunk_round():
    ts = [0, 0.06, 0.15, 0.3, 0.45, 0.6, 0.75, 0.88, 1.0]
    pts, radii = trunk_curve(1.6, 0.16, 0.075, 0.12, ts)
    bm = bmesh.new()
    tube(bm, pts, radii, 10)
    # two short branches that leave the trunk and reach into the crown
    for ti, dirv, ln, r0 in ((0.45, Vector((0.85, 0.2, 0.5)), 0.6, 0.05), (0.62, Vector((-0.8, -0.3, 0.55)), 0.55, 0.045)):
        p0 = Vector(trunk_curve(1.6, 0.16, 0.075, 0.12, [ti])[0][0])
        d = dirv.normalized()
        bpts = [p0 - d * 0.04, p0 + d * ln * 0.35, p0 + d * ln * 0.7 + Vector((0, 0, 0.06)), p0 + d * ln + Vector((0, 0, 0.14))]
        tube(bm, bpts, [r0, r0 * 0.85, r0 * 0.7, r0 * 0.55], 6, cap_start=False)
    return new_object('tree_round_trunk', mesh_from_bm('tree_round_trunk', bm))


def make_trunk_simple(name, height, base_r, top_r, bend, segs=8):
    ts = [0, 0.08, 0.2, 0.4, 0.6, 0.8, 1.0]
    pts, radii = trunk_curve(height, base_r, top_r, bend, ts)
    bm = bmesh.new()
    tube(bm, pts, radii, segs)
    return new_object(name, mesh_from_bm(name, bm))


def make_pine_canopy():
    bm = bmesh.new()
    tiers = ((0.55, 1.75, 1.0, 0.17), (1.3, 2.4, 0.76, 0.14), (2.0, 3.0, 0.52, 0.12))
    for zb, zt, rb, rr in tiers:
        h = zt - zb
        cx, cz = rb - rr, zb + rr
        ang = [math.radians(a) for a in (52, 12, -32, -72)]
        rim = [(cx + rr * math.cos(a), cz + rr * math.sin(a)) for a in ang]
        prof = [(0.0, zt), (0.06 * rb, zt - 0.012 * h), (0.13 * rb, zt - 0.05 * h), (0.2 * rb, zt - 0.12 * h)]
        # straight flank from the rounded tip to the first rim point
        (r1, z1) = rim[0]
        prof.append((0.2 * rb + (r1 - 0.2 * rb) * 0.5, (zt - 0.12 * h + z1) * 0.5))
        prof += rim
        prof += [(0.5 * rb, zb + 0.08 * h), (0.0, zb + 0.16 * h)]
        lathe(bm, prof, 20)
    return new_object('pine_canopy', mesh_from_bm('pine_canopy', bm))


def make_lamp():
    bm = bmesh.new()
    pole = [(0.0, 0.0), (0.16, 0.0), (0.17, 0.035), (0.14, 0.1), (0.072, 0.19), (0.06, 0.32), (0.06, 1.88),
            (0.082, 1.95), (0.055, 2.03), (0.0, 2.06)]
    lathe(bm, pole, 8)
    tube(bm, [(0.0, 0.0, 1.97), (0.004, 0.0, 2.1), (0.05, 0.0, 2.19), (0.15, 0.0, 2.235), (0.3, 0.0, 2.235)],
         [0.042, 0.04, 0.038, 0.036, 0.034], 6, cap_start=False, cap_end=False)
    dome = [(0.0, 2.3), (0.1, 2.285), (0.19, 2.24), (0.25, 2.18), (0.265, 2.145), (0.23, 2.15), (0.0, 2.25)]
    lathe(bm, dome, 10, cx=0.3)
    pole_obj = new_object('lamp_pole', mesh_from_bm('lamp_pole', bm))

    bm = bmesh.new()
    res = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0.3, 0.0, 2.1)) @ Matrix.Diagonal((0.2, 0.2, 0.2, 1.0)), verts=res['verts'])
    head_obj = new_object('lamp_head', mesh_from_bm('lamp_head', bm))
    return pole_obj, head_obj


def build_all():
    objs = {}
    objs['tree_round_trunk'] = make_trunk_round()
    objs['tree_round_canopy'] = make_canopy(
        'tree_round_canopy',
        [(0.0, 0.0, 1.95, 0.8, 0.78, 0.7), (-0.55, 0.12, 1.75, 0.6, 0.58, 0.55), (0.56, -0.1, 1.8, 0.62, 0.6, 0.55),
         (0.12, 0.5, 2.1, 0.5, 0.5, 0.45), (-0.12, -0.5, 2.15, 0.52, 0.5, 0.46), (0.05, 0.0, 2.35, 0.55, 0.55, 0.45)],
        voxel=0.05, smooth_a=4, flat=(1.3, 0.3), fit=(2.1, 1.05, 2.75), budget=BUDGET['canopy'])
    objs['tree_tall_trunk'] = make_trunk_simple('tree_tall_trunk', 1.9, 0.14, 0.08, 0.08)
    objs['tree_tall_canopy'] = make_canopy(
        'tree_tall_canopy',
        [(0.0, 0.0, 2.2, 0.62, 0.62, 0.95), (0.36, 0.1, 1.75, 0.34, 0.34, 0.3), (-0.3, -0.15, 2.7, 0.32, 0.32, 0.3),
         (0.12, 0.3, 2.95, 0.28, 0.28, 0.26)],
        voxel=0.045, smooth_a=4, flat=None, fit=(1.4, 1.2, 3.2), budget=BUDGET['canopy'])
    objs['pine_trunk'] = make_trunk_simple('pine_trunk', 1.4, 0.13, 0.09, 0.04)
    objs['pine_canopy'] = make_pine_canopy()
    objs['bush_canopy'] = make_canopy(
        'bush_canopy',
        [(-0.32, 0.0, 0.38, 0.46, 0.45, 0.36), (0.33, 0.05, 0.36, 0.47, 0.46, 0.35), (0.0, -0.22, 0.4, 0.45, 0.43, 0.36)],
        voxel=0.035, smooth_a=3, flat=(0.1, 0.12), fit=(1.4, 0.0, 0.9), budget=BUDGET['bush'])
    objs['lamp_pole'], objs['lamp_head'] = make_lamp()
    return objs


# ---------------------------------------------------------------- ambient occlusion

def ray_ao(obj, occluders, max_dist, nrays=96, seed=SEED):
    verts, polys = [], []
    for o in occluders:
        me = o.data
        me.calc_loop_triangles()
        off = len(verts)
        verts += [v.co.copy() for v in me.vertices]
        polys += [tuple(off + i for i in t.vertices) for t in me.loop_triangles]
    off = len(verts)
    verts += [Vector((-6, -6, 0)), Vector((6, -6, 0)), Vector((6, 6, 0)), Vector((-6, 6, 0))]
    polys += [(off, off + 1, off + 2), (off, off + 2, off + 3)]
    tree = BVHTree.FromPolygons(verts, polys)
    golden = math.pi * (3 - math.sqrt(5))
    local = []
    for i in range(nrays):
        u = (i + 0.5) / nrays * 0.96
        r = math.sqrt(u)
        local.append((r * math.cos(i * golden), r * math.sin(i * golden), math.sqrt(1 - u)))
    rnd = random.Random(seed)
    out, nz = [], []
    for v in obj.data.vertices:
        n = v.normal.normalized()
        t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
        b = n.cross(t)
        rot = rnd.random() * 2 * math.pi
        cr, sr = math.cos(rot), math.sin(rot)
        origin = v.co + n * 0.015
        occ = 0.0
        for lx, ly, lz in local:
            x, y = lx * cr - ly * sr, lx * sr + ly * cr
            hit = tree.ray_cast(origin, t * x + b * y + n * lz, max_dist)
            if hit[0] is not None:
                occ += 1.0 - hit[3] / max_dist
        out.append(1.0 - occ / nrays)
        nz.append(n.z)
    return out, nz


def percentile_norm(vals, lo=1.0, hi=99.0):
    s = sorted(vals)
    a = s[int(len(s) * lo / 100.0)]
    b = s[min(len(s) - 1, int(len(s) * hi / 100.0))]
    span = max(b - a, 1e-6)
    return [min(1.0, max(0.0, (v - a) / span)) for v in vals]


def write_colors(obj, colors):
    me = obj.data
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    flat = []
    for c in colors:
        flat += [c[0], c[1], c[2], 1.0]
    attr.data.foreach_set('color', flat)
    me.color_attributes.active_color = attr
    me.color_attributes.default_color_name = 'Color'
    me.update()


def bake_all(objs):
    groups = {
        'tree_round_trunk': ['tree_round_trunk', 'tree_round_canopy'], 'tree_round_canopy': ['tree_round_trunk', 'tree_round_canopy'],
        'tree_tall_trunk': ['tree_tall_trunk', 'tree_tall_canopy'], 'tree_tall_canopy': ['tree_tall_trunk', 'tree_tall_canopy'],
        'pine_trunk': ['pine_trunk', 'pine_canopy'], 'pine_canopy': ['pine_trunk', 'pine_canopy'],
        'bush_canopy': ['bush_canopy'], 'lamp_pole': ['lamp_pole', 'lamp_head'], 'lamp_head': ['lamp_pole', 'lamp_head'],
    }
    stats = {}
    for name, obj in objs.items():
        occ = [objs[n] for n in groups[name]]
        if name == 'lamp_head':
            ao, nz = ray_ao(obj, occ, 0.5)
            grey = [AO_MIN + (1 - AO_MIN) * min(1.0, max(0.0, (a - 0.45) / 0.55)) for a in ao]
        else:
            ao, nz = ray_ao(obj, occ, 0.9 if name.endswith('canopy') else 0.6)
            sky_w = 0.4 if name.endswith('canopy') else 0.15
            val = [a * (1 - sky_w + sky_w * (0.5 + 0.5 * z)) for a, z in zip(ao, nz)]
            grey = [AO_MIN + (1 - AO_MIN) * g ** 1.7 for g in percentile_norm(val)]
        if name.endswith('trunk'):
            base = hex_linear(TRUNK_HEX)
        elif name == 'lamp_pole':
            base = hex_linear(POLE_HEX)
        else:
            base = (1.0, 1.0, 1.0)
        # AO is a plain linear multiplier, the base color is converted from sRGB to linear first.
        write_colors(obj, [(base[0] * g, base[1] * g, base[2] * g) for g in grey])
        stats[name] = (min(grey), max(grey))
    return stats


# ---------------------------------------------------------------- export

def export_glb(objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs.values():
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(objs.values()))
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    want = dict(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_texcoords=False, export_materials='NONE', export_vertex_color='ACTIVE',
        export_active_vertex_color_when_no_material=True, export_cameras=False, export_lights=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_draco_color_quantization=10, export_draco_generic_quantization=12,
    )
    dropped = [k for k in want if k not in props]
    if dropped:
        print('glTF options not in this Blender (ignored):', dropped)
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})


# ---------------------------------------------------------------- preview

def setup_device(scene, choice):
    scene.cycles.device = 'CPU'
    if choice == 'cpu':
        return 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == 'METAL']
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        if gpus:
            scene.cycles.device = 'GPU'
            return 'METAL GPU'
    except Exception as e:
        print('GPU setup failed, using CPU:', e)
    return 'CPU'


def tint_material(name, tint_hex=None, emission=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if emission:
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (1.0, 0.82, 0.45, 1.0)
        em.inputs['Strength'].default_value = 7.0
        nt.links.new(em.outputs[0], out.inputs['Surface'])
        return mat
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 1.0
    for key in ('Specular IOR Level', 'Specular'):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.15
            break
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    if tint_hex:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs[0].default_value = 1.0
        nt.links.new(vc.outputs['Color'], mix.inputs[6])
        t = hex_linear(tint_hex)
        mix.inputs[7].default_value = (t[0], t[1], t[2], 1.0)
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def render_preview(objs, path, samples, device_choice):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    cy.samples = samples
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1600, 600, 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'
    device = setup_device(scene, device_choice)

    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.85, 0.92, 1.0, 1.0)
    bg.inputs['Strength'].default_value = 0.75
    scene.world = world

    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(10)
    sun.color = (1.0, 0.96, 0.88)
    so = link(bpy.data.objects.new('sun', sun))
    so.rotation_euler = (math.radians(-52), math.radians(8), math.radians(32))

    ground_me = bpy.data.meshes.new('ground')
    gb = bmesh.new()
    gb.faces.new([gb.verts.new(p) for p in ((-40, -30, -0.001), (40, -30, -0.001), (40, 80, -0.001), (-40, 80, -0.001))])
    gb.to_mesh(ground_me)
    gb.free()
    ground = link(bpy.data.objects.new('ground', ground_me))
    gm = bpy.data.materials.new('grass')
    gm.diffuse_color = (0, 0, 0, 1)
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hex_linear('#cfe6a8'), 1.0)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 1.0
    ground.data.materials.append(gm)

    green, pink, orange, pine_c, wood, iron = '#7fbf72', '#f4b3c8', '#f2a65a', '#4f9a62', None, None
    mats = {}

    def mat(key, tint=None, emission=False):
        if key not in mats:
            mats[key] = tint_material(key, tint, emission)
        return mats[key]

    items = [
        ('tree_round', green), ('tree_round', pink), ('tree_tall', '#8fcf7a'), ('pine', pine_c),
        ('bush', green), ('bush', orange), ('lamp', None),
    ]
    xs = [-7.8, -5.2, -2.6, 0.0, 2.6, 5.2, 7.8]
    for (kind, tint), x in zip(items, xs):
        parts = {'tree_round': ['tree_round_trunk', 'tree_round_canopy'], 'tree_tall': ['tree_tall_trunk', 'tree_tall_canopy'],
                 'pine': ['pine_trunk', 'pine_canopy'], 'bush': ['bush_canopy'], 'lamp': ['lamp_pole', 'lamp_head']}[kind]
        for pn in parts:
            o = link(bpy.data.objects.new('prev_' + pn, objs[pn].data))
            o.location = (x, 0, 0)
            if not o.data.materials:
                o.data.materials.append(None)
            if pn.endswith('canopy'):
                m = mat('tint_' + tint, tint)
            elif pn == 'lamp_head':
                m = mat('emit', emission=True)
            else:
                m = mat('plain')
            o.material_slots[0].link = 'OBJECT'
            o.material_slots[0].material = m

    for o in objs.values():
        o.hide_render = True  # the originals sit at x = 0, only the placed instances are rendered
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 19.6
    cam = link(bpy.data.objects.new('cam', cam_data))
    el = math.radians(11)
    target = Vector((0, 0, 1.75))
    cam.location = target + Vector((0, -40 * math.cos(el), 40 * math.sin(el)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print('preview: %s on %s, %.1fs -> %s' % (samples, device, time.time() - t0, path))


def main():
    args = parse_args()
    t_all = time.time()
    reset_scene()
    t0 = time.time()
    objs = build_all()
    print('modeled in %.1fs' % (time.time() - t0))
    t0 = time.time()
    stats = bake_all(objs)
    print('ao baked in %.1fs' % (time.time() - t0))
    for name, o in objs.items():
        kind = 'canopy' if name == 'bush_canopy' else ('canopy' if name.endswith('canopy') else 'stem')
        limit = BUDGET['bush'] if name == 'bush_canopy' else BUDGET[kind]
        n = tri_count(o)
        co = coords(o.data)
        print('%-18s tris %4d (limit %4d)  size x %.2f y %.2f z %.2f..%.2f  ao %.2f..%.2f' % (
            name, n, limit, co[:, 0].max() - co[:, 0].min(), co[:, 1].max() - co[:, 1].min(), co[:, 2].min(), co[:, 2].max(),
            stats[name][0], stats[name][1]))
        if n > limit:
            sys.stderr.write('%s is over its triangle budget\n' % name)
            sys.exit(3)
    export_glb(objs, args.out)
    print('glb: %d bytes -> %s' % (os.path.getsize(args.out), args.out))
    if args.preview:
        render_preview(objs, args.preview, args.samples, args.device)
    print('total %.1fs' % (time.time() - t_all))


main()
