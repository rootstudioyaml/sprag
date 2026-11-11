"""Renders the pose models of the animal cast into one thumbnail atlas.

Run it with Blender 5.2.3 in the background (see tools/blender/README.md):

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python tools/blender/render_thumbs.py -- --out /tmp/sprag-thumbs [--only cat,dog] [--samples 96]

Each species is rendered at 320x320, shrunk to 160x160 and placed into an 8x4 atlas
(1280x640, transparent). Cell i sits at column i % 8, row floor(i / 8). The cell order
is read from src/office-species.js (the 30 row('<key>' calls, in GRADES order) and ends
with the ghost, 31 in all. The last cell (the 32nd) stays empty.
"""
import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CAST_DIR = os.path.join(ROOT, 'site', 'assets', 'scene', 'cast')
SPECIES_JS = os.path.join(ROOT, 'src', 'office-species.js')
EXPECTED_CELLS = 31
COLS, ROWS, CELL = 8, 4, 160
RENDER_PX = 320
WEBP_MAX_BYTES = 250 * 1024

# After the glTF import the model faces Blender -Y (glTF +Z is the front of the character).
# Azimuth 0 is the camera straight in front; positive azimuth moves it to the viewer's right (+X).
CAM_AZIMUTH_DEG = 25.0
CAM_ELEVATION_DEG = 12.0
FOCAL_MM = 50.0
SENSOR_MM = 36.0
UPPER_BODY_FRACTION = 0.44  # a bit over 40% so that muzzles and beaks that hang low stay in the cell
TRIM_PERCENT = 0.15  # ignore the outermost 0.15% of vertices per side: stray whisker and antenna tips
MARGIN = 0.08


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--out', required=True, help='directory for the per-species PNGs and atlas.png')
    p.add_argument('--only', default='', help='comma separated keys; renders only those (atlas is not written)')
    p.add_argument('--samples', type=int, default=96)
    p.add_argument('--device', choices=['auto', 'cpu', 'gpu'], default='auto')
    p.add_argument('--webp', default=os.path.join(CAST_DIR, 'atlas.webp'), help='atlas.webp path (full runs only)')
    return p.parse_args(argv)


def read_keys():
    with open(SPECIES_JS, encoding='utf-8') as f:
        keys = re.findall(r"row\('([a-z]+)'", f.read())
    keys.append('ghost')  # the no-data species is not a GRADES row, it always comes last
    if len(keys) != EXPECTED_CELLS or len(set(keys)) != len(keys):
        sys.stderr.write('expected %d distinct keys (row() calls in src/office-species.js plus ghost), found %d\n' % (EXPECTED_CELLS, len(keys)))
        sys.exit(2)
    return keys


def setup_device(scene, choice):
    cycles = scene.cycles
    cycles.device = 'CPU'
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
            cycles.device = 'GPU'
            return 'METAL GPU (%s)' % ', '.join(d.name for d in gpus)
    except Exception as e:  # no Metal device or add-on missing: fall back to the CPU
        print('GPU setup failed, using CPU:', e)
    return 'CPU'


def setup_scene(samples, device_choice):
    scene = bpy.context.scene
    # The factory startup file brings a cube, a camera and a light. Remove them all.
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.materials):
        for item in list(coll):
            coll.remove(item)
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    cy.samples = samples
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 6
    cy.film_exposure = 1.0
    scene.render.film_transparent = True
    scene.render.resolution_x = RENDER_PX
    scene.render.resolution_y = RENDER_PX
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    device = setup_device(scene, device_choice)

    # World: pale cream light only, hidden in the render by film_transparent.
    world = bpy.data.worlds.new('cream')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (1.0, 0.93, 0.80, 1.0)
    bg.inputs['Strength'].default_value = 0.42
    scene.world = world

    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'PERSP'
    cam_data.lens = FOCAL_MM
    cam_data.sensor_width = SENSOR_MM
    cam_data.sensor_fit = 'AUTO'
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    def area(name, color, energy, size):
        data = bpy.data.lights.new(name, 'AREA')
        data.shape = 'DISK'
        data.size = size
        data.color = color
        data.energy = energy
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        return obj

    lights = {
        'key': area('key', (1.0, 0.95, 0.88), 90.0, 2.6),
        'fill': area('fill', (1.0, 0.97, 0.94), 28.0, 2.6),
        'rim': area('rim', (0.88, 0.94, 1.0), 50.0, 2.0),
    }
    return scene, cam, lights, device


