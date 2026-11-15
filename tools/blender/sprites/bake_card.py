"""Profile-card fur sprites of the standing cast (the 240x320 card of the sprag office).

  Blender -b --factory-startup --python bake_card.py -- card cat,dog --work WORK [--force]
  Blender -b --factory-startup --python bake_card.py -- card all --work WORK [--force]       (every species of office-species.js but ghost)
  Blender -b --factory-startup --python bake_card.py -- check out.png cat --work WORK

Fur parameters, lighting rig, colour management, denoise, alpha bleed and webp encoding are those of bake_sprites.py
(imported, not copied). Only the model (<key>-pose.glb), the camera and the layout differ:
  * camera = the three.js card camera of office-scene.js (fov 26 vertical, aspect 0.75, formula from the page), in perspective
  * WORK as in bake_sprites.py: sheets go to WORK/out/<key>-card.webp
  * 5 frames at model yaw 0.22 .. 0.66 about the world origin (the model turns, camera and lights stay)
  * frame 480x640 (rendered 2x, box filter), sheet = 5 frames side by side = 2400x640 -> out/<key>-card.webp
  * WORK/card.json holds cam and at in three.js coordinates of the unscaled pose model; a new WORK starts from the
    card section of site/assets/scene/sprites/manifest.json, so species not baked again keep their entry
"""
import re

# ---- pull in bake_sprites (which pulls in bake_fur) without its command dispatch ----
_here = __file__
__file__ = _here.replace('bake_card.py', 'bake_sprites.py')  # bake_sprites locates bake_fur.py through __file__
_s = open(__file__).read()
exec(compile(_s[:_s.rindex("\nif ARGS[0] == 'bounds'")], 'bake_sprites.py', 'exec'), globals())
__file__ = _here
_neck_orig = neck_height  # bake_cards() replaces neck_height for build_fur

YAWS = [0.22, 0.33, 0.44, 0.55, 0.66]
FOV = 26.0
ASPECT = 240.0 / 320.0
CARD_W, CARD_H, CARD_MUL = 480, 640, 2
LIMIT = 220000
CARD_JSON = W + '/card.json'
SPECIES_JS = os.path.join(REPO, 'src', 'office-species.js')
SITE_MANIFEST = os.path.join(REPO, 'site', 'assets', 'scene', 'sprites', 'manifest.json')
BG = np.array([0xff, 0xfd, 0xf8], np.float32) / 255.0


def card_species():
    keys = re.findall(r"row\('([a-z]+)'", open(SPECIES_JS).read())
    return [k for k in keys if k != 'ghost']


def import_pose(sp, keep):
    bpy.ops.import_scene.gltf(filepath=os.path.join(CAST, sp + '-pose.glb'))
    return [o for o in bpy.data.objects if o.name not in keep and o.type == 'MESH']


def seated_neck(sp, keep):
    """The pose face has no eye highlights, so the neck rule of neck_height() takes its numbers from the seated model's head (same head)."""
    objs = import_species(sp, keep)
    by = {o.name.split('.')[0]: o for o in objs}
    face = mesh_arrays(by['face'])
    nk = _neck_orig(face)
    eye = [i for i, m in enumerate(face['mats']) if m and m.name.split('.')[0] == 'eye']
    ez = float(np.median(face['co'][np.unique(face['tv'][np.isin(face['tm'], eye)])][:, 2])) if eye else None
    clear_species(keep)
    return nk, ez


def merge_extra(face, extras):
    """Separate pose parts (wing flaps) join the `face` arrays: furry materials grow fur, the rest keeps strands away."""
    co, tv, tl, tm, cn = [face['co']], [face['tv']], [face['tl']], [face['tm']], [face['cn']]
    mats = list(face['mats'])
    nv, nl = len(face['co']), len(face['cn'])
    for o in extras:
        m = mesh_arrays(o)
        co.append(m['co'])
        tv.append(m['tv'] + nv)
        tl.append(m['tl'] + nl)
        tm.append(m['tm'] + len(mats))
        cn.append(m['cn'])
        mats += m['mats']
        nv += len(m['co'])
        nl += len(m['cn'])
    return dict(co=np.vstack(co), tv=np.vstack(tv), tl=np.vstack(tl), tm=np.concatenate(tm), cn=np.vstack(cn), uv=None, mats=mats)


