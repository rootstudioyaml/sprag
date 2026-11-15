"""Fur sprite batch for the office cast (SPEC.md). Reuses the F2 method (bake_fur.py next to this file) with the SPEC cell geometry.

  Blender -b --factory-startup --python bake_sprites.py -- bounds --work WORK
  Blender -b --factory-startup --python bake_sprites.py -- bake cat:plain,cat:santa --work WORK [--force]
  Blender -b --factory-startup --python bake_sprites.py -- montage out.png cat-plain,chick-plain --work WORK

WORK is a scratch folder: WORK/out/<species>-<variant>.webp are the sheets, WORK/frames and WORK/sheets the full-size
frames and PNG sheets. The sheet geometry (Hu, uc, anchor, variants) is read from geom.json next to this file, which
pins the runtime's anchor and unitsPerPx; `bounds` writes a fresh one to WORK/geom.json and leaves the pinned one alone.
Finished sheets (WORK/out/<species>-<variant>.webp) are skipped, so a stopped batch continues where it was.
"""
import bmesh, re
_src = open(__file__.replace('bake_sprites.py', 'bake_fur.py')).read()
exec(compile(_src[:_src.rindex('\nmain()')], 'bake_fur.py', 'exec'), globals())
from mathutils import Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
if '--work' not in ARGS:
    sys.exit('--work DIR is required (scratch folder for out/, frames/, sheets/)')
_wi = ARGS.index('--work')
W = os.path.abspath(ARGS[_wi + 1])
del ARGS[_wi:_wi + 2]
OUT = W + '/out'
HERE = os.path.dirname(os.path.abspath(__file__))
GEOM = HERE + '/geom.json'  # pinned sheet geometry (see the docstring)
for _d in (OUT, W + '/frames', W + '/sheets'):
    os.makedirs(_d, exist_ok=True)
CW, CH, MUL = 384, 448, 2
COLS = [-34, -17, 0, 17, 34]
EL = math.radians(ELEV)
HAT_SKIP = {'panda', 'raccoon', 'squirrel'}
ANTLER_SKIP = HAT_SKIP | {'deer', 'unicorn', 'husky'}
NO_NOSE = {'eagle'}
NOSE_MAT = re.compile(r'^(nose|nos|nose_disc|beak)(\.\d+)?$')
CONV = Matrix.Rotation(math.pi / 2, 4, 'X')  # three (x, y, z) -> Blender (x, -z, y)
Tr = lambda x, y, z: Matrix.Translation((x, y, z))
Rx = lambda a: Matrix.Rotation(a, 4, 'X')
Rz = lambda a: Matrix.Rotation(a, 4, 'Z')


class A:  # the F2 final settings (run_bake.sh, run_bake_chick.sh)
    px = CW * MUL; cell = CW; samples = 128; ortho = 1.9; pivot = 0.5; count = 460000; length = 0.024; radius = 0.0026
    jitter = 0.30; lift = 1.0; root = 0.8; ysat = 1.0; sat = 1.4; curl = 0.12; shader = 'hair'; nofur = False; denoise = 1
    exposure = 0.45; sun = 2.4; rim = 2.6; sky = 0.55; tag = ''; extents = False; maskdebug = False