def unit_dir(az_deg, el_deg):
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def look_at(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def world_vertices(objs):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    chunks = []
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(depsgraph)
        me = ev.to_mesh()
        n = len(me.vertices)
        if n:
            co = np.empty(n * 3, dtype=np.float64)
            me.vertices.foreach_get('co', co)
            co = co.reshape(n, 3)
            m = np.array(ev.matrix_world, dtype=np.float64)
            chunks.append(co @ m[:3, :3].T + m[:3, 3])
        ev.to_mesh_clear()
    return np.vstack(chunks)


def project(verts, cam):
    """Frame units: u, v in [-0.5, 0.5] cover the render for a centred camera."""
    inv = np.array(cam.matrix_world.inverted(), dtype=np.float64)
    c = verts @ inv[:3, :3].T + inv[:3, 3]
    f = FOCAL_MM / SENSOR_MM
    depth = -c[:, 2]
    return f * c[:, 0] / depth, f * c[:, 1] / depth


def frame_upper_body(verts, cam, lights):
    zmax, zmin = verts[:, 2].max(), verts[:, 2].min()
    cut = zmax - UPPER_BODY_FRACTION * (zmax - zmin)
    sel = verts[verts[:, 2] >= cut]
    center = Vector(((sel.min(axis=0) + sel.max(axis=0)) / 2.0).tolist())
    cdir = unit_dir(CAM_AZIMUTH_DEG, CAM_ELEVATION_DEG)
    dist = 3.0
    cam.data.shift_x = 0.0
    cam.data.shift_y = 0.0
    for _ in range(8):
        cam.location = center + cdir * dist
        look_at(cam, center)
        bpy.context.view_layer.update()
        u, v = project(sel, cam)
        u0, u1 = np.percentile(u, [TRIM_PERCENT, 100.0 - TRIM_PERCENT])
        v0, v1 = np.percentile(v, [TRIM_PERCENT, 100.0 - TRIM_PERCENT])
        extent = max(u1 - u0, v1 - v0)
        cam.data.shift_x = float((u0 + u1) / 2.0)
        cam.data.shift_y = float((v0 + v1) / 2.0)
        dist *= extent / (1.0 - 2.0 * MARGIN)
    cam.location = center + cdir * dist
    look_at(cam, center)
    bpy.context.view_layer.update()
    # Lights keep a fixed distance from the framed point, positioned relative to the camera azimuth.
    for name, (az, el, d) in {
        'key': (CAM_AZIMUTH_DEG - 50.0, 45.0, 3.4),
        'fill': (CAM_AZIMUTH_DEG + 75.0, 15.0, 3.6),
        'rim': (CAM_AZIMUTH_DEG + 150.0, 50.0, 3.4),
    }.items():
        lights[name].location = center + unit_dir(az, el) * d
        look_at(lights[name], center)
    return center, dist


def clear_imported(before):
    for o in list(bpy.data.objects):
        if o.name not in before:
            bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures, bpy.data.armatures):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)


def load_rgba(path):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px[::-1]  # top row first


def shrink_half(px):
    """2x2 box filter in premultiplied space, returned with straight alpha."""
    pm = px.copy()
    pm[..., :3] *= pm[..., 3:4]
    h, w = pm.shape[:2]
    small = pm.reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3))
    a = small[..., 3:4]
    rgb = np.where(a > 1e-6, small[..., :3] / np.maximum(a, 1e-6), 0.0)
    return np.concatenate([np.clip(rgb, 0, 1), a], axis=-1)


def write_png(path, px):
    h, w = px.shape[:2]
    img = bpy.data.images.new('atlas', w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    img.pixels = px[::-1].astype(np.float32).ravel().tolist()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def encode_webp(png, webp):
    cwebp = shutil.which('cwebp') or '/opt/homebrew/bin/cwebp'
    lo, hi, best = 1, 100, None
    while lo <= hi:
        q = (lo + hi) // 2
        subprocess.run([cwebp, '-quiet', '-m', '6', '-q', str(q), '-alpha_q', '100', png, '-o', webp + '.tmp'], check=True)
        if os.path.getsize(webp + '.tmp') <= WEBP_MAX_BYTES:
            best = q
            shutil.copyfile(webp + '.tmp', webp)
            lo = q + 1
        else:
            hi = q - 1
    os.remove(webp + '.tmp')
    if best is None:
        sys.stderr.write('no quality reaches %d bytes\n' % WEBP_MAX_BYTES)
        sys.exit(3)
    return best


def main():
    args = parse_args()
    keys = read_keys()
    only = [k for k in args.only.split(',') if k]
    for k in only:
        if k not in keys:
            sys.stderr.write('unknown key: %s\n' % k)
            sys.exit(2)
    os.makedirs(args.out, exist_ok=True)
    scene, cam, lights, device = setup_scene(args.samples, args.device)
    print('device:', device, 'samples:', args.samples)

    atlas = np.zeros((ROWS * CELL, COLS * CELL, 4), dtype=np.float32)
    t_all = time.time()
    for i, key in enumerate(keys):
        if only and key not in only:
            continue
        t0 = time.time()
        before = {o.name for o in bpy.data.objects}
        bpy.ops.import_scene.gltf(filepath=os.path.join(CAST_DIR, key + '-pose.glb'))
        new = [o for o in bpy.data.objects if o.name not in before]
        verts = world_vertices(new)
        center, dist = frame_upper_body(verts, cam, lights)
        png = os.path.join(args.out, key + '.png')
        scene.render.filepath = png
        bpy.ops.render.render(write_still=True)
        px = shrink_half(load_rgba(png))
        r, c = divmod(i, COLS)
        atlas[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = px
        clear_imported(before)
        print('rendered %2d %-9s %.1fs (cam dist %.2f)' % (i, key, time.time() - t0, dist), flush=True)
    print('render total: %.1fs' % (time.time() - t_all))

    if only:
        print('--only given: atlas not written')
        return
    atlas_png = os.path.join(args.out, 'atlas.png')
    write_png(atlas_png, atlas)
    q = encode_webp(atlas_png, args.webp)
    print('atlas.webp: quality %d, %d bytes -> %s' % (q, os.path.getsize(args.webp), args.webp))


main()