def three_of(V):  # Blender (x, y, z) -> three (x, z, -y)
    return np.stack([V[:, 0], V[:, 2], -V[:, 1]], axis=1)


def card_camera(V):
    """office-scene.js: cam at (0, cy + hgt*0.12, dist) looking at (0, cy, 0), fov 26 vertical, aspect 240/320."""
    T = three_of(V)
    lo, hi = T.min(0), T.max(0)
    sz = hi - lo
    hgt = float(sz[1])
    cy = float(lo[1] + hgt * 0.5)
    tn = math.tan(FOV * math.pi / 360.0)
    rw = math.hypot(sz[0], sz[2]) / 2.0
    dist = max(hgt * 0.56 / tn, rw * 1.08 / (tn * ASPECT)) + rw
    return [0.0, cy + hgt * 0.12, float(dist)], [0.0, cy, 0.0], dict(min=lo.tolist(), max=hi.tolist())


def load_meta():
    if os.path.exists(CARD_JSON):
        return json.load(open(CARD_JSON))
    if os.path.exists(SITE_MANIFEST) and 'card' in json.load(open(SITE_MANIFEST)):
        c = json.load(open(SITE_MANIFEST))['card']
        return {'cell': c['cell'], 'yaws': c['yaws'], 'fov': c['fov'], 'species': dict(c['species'])}
    return {'cell': [CARD_W, CARD_H], 'yaws': YAWS, 'fov': FOV, 'species': {}}


def save_meta(meta):
    meta['cell'], meta['yaws'], meta['fov'] = [CARD_W, CARD_H], YAWS, FOV
    json.dump(meta, open(CARD_JSON + '.tmp', 'w'), indent=1)
    os.replace(CARD_JSON + '.tmp', CARD_JSON)


def project(scene, cam, p):
    from bpy_extras.object_utils import world_to_camera_view
    v = world_to_camera_view(scene, cam, Vector(tuple(float(c) for c in p)))
    return float(v.x), float(v.y)  # 0..1, y up