# ---------- holiday wear: the shapes and places of site/assets/scene/holiday.js ----------
def hmat(name, hexc, rough, metal=0.0, emit=0.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = hexlin(hexc) + (1.0,)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Roughness'].default_value = 0.5
    if emit:
        b.inputs['Emission Color'].default_value = hexlin(hexc) + (1.0,)
        b.inputs['Emission Strength'].default_value = emit
    return m


def put(name, bm, M, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    o = bpy.data.objects.new('hol_' + name, me)
    bpy.context.scene.collection.objects.link(o)
    o.matrix_world = CONV @ M
    return o


def sphere(r, M=Matrix.Identity(4), bm=None, seg=24):
    bm = bm or bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg * 2 // 3, radius=r, matrix=M @ Rx(-math.pi / 2))
    return bm


def cone(rb, rt, h):  # axis +Y like three's CylinderGeometry
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=rb, radius2=rt, depth=h, matrix=Rx(-math.pi / 2))
    return bm


def torus(R, r, arc=2 * math.pi, su=40, sv=14):
    bm = bmesh.new()
    full = arc > 6.28
    nu = su if full else su + 1
    vs = []
    for i in range(nu):
        u = arc * i / su
        for j in range(sv):
            v = 2 * math.pi * j / sv
            vs.append(bm.verts.new(((R + r * math.cos(v)) * math.cos(u), (R + r * math.cos(v)) * math.sin(u), r * math.sin(v))))
    for i in range(su):
        i2 = (i + 1) % nu
        if not full and i + 1 >= nu:
            break
        for j in range(sv):
            j2 = (j + 1) % sv
            bm.faces.new((vs[i * sv + j], vs[i2 * sv + j], vs[i2 * sv + j2], vs[i * sv + j2]))
    return bm


def tube(pts, r):
    P = [Vector(p) for p in pts]
    n = len(P) - 1
    sm = []
    for s in range(11):
        t = n * s / 10
        i = min(int(t), n - 1)
        f = t - i
        p0 = P[i - 1] if i > 0 else P[0] * 2 - P[1]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 <= n else P[n] * 2 - P[n - 1]
        sm.append(0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3))
    bm = bmesh.new()
    for a, b in zip(sm, sm[1:]):
        d = b - a
        bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=r, radius2=r, depth=d.length, matrix=Matrix.Translation((a + b) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4())
        sphere(r, Matrix.Translation(a), bm, 10)
    sphere(r * 1.15, Matrix.Translation(sm[-1]), bm, 10)
    return bm


def santa():
    red = hmat('h_red', '#e8505b', 0.75, sheen=0.5)
    fur = hmat('h_fur', '#fffaf0', 1.0, sheen=0.6)
    G = Tr(0, 1.03, -0.02) @ Rx(-0.12)
    put('rim', torus(0.19, 0.05), G @ Tr(0, 0.025, 0) @ Rx(math.pi / 2), fur)
    SEG = [(0.175, 0.135, 0.13), (0.135, 0.09, 0.13), (0.09, 0.012, 0.14)]
    J, y = G, 0.04
    for i, (rb, rt, h) in enumerate(SEG):
        J = J @ Tr(0, y, 0) @ Rz(-0.42 if i else -0.12)
        put('seg%d' % i, cone(rb, rt, h), J @ Tr(0, h / 2, 0), red)
        y = h
    put('ball', sphere(0.048), J @ Tr(0, 0.15, 0), fur)


def antlers():
    brown = hmat('a_brown', '#8a5a3c', 0.85, sheen=0.3)
    band = hmat('a_band', '#d9534f', 0.6)
    gold = hmat('a_gold', '#f5c542', 0.3, 0.5)
    leaf = hmat('a_leaf', '#2f7d4f', 0.8)
    berry = hmat('a_berry', '#e8505b', 0.3)
    G = Tr(0, 0.69, -0.02) @ Rx(-0.1)
    put('arc', torus(0.345, 0.02, math.pi * 0.78, 32, 10), G @ Rz(math.pi * 0.11), band)
    for s in (-1, 1):
        at = lambda x, y, z=0: (s * 0.19 + s * x, 0.285 + y, z)
        put('st1', tube([at(0, -0.02), at(0.03, 0.08), at(0.07, 0.17), at(0.06, 0.26)], 0.021), G, brown)
        put('st2', tube([at(0.035, 0.1), at(0.09, 0.15), at(0.14, 0.2)], 0.016), G, brown)
        put('st3', tube([at(0.065, 0.2), at(0.0, 0.25), at(-0.03, 0.31)], 0.014), G, brown)
        put('bell', sphere(0.026), G @ Tr(s * 0.335, 0.075, 0.05), gold)
        put('leaf', sphere(0.04), G @ Tr(s * 0.045, 0.365, 0.07) @ Rx(0.35) @ Rz(s * 0.45) @ Matrix.Diagonal((1.6, 0.35, 0.8, 1)), leaf)
    put('berry', sphere(0.022), G @ Tr(0, 0.37, 0.085), berry)


def nose_tip(objs):
    """noseTipOf() of holiday.js, in three coordinates: middle of the nose bounds sideways and up, and their front edge."""
    pts = []
    for o in objs:
        names = [(m.name if m else '') for m in o.data.materials]
        for p in o.data.polygons:
            if p.material_index < len(names) and NOSE_MAT.match(names[p.material_index]):
                pts += [o.matrix_world @ o.data.vertices[i].co for i in p.vertices]
    if not pts:
        return None
    a = np.array(pts)
    lo, hi = a.min(0), a.max(0)
    return ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2, -lo[1])


def red_nose(tip):
    put('rnose', sphere(0.05), Tr(tip[0], tip[1], tip[2] - 0.004), hmat('r_nose', '#ff3b3b', 0.18, 0, 0.5))


def variants_of(sp, has_nose):
    v = ['plain']
    if sp == 'ghost':
        return v
    if sp not in HAT_SKIP:
        v.append('santa')
    if sp not in ANTLER_SKIP:
        v.append('reindeer')
    if has_nose and sp not in NO_NOSE:
        v.append('nose')
    return v


# ---------- geometry ----------
def axes(k):
    a = math.radians(AZ0 + COLS[k])
    d = Vector((math.sin(a) * math.cos(EL), -math.cos(a) * math.cos(EL), math.sin(EL)))
    r = Vector((math.cos(a), math.sin(a), 0))
    u = Vector((-math.sin(a) * math.sin(EL), math.cos(a) * math.sin(EL), math.cos(EL)))
    return d, r, u


def species_list():
    return sorted(f[:-4] for f in os.listdir(CAST) if f.endswith('.glb') and not f.endswith('-pose.glb'))


def import_species(sp, keep):
    bpy.ops.import_scene.gltf(filepath=os.path.join(CAST, sp + '.glb'))
    return [o for o in bpy.data.objects if o.name not in keep and o.type == 'MESH']


def all_verts(objs):
    out = []
    for o in objs:
        co = np.empty(len(o.data.vertices) * 3, np.float32)
        o.data.vertices.foreach_get('co', co)
        M = np.array(o.matrix_world)
        out.append(co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3])
    return np.concatenate(out)


def bounds():
    keep = {o.name for o in bpy.data.objects}
    rmax, umin, umax, per, noses = 0, 9, -9, {}, {}
    for sp in species_list():
        objs = import_species(sp, keep)
        noses[sp] = nose_tip(objs) is not None
        if sp not in HAT_SKIP and sp != 'ghost':
            santa()
        if sp not in ANTLER_SKIP and sp != 'ghost':
            antlers()
        bpy.context.view_layer.update()
        V = all_verts([o for o in bpy.data.objects if o.name not in keep and o.type == 'MESH'])
        e = [0, 9, -9]
        for k in range(5):
            d, r, u = axes(k)
            pr, pu = V @ np.array(r), V @ np.array(u)
            e = [max(e[0], float(np.abs(pr).max())), min(e[1], float(pu.min())), max(e[2], float(pu.max()))]
        per[sp] = [round(x, 3) for x in e]
        rmax, umin, umax = max(rmax, e[0]), min(umin, e[1]), max(umax, e[2])
        clear_species(keep)
    Hu = max((umax - umin) * 1.12, 2 * rmax * 1.12 * CH / CW)
    uc = (umax + umin) / 2
    upp = Hu / CH
    g = dict(elev=round(ELEV, 3), Hu=Hu, unitsPerPx=upp, uc=uc, anchor=[CW / 2, round(CH / 2 + uc / upp, 2)], rmax=rmax, umin=umin, umax=umax, per=per,
             variants={sp: variants_of(sp, noses[sp]) for sp in per})
    json.dump(g, open(W + '/geom.json', 'w'), indent=1)
    print('BOUNDS', json.dumps({k: v for k, v in g.items() if k not in ('per', 'variants')}), flush=True)