def bake_cards(keys, force):
    a = A()
    scene, cam, device = setup_scene(a)
    scene.render.resolution_x, scene.render.resolution_y = CARD_W * CARD_MUL, CARD_H * CARD_MUL
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(FOV)
    print('CARD device:', device, 'samples:', a.samples, 'render:', CARD_W * CARD_MUL, 'x', CARD_H * CARD_MUL, flush=True)
    keep = {o.name for o in bpy.data.objects}
    mat = fur_material(a)
    mat.use_fake_user = True
    meta = load_meta()
    global neck_height
    for sp in keys:
        name = sp + '-card'
        webp = '%s/%s.webp' % (OUT, name)
        if os.path.exists(webp) and not force:
            print('CARD %s exists, skipped' % sp, flush=True)
            continue
        t0 = time.time()
        rng = np.random.default_rng(sum(ord(ch) * (i + 7) for i, ch in enumerate(sp)))  # the same coat seed as the seated sprites
        nk, ez_seated = seated_neck(sp, keep)
        objs = import_pose(sp, keep)
        by = {o.name.split('.')[0]: o for o in objs}
        bpy.context.view_layer.update()
        V = all_verts(objs)
        camp, at, bb = card_camera(V)
        # blender camera position / target from the three ones
        cloc = Vector((camp[0], -camp[2], camp[1]))
        cat_ = Vector((at[0], -at[2], at[1]))
        tune_materials()
        stats = {}
        face = mesh_arrays(by['face'])
        eye = [i for i, m in enumerate(face['mats']) if m and m.name.split('.')[0] == 'eye']
        ez_pose = float(np.median(face['co'][np.unique(face['tv'][np.isin(face['tm'], eye)])][:, 2])) if eye else None
        extras = [o for n, o in by.items() if n not in ('chibi', 'face')]
        if 'chibi' in by and 'face' in by and sp != 'ghost':
            body = mesh_arrays(by['chibi'])
            if extras:
                face = merge_extra(face, extras)
            neck_height = lambda _f, _nk=nk: _nk  # the pose face lacks the eye highlights neck_height() reads
            pts, rad, col, stats = build_fur(a, sp, body, face, rng)
            make_curves(pts, rad, col, mat)
        stats['eye_dz'] = None if (ez_seated is None or ez_pose is None) else round(ez_pose - ez_seated, 4)
        t_r = time.time()
        root = bpy.data.objects.new('yaw', None)
        bpy.context.scene.collection.objects.link(root)
        for o in bpy.data.objects:
            if o.name not in keep and o is not root and o.parent is None:
                o.parent = root
        cam.location = cloc
        aim(cam, cat_ - cloc)
        bpy.context.view_layer.update()
        nose = V[int(np.argmin(V[:, 1]))]  # largest three z
        frames, frame_s, chk = [], [], []
        us = [9, -9]
        vs = [9, -9]
        for k, yaw in enumerate(YAWS):
            root.rotation_euler = (0, 0, yaw)
            bpy.context.view_layer.update()
            R = np.array(Rz(yaw))[:3, :3]
            Vr = V @ R.T
            pu = [project(scene, cam, p) for p in Vr[::max(1, len(Vr) // 4000)]]
            us = [min(us[0], min(p[0] for p in pu)), max(us[1], max(p[0] for p in pu))]
            vs = [min(vs[0], min(p[1] for p in pu)), max(vs[1], max(p[1] for p in pu))]
            chk.append(round(project(scene, cam, R @ nose)[0], 3))
            png = '%s/frames/%s_%d.png' % (W, name, k)
            scene.render.filepath = png
            t1 = time.time()
            bpy.ops.render.render(write_still=True)
            frame_s.append(round(time.time() - t1, 1))
            frames.append(bleed(shrink(load_rgba(png), CARD_MUL)))
        sheet_png = '%s/sheets/%s.png' % (W, name)
        write_png(sheet_png, np.concatenate(frames, axis=1))
        q, size = to_webp(sheet_png, webp, LIMIT)
        meta['species'][sp] = dict(cam=[round(v, 5) for v in camp], at=[round(v, 5) for v in at])
        save_meta(meta)
        info = dict(bytes=size, seconds=round(time.time() - t0, 1), q=q, fur_s=round(t_r - t0, 1), frame_s=frame_s,
                    bbox=[[round(v, 3) for v in bb['min']], [round(v, 3) for v in bb['max']]],
                    margin_u=[round(us[0], 3), round(us[1], 3)], margin_v=[round(vs[0], 3), round(vs[1], 3)],
                    nose_u_by_yaw=chk, stats=stats)
        json.dump(info, open('%s/frames/%s.json' % (W, name), 'w'))
        print('CARD %s done %s' % (sp, json.dumps(info)), flush=True)
        clear_species(keep)


def check(out, sp):
    px = load_rgba('%s/sheets/%s-card.png' % (W, sp))
    tiles = []
    for k in (0, 2, 4):
        f = px[:, k * CARD_W:(k + 1) * CARD_W]
        tiles.append(f[..., :3] * f[..., 3:4] + BG * (1 - f[..., 3:4]))
    img = np.concatenate(tiles, axis=1)
    write_png(out, np.concatenate([img, np.ones(img.shape[:2] + (1,), np.float32)], axis=-1).astype(np.float32))
    print('CHECK', out, img.shape, flush=True)


if ARGS[0] == 'card':
    ks = card_species() if ARGS[1] == 'all' else [k for k in ARGS[1].split(',') if k]
    bake_cards(ks, '--force' in ARGS)
elif ARGS[0] == 'check':
    check(ARGS[1], ARGS[2])