# ---------- images ----------
def bleed(px, iters=16):
    rgb, al = px[..., :3].copy(), px[..., 3]
    known = al > 0.004
    rgb[~known] = 0
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(al.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = np.roll(known, (dy, dx), axis=(0, 1))
            acc += np.roll(rgb, (dy, dx), axis=(0, 1)) * k[..., None]
            cnt += k
        new = ~known & (cnt > 0)
        rgb[new] = acc[new] / cnt[new][:, None]
        known |= new
    return np.concatenate([rgb, al[..., None]], axis=-1)


CWEBP = shutil.which('cwebp') or '/opt/homebrew/bin/cwebp'  # brew install webp


def to_webp(png, webp, limit=150000):
    enc = lambda q, m: subprocess.run([CWEBP, '-quiet', '-q', str(q), '-alpha_q', '100', '-exact', '-m', str(m), png, '-o', webp + '.tmp'], check=True)
    q = 94
    while True:  # quick search, then the slow encoder at the quality found
        enc(q, 3)
        if os.path.getsize(webp + '.tmp') <= limit * 0.99 or q <= 60:
            break
        q -= 2
    while True:
        enc(q, 6)
        if os.path.getsize(webp + '.tmp') <= limit or q <= 60:
            break
        q -= 2
    os.replace(webp + '.tmp', webp)
    return q, os.path.getsize(webp)


def merge_arrays(face, extra):
    """Holiday wear joins the hard parts of `face`, so no strand grows through a hat."""
    co, tv, tl, tm, mats = [face['co']], [face['tv']], [face['tl']], [face['tm']], list(face['mats'])
    nv = len(face['co'])
    for o in extra:
        m = mesh_arrays(o)
        co.append(m['co'])
        tv.append(m['tv'] + nv)
        tl.append(np.zeros_like(m['tl']))
        tm.append(np.full(len(m['tv']), len(mats), dtype=np.int32))
        mats.append(m['mats'][0])
        nv += len(m['co'])
    return dict(co=np.vstack(co), tv=np.vstack(tv), tl=np.vstack(tl), tm=np.concatenate(tm), cn=face['cn'], uv=face['uv'], mats=mats)


def bake(jobs, force):
    g = json.load(open(GEOM))
    Hu, upp2 = g['Hu'], g['Hu'] / (CH * MUL)
    C = Vector((0.0, 0.0, g['uc'] / math.cos(EL)))
    a = A()
    scene, cam, device = setup_scene(a)
    scene.render.resolution_x, scene.render.resolution_y = CW * MUL, CH * MUL
    cam.data.ortho_scale = Hu  # the taller side
    print('SPR device:', device, 'samples:', a.samples, 'Hu: %.4f' % Hu, flush=True)
    keep = {o.name for o in bpy.data.objects}
    mat = fur_material(a)
    mat.use_fake_user = True
    for sp, var in jobs:
        name = '%s-%s' % (sp, var)
        webp = '%s/%s.webp' % (OUT, name)
        if (os.path.exists(webp) and not force) or os.path.exists('%s/frames/%s.skip' % (W, name)):
            print('SPR %-18s exists, skipped' % name, flush=True)
            continue
        if var not in g['variants'][sp]:
            print('SPR %-18s not a variant of this species, skipped' % name, flush=True)
            continue
        t0 = time.time()
        rng = np.random.default_rng(sum(ord(ch) * (i + 7) for i, ch in enumerate(sp)))  # by species: every variant grows the same coat
        objs = import_species(sp, keep)
        by = {o.name.split('.')[0]: o for o in objs}
        tip = nose_tip(objs) if var in ('reindeer', 'nose') and sp not in NO_NOSE else None
        if var == 'santa':
            santa()
        if var == 'reindeer':
            antlers()
        if tip:
            red_nose(tip)
        bpy.context.view_layer.update()
        wear = [o for o in bpy.data.objects if o.name.startswith('hol_')]
        tune_materials()
        stats = {}
        if 'chibi' in by and 'face' in by and sp != 'ghost':
            body, face = mesh_arrays(by['chibi']), mesh_arrays(by['face'])
            pts, rad, col, stats = build_fur(a, sp, body, merge_arrays(face, wear) if wear else face, rng)
            make_curves(pts, rad, col, mat)
        t_r = time.time()
        patch = bool(wear) and '--full' not in ARGS  # only the wear differs from plain: render the part of the frame around it and lay it over the plain frame
        if patch and not all(os.path.exists('%s/frames/%s-plain_%d.png' % (W, sp, k)) for k in range(5)):
            patch = False
        if patch:
            WV = all_verts(wear) - np.array(C)
            below = 0.40 if var == 'santa' else 0.10  # the hat shades the forehead
        frames, frame_s = [], []
        for k in range(5):
            d, r, u = axes(k)
            cam.location = C + d * 12.0
            aim(cam, -d)
            png = '%s/frames/%s_%d.png' % (W, name, k)
            scene.render.use_border = False
            t1 = time.time()
            if patch:
                pr, pu = WV @ np.array(r) / upp2 + CW * MUL / 2, WV @ np.array(u) / upp2 + CH * MUL / 2  # y from the bottom
                mg = 0.10 / upp2
                x0, x1 = max(0, int(pr.min() - mg)), min(CW * MUL, int(pr.max() + mg))
                y0, y1 = max(0, int(pu.min() - below / upp2)), min(CH * MUL, int(pu.max() + mg))
                scene.render.use_border, scene.render.use_crop_to_border = True, False
                scene.render.border_min_x, scene.render.border_max_x = x0 / (CW * MUL), x1 / (CW * MUL)
                scene.render.border_min_y, scene.render.border_max_y = y0 / (CH * MUL), y1 / (CH * MUL)
                scene.render.filepath = png[:-4] + '_patch.png'
                bpy.ops.render.render(write_still=True)
                pa, pl = load_rgba(png[:-4] + '_patch.png'), load_rgba('%s/frames/%s-plain_%d.png' % (W, sp, k))
                H, Wd = pa.shape[:2]
                yy, xx = np.mgrid[0:H, 0:Wd]
                yb = H - 1 - yy
                edge = np.minimum(np.minimum(xx - x0, x1 - 1 - xx), np.minimum(yb - y0, y1 - 1 - yb))
                edge = np.where((x0 == 0) | (x1 == Wd) | (y1 == H), np.minimum(np.where(x0 == 0, 999, xx - x0), np.minimum(np.where(x1 == Wd, 999, x1 - 1 - xx), np.minimum(yb - y0, np.where(y1 == H, 999, y1 - 1 - yb)))), edge)
                m = np.clip((edge - 3) / 28.0, 0, 1)[..., None]
                pa[..., :3] *= pa[..., 3:4]
                pl[..., :3] *= pl[..., 3:4]
                mix = pl * (1 - m) + pa * m
                al = mix[..., 3:4]
                full = np.concatenate([np.where(al > 1e-6, mix[..., :3] / np.maximum(al, 1e-6), 0.0).clip(0, 1), al], axis=-1)
                write_png(png, full)
            else:
                scene.render.filepath = png
                bpy.ops.render.render(write_still=True)
                full = load_rgba(png)
            frame_s.append(round(time.time() - t1, 1))
            frames.append(bleed(shrink(full, MUL)))
        scene.render.use_border = False
        sheet_png = '%s/sheets/%s.png' % (W, name)
        write_png(sheet_png, np.concatenate(frames, axis=1))
        q, size = to_webp(sheet_png, webp)
        info = dict(name=name, q=q, bytes=size, fur_s=round(t_r - t0, 1), frame_s=frame_s, total_s=round(time.time() - t0, 1), tip=[round(float(v), 4) for v in tip] if tip else None, patch=patch, stats=stats)
        json.dump(info, open('%s/frames/%s.json' % (W, name), 'w'))
        print('SPR %-18s done %s' % (name, json.dumps(info)), flush=True)
        clear_species(keep)


def montage(out, names, scale=2):
    rows = []
    for n in names:
        px = load_rgba('%s/sheets/%s.png' % (W, n))
        h, w = px.shape[:2]
        tile = (((np.mgrid[0:h, 0:w][0] // 32 + np.mgrid[0:h, 0:w][1] // 32) % 2) * 0.10 + 0.42)[..., None] * np.array([0.9, 1.0, 1.15])
        rgb = px[..., :3] * px[..., 3:4] + tile * (1 - px[..., 3:4])
        rows.append(np.concatenate([rgb, np.ones((h, w, 1))], axis=-1))
    sheet = np.concatenate(rows, axis=0).astype(np.float32)
    if scale > 1:
        h, w = sheet.shape[:2]
        sheet = sheet[:h // scale * scale, :w // scale * scale].reshape(h // scale, scale, w // scale, scale, 4).mean(axis=(1, 3))
    write_png(out, sheet)
    print('MONTAGE', out, sheet.shape, flush=True)


if ARGS[0] == 'bounds':
    bounds()
elif ARGS[0] == 'bake':
    bake([tuple(j.split(':')) for j in ARGS[1].split(',') if j], '--force' in ARGS)
elif ARGS[0] == 'montage':
    montage(ARGS[1], ARGS[2].split(','), int(ARGS[3]) if len(ARGS) > 3 else 2)
