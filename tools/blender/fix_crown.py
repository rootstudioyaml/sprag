"""캐스트 glb에서 착용물을 지운 뒤 드러난 정수리 자국을 고칩니다. 모자 아래에 가려 있던 피부 텍스처의 네모난 얼룩과 띠 자국, 모자 테가 눌렀던 주름이 대상입니다.
몸통 메시 chibi의 텍스처(기본색과 노멀 맵)에서 정수리 면이 쓰는 텍셀만 고칩니다. 주변 털과 색이 다른 텍셀을 찾아 주변 털의 색으로 바꾸되 털의 잔무늬는 남기고 가장자리는 부드럽게 섞습니다.
종 표의 crease 항목이 있는 종만 주름 띠의 chibi 정점을 표면을 따라 고르게 폅니다. UV와 다른 메시는 건드리지 않습니다.
Blender -b --factory-startup --python fix_crown.py -- <srcdir> <outdir|-> <keys,comma|all>
outdir 를 - 로 주면 파일을 쓰지 않고 판정 결과만 출력합니다. 환경변수 CROWN_DEBUG=<폴더> 를 주면 UV 공간 진단 그림을 씁니다. 내보내기 설정은 fix_slivers.py 와 같습니다."""
import bpy, sys, os, glob, math, struct, tempfile, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
src, out, keys = argv[0], argv[1], argv[2]
PRE = argv[3] if len(argv) > 3 else None  # 착용물을 지우기 전 glb 폴더(footprint 종에만 필요)
DRY = out == '-'
DEBUG = os.environ.get('CROWN_DEBUG')

# 종마다 고칠 범위입니다. 각도는 머리 구 중심에서 본 방향이고 elev 는 수평에서 위로 잰 각도, az 는 정면 0도에서 뒤로 갈수록 180도입니다.
# e0: 이 높이 위만 정수리로 봅니다. front: (az, elev) 정면 쪽으로 az 안이면서 elev 아래인 곳은 얼굴 무늬라서 빼는 범위입니다.
# ref: 기준 털 색을 재는 띠(elev 범위)입니다. thr: 기준 털 색과의 거리 문턱입니다. nrm: 노멀 맵도 같은 마스크로 고칠지입니다.
# keep_dark: 이 밝기보다 어두운 텍셀은 무늬(치타 점)라서 지키지 않습니다. crease: 주름 띠를 펼 elev 범위와 반복 횟수입니다.
SPECIES = {
    'raccoon': dict(e0=20, front=(60, 50), ref=(0, 25), thr=0.10, nrm=True),
    'squirrel': dict(e0=15, front=(50, 35), ref=(0, 20), thr=0.06, nrm=True, footprint=0.03),
    'cheetah': dict(e0=15, front=(40, 30), ref=(0, 20), thr=0.08, nrm=True, keep_dark=0.30, footprint=0.03),
    'chick': dict(e0=25, front=(40, 40), ref=(5, 30), thr=0.04, nrm=True),
    'dragon': dict(e0=10, front=(70, 15), ref=(0, 25), thr=0.06, nrm=True, footprint=0.03),
}
MIN_BLOB = 150  # 이보다 작은 자국 덩어리는 털 잔무늬로 봅니다
RMAX = 1.07  # 머리 구 반지름의 이 배수를 넘는 곳(귀, 뿔)은 정수리가 아닙니다
if keys == 'all': keys = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(src, '*.glb')) if os.path.basename(p)[:-4].replace('-pose', '') in SPECIES)
else: keys = keys.split(',')
if not DRY: os.makedirs(out, exist_ok=True)
if DEBUG: os.makedirs(DEBUG, exist_ok=True)


def wco(o):
    me = o.data; n = len(me.vertices); co = np.empty(n * 3); me.vertices.foreach_get('co', co)
    M = np.array(o.matrix_world); return co.reshape(n, 3) @ M[:3, :3].T + M[:3, 3]


def sphere(p):
    """정점 묶음에 구를 맞춥니다. 귀처럼 튀어나온 점은 잔차로 걸러 내고 다시 맞춥니다."""
    keep = np.ones(len(p), bool)
    for _ in range(4):
        q = p[keep]; A = np.c_[2 * q, np.ones(len(q))]; b = (q ** 2).sum(1)
        x = np.linalg.lstsq(A, b, rcond=None)[0]; c = x[:3]; R = math.sqrt(x[3] + c @ c)
        res = np.linalg.norm(p - c, axis=1) - R; mad = np.median(np.abs(res[keep])) + 1e-6
        keep = np.abs(res) < 3 * mad
    return c, R


def gblur(a, s):
    """FFT 가우시안 흐림. 가장자리는 3시그마만큼 0으로 덧대어 감기지 않게 합니다."""
    if s <= 0: return a.copy()
    p = int(3 * s) + 1; sh = a.shape
    b = np.pad(a, [(p, p), (p, p)] + [(0, 0)] * (a.ndim - 2))
    fy = np.fft.fftfreq(b.shape[0])[:, None]; fx = np.fft.rfftfreq(b.shape[1])[None, :]
    G = np.exp(-2 * math.pi ** 2 * s * s * (fy ** 2 + fx ** 2))
    if a.ndim == 3: G = G[..., None]
    r = np.fft.irfft2(np.fft.rfft2(b, axes=(0, 1)) * G, s=b.shape[:2], axes=(0, 1))
    return r[p:p + sh[0], p:p + sh[1]]


def nconv(a, m, s):
    w = gblur(m.astype(np.float64), s); v = gblur(a * m[..., None], s)
    return v / np.maximum(w, 1e-9)[..., None], w


def raster(me, co, W, H):
    """UV 공간에 삼각형을 그려 텍셀마다 면 번호와 월드 위치를 얻습니다. 텍셀 중심이 삼각형 안에 있으면 그 면의 텍셀입니다."""
    me.calc_loop_triangles(); T = me.loop_triangles; n = len(T)
    lt = np.empty(n * 3, np.int32); T.foreach_get('loops', lt); lt = lt.reshape(n, 3)
    vt = np.empty(n * 3, np.int32); T.foreach_get('vertices', vt); vt = vt.reshape(n, 3)
    pi = np.empty(n, np.int32); T.foreach_get('polygon_index', pi)
    uv = np.empty(len(me.loops) * 2); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    fid = np.full((H, W), -1, np.int32); pos = np.zeros((H, W, 3))
    for t in range(n):
        a = uv[lt[t]] * [W, H] - 0.5
        x0, y0 = np.floor(a.min(0)).astype(int); x1, y1 = np.ceil(a.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0: continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (a[1, 1] - a[2, 1]) * (a[0, 0] - a[2, 0]) + (a[2, 0] - a[1, 0]) * (a[0, 1] - a[2, 1])
        if abs(d) < 1e-12: continue
        l0 = ((a[1, 1] - a[2, 1]) * (X - a[2, 0]) + (a[2, 0] - a[1, 0]) * (Y - a[2, 1])) / d
        l1 = ((a[2, 1] - a[0, 1]) * (X - a[2, 0]) + (a[0, 0] - a[2, 0]) * (Y - a[2, 1])) / d
        l2 = 1 - l0 - l1; ins = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not ins.any(): continue
        P = l0[..., None] * co[vt[t, 0]] + l1[..., None] * co[vt[t, 1]] + l2[..., None] * co[vt[t, 2]]
        sub = fid[y0:y1 + 1, x0:x1 + 1]; sub[ins] = pi[t]; pos[y0:y1 + 1, x0:x1 + 1][ins] = P[ins]
    # 섬 가장자리 텍셀 한 줄: 어느 면의 중심도 아니지만 쌍선형 보간으로 그 면에 섞여 보이므로 가장 가까운 면에 붙입니다.
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(fid, (dy, dx), (0, 1)); npos = np.roll(pos, (dy, dx), (0, 1))
        hole = (fid < 0) & (nb >= 0); fid[hole] = nb[hole]; pos[hole] = npos[hole]
    return fid, pos


def jpeg_quality(data):
    """JPEG 의 첫 양자화표를 표준 휘도표와 비교해 품질 값을 거꾸로 구합니다. 다시 저장할 때 같은 표를 쓰기 위해서입니다."""
    std = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
           18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]
    i = data.find(b'\xff\xdb'); q = list(data[i + 5:i + 5 + 64])
    zz = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
          35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]
    best = None
    for Q in range(1, 101):
        sc = 5000 / Q if Q < 50 else 200 - 2 * Q
        tab = [min(max((s * sc + 50) // 100, 1), 255) for s in std]
        err = sum(abs(tab[zz[k]] - q[k]) for k in range(64))
        if best is None or err < best[0]: best = (err, Q)
    return best[1], best[0]


def acc_tree(path, C, R):
    """지우기 전 glb 를 따로 읽어 머리 근처 착용물 면으로 BVH 를 만듭니다. 목걸이처럼 머리 구에서 먼 면은 뺍니다."""
    before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=path); new = [o for o in bpy.data.objects if o not in before]
    tris = []
    for o in new:
        if o.type != 'MESH': continue
        me = o.data; me.calc_loop_triangles(); co = wco(o)
        for t in me.loop_triangles:
            m = me.materials[t.material_index]
            if not (m and m.name.startswith('acc_')): continue
            c = co[list(t.vertices)].mean(0)
            if np.linalg.norm(c - C) < 1.6 * R and c[2] > C[2] - 0.2 * R: tris.append(co[list(t.vertices)])
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    if not tris: raise SystemExit('no head wear in ' + path)
    v = np.concatenate(tris); return BVHTree.FromPolygons([tuple(map(float, x)) for x in v], [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(tris))])


def save_img(px, path):
    H, W = px.shape[:2]; im = bpy.data.images.new('dbg', W, H)
    im.pixels.foreach_set(np.c_[px.reshape(-1, 3), np.ones(H * W)].astype(np.float32).ravel())
    im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)


def repair(img, region, ref_m, bad, line, key, tag):
    """region 안에서 bad 텍셀을 둘레 털의 저주파 색과 털 잔무늬로 바꿉니다. 바뀐 텍셀 수와 UV 범위를 돌려줍니다."""
    W, H = img.size; a = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(a)
    a = a.reshape(H, W, 4); rgb = a[..., :3].astype(np.float64)
    good = ref_m & ~(gblur(bad.astype(float), 3) > 0.02)
    # 저주파 목표색: 좋은 털 텍셀만으로 정규화 흐림. 구멍이 크면 더 넓은 반경을 씁니다.
    low = np.zeros_like(rgb); done = np.zeros((H, W), bool)
    for s in (6, 12, 24, 48, 96):
        v, w = nconv(rgb, good, s); f = ~done & (w > 0.05); low[f] = v[f]; done |= f
    low[~done] = np.median(rgb[good], 0) if good.any() else rgb[~done]
    # 잔무늬는 자국 텍셀 자신의 고주파 성분을 씁니다. 원래 구운 무늬라서 UV 섬 경계를 넘어도 이어집니다.
    # 경계의 중간색이 섞이지 않도록 자국을 3텍셀 깎은 속(core)에서만 재고 세기는 좋은 털에 맞춥니다.
    # 자국이 털보다 매끈하면(병아리) 모자라는 만큼만 좋은 털의 무늬를 거울 타일로 더합니다.
    hp = rgb - nconv(rgb, good, 4)[0]
    core = bad & ~(gblur((~bad).astype(float), 1.5) > 0.03)
    own = np.where(core[..., None], rgb - nconv(rgb, core, 3)[0], 0.0)
    sg = float(hp[good].mean(-1).std()); so = float(own[core].mean(-1).std()) if core.any() else 0.0
    gain = float(np.clip(sg / max(so, 1e-6), 0.15, 2.5)); deficit = math.sqrt(max(0.0, 1 - (gain * so / max(sg, 1e-6)) ** 2))
    ys, xs = np.where(good)
    S = 48; best = None
    for _ in range(400):
        k = np.random.randint(len(ys)); y, x = ys[k] - S // 2, xs[k] - S // 2
        if y < 0 or x < 0 or y + S > H or x + S > W: continue
        c = good[y:y + S, x:x + S].mean()
        if best is None or c > best[0]: best = (c, y, x)
        if c > 0.995: break
    tile = hp[best[1]:best[1] + S, best[2]:best[2] + S]
    tile = np.concatenate([tile, tile[:, ::-1]], 1); tile = np.concatenate([tile, tile[::-1]], 0)
    det = np.tile(tile, (H // (2 * S) + 1, W // (2 * S) + 1, 1))[:H, :W]
    cw = np.clip(gblur(core.astype(float), 1.0), 0, 1)[..., None]  # 속에서 경계로 갈수록 자기 무늬를 줄입니다
    lw = np.clip(gblur(line.astype(float), 1.5) * 1.5, 0, 1)[..., None]  # 착용물이 덮었던 부분은 자기 무늬 대신 좋은 털의 무늬를 씁니다
    new = low + own * gain * cw * (1 - lw) + det * np.maximum(deficit, lw)
    wgt = np.clip(gblur(bad.astype(float), 1.5) * 1.6, 0, 1) * region  # 가장자리를 섞고 정수리 밖은 0
    out = rgb * (1 - wgt[..., None]) + new * wgt[..., None]
    a[..., :3] = np.clip(out, 0, 1)
    ch = (np.abs(a[..., :3] - rgb) > 0.5 / 255).any(-1)
    print('TEX', key, tag, 'fur_std %.4f own_std %.4f gain %.2f tile_share %.2f' % (sg, so, gain, deficit), 'changed', int(ch.sum()), 'outside_region', int((ch & ~region).sum()))
    return a, ch


def label(m):
    H, W = m.shape; lab = np.zeros((H, W), np.int32); comps = []
    for y, x in zip(*np.where(m)):
        if lab[y, x]: continue
        n = len(comps) + 1; st = [(y, x)]; lab[y, x] = n; pts = []
        while st:
            cy, cx = st.pop(); pts.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not lab[ny, nx]: lab[ny, nx] = n; st.append((ny, nx))
        comps.append(np.array(pts))
    return comps


def blobs(m, n):
    keep = np.zeros_like(m)
    for p in label(m):
        if len(p) >= n: keep[p[:, 0], p[:, 1]] = True
    return keep


def boxes(ch):
    """바뀐 텍셀을 연결 덩어리로 묶어 UV 경계 상자를 셉니다(8칸 이웃, 큰 것부터)."""
    H, W = ch.shape
    return sorted(((len(p), p[:, 1].min() / W, p[:, 0].min() / H, (p[:, 1].max() + 1) / W, (p[:, 0].max() + 1) / H) for p in label(ch)), reverse=True)


def pack_jpeg(img, a, q):
    """고친 픽셀을 원본과 같은 품질의 JPEG 로 저장해 이미지에 다시 넣습니다. 이름과 색 공간은 그대로 둡니다."""
    W, H = img.size; tmp = os.path.join(tempfile.mkdtemp(), img.name + '.jpg')
    # save_render 는 장면의 보기 변환(AgX)을 입혀 색이 바뀌므로 쓰지 않습니다. Image.save 는 바이트를 그대로 씁니다.
    t = bpy.data.images.new('tmp', W, H); t.colorspace_settings.name = img.colorspace_settings.name
    t.pixels.foreach_set(a.astype(np.float32).ravel())
    t.file_format = 'JPEG'; t.filepath_raw = tmp; t.save(filepath=tmp, quality=q); bpy.data.images.remove(t)
    data = open(tmp, 'rb').read()
    img.pack(data=data, data_len=len(data)); img.reload()
    return len(data)


def crease(o, C, R, rng, key):
    """주름 띠(elev 범위)를 폅니다. 띠 경계로 갈수록 약하게 섞습니다.
    glTF 는 UV 이음매에서 정점을 둘로 나누므로 같은 위치의 정점을 하나로 묶어 함께 움직입니다. 따로 움직이면 이음매가 벌어집니다."""
    e0, e1, passes = rng; me = o.data; co = wco(o); M = np.array(o.matrix_world)
    _, g, cnt = np.unique(np.round(co * 1e5).astype(np.int64), axis=0, return_inverse=True, return_counts=True); g = g.ravel(); G = len(cnt)
    gc = np.zeros((G, 3)); np.add.at(gc, g, co); gc /= cnt[:, None]
    d = gc - C; r = np.linalg.norm(d, axis=1); el = np.degrees(np.arcsin(np.clip(d[:, 2] / np.maximum(r, 1e-9), -1, 1)))
    head = r < RMAX * R
    w = np.clip(np.minimum(el - e0, e1 - el) / 4.0, 0, 1) * head
    ne = len(me.edges); ev = np.empty(ne * 2, np.int32); me.edges.foreach_get('vertices', ev); ge = g[ev.reshape(ne, 2)]
    ge = ge[(ge[:, 0] != ge[:, 1]) & head[ge[:, 0]] & head[ge[:, 1]]]  # 귀와 뿔 정점은 이웃 평균에 넣지 않습니다
    deg = np.bincount(ge.ravel(), minlength=G).astype(float)
    # 위치 라플라시안은 둥근 머리를 안으로 줄이므로 쓰지 않습니다. 구 중심에서 잰 거리만 이웃 평균으로 고르게 하고 방향은 그대로 둡니다.
    # 거리 장은 머리 모양을 따라 천천히 변하므로 넓은 모양은 남고 좁게 꺼진 주름만 메워집니다.
    dirs = d / np.maximum(r, 1e-9)[:, None]; rv = r.copy()
    for _ in range(passes):
        sm = np.zeros(G); np.add.at(sm, ge[:, 0], rv[ge[:, 1]]); np.add.at(sm, ge[:, 1], rv[ge[:, 0]])
        rv = np.where(deg > 0, rv + 0.5 * w * (sm / np.maximum(deg, 1) - rv), rv)
    p = co + (dirs * (rv - r)[:, None])[g]

    def prof(q, tag):
        """구 반지름 대비 정점 거리의 높이별 중앙값을 정면, 옆, 뒤로 나눠 출력합니다. 주름은 한 구간이 꺼진 모양으로 보입니다."""
        dq = q - C; rq = np.linalg.norm(dq, axis=1) / R; eq = np.degrees(np.arcsin(np.clip(dq[:, 2] / (rq * R), -1, 1)))
        aq = np.degrees(np.abs(np.arctan2(dq[:, 0], -dq[:, 1])))
        for nm, a0, a1 in (('front', 0, 60), ('side', 60, 120), ('back', 120, 181)):
            row = []
            for b in range(0, 80, 5):
                s = (eq >= b) & (eq < b + 5) & (aq >= a0) & (aq < a1) & (rq < RMAX)
                row.append('%d:%.3f' % (b, np.median(rq[s])) if s.sum() > 3 else '%d:-' % b)
            print('PROFILE', key, tag, nm, ' '.join(row))
    prof(co, 'before'); prof(p, 'after')
    disp = np.linalg.norm(p - co, axis=1); moved = disp > 1e-7
    gap = np.zeros(G); np.maximum.at(gap, g, np.linalg.norm(p - gc[g], axis=1)); gp = np.zeros((G, 3)); np.add.at(gp, g, p); gp /= cnt[:, None]
    print('CREASE', key, 'band %g..%g passes %d' % rng, 'moved', int(moved.sum()), 'max_disp %.5f' % disp.max(), 'head_R %.4f' % R,
          'seam_split_after %.2e' % float(np.linalg.norm(p - gp[g], axis=1).max()))
    if DRY: return
    Mi = np.linalg.inv(M); loc = p @ Mi[:3, :3].T + Mi[:3, 3]
    me.vertices.foreach_set('co', loc.astype(np.float32).ravel()); me.update()
    # 움직인 정점의 꼭짓점 노멀은 새 기하의 정점 노멀을 같은 위치 묶음끼리 평균해서 씁니다. 이음매 양쪽이 같은 노멀을 받습니다.
    L = len(me.loops); cn = np.empty(L * 3); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(L, 3)
    lv = np.empty(L, np.int32); me.loops.foreach_get('vertex_index', lv)
    vn = np.empty(len(co) * 3); me.vertex_normals.foreach_get('vector', vn); vn = vn.reshape(-1, 3)
    gn = np.zeros((G, 3)); np.add.at(gn, g, vn); gn /= np.maximum(np.linalg.norm(gn, axis=1, keepdims=True), 1e-9)
    sel = moved[lv]; cn[sel] = gn[g[lv[sel]]]
    me.normals_split_custom_set(cn.tolist()); me.update()


for k in keys:
    sp = SPECIES[k.replace('-pose', '')]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, k + '.glb'))
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    ch_o = next(o for o in objs if o.name.startswith('chibi')); face = next(o for o in objs if o.name.startswith('face'))
    fm = face.data; ei = [i for i, m in enumerate(fm.materials) if m and m.name == 'eye'][0]
    mi = np.empty(len(fm.polygons), np.int32); fm.polygons.foreach_get('material_index', mi)
    ev = sorted({v for p in np.where(mi == ei)[0] for v in fm.polygons[p].vertices}); ze = float(np.median(wco(face)[ev][:, 2]))
    co = wco(ch_o); C, R = sphere(co[co[:, 2] > ze])
    print('HEAD', k, 'eye_z %.4f centre %s R %.4f' % (ze, np.round(C, 4).tolist(), R))
    me = ch_o.data
    tex = nrm = None
    for n in me.materials[0].node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            if n.outputs[0].links and n.outputs[0].links[0].to_socket.name == 'Base Color': tex = n.image
            else: nrm = n.image
    W, H = tex.size
    fid, pos = raster(me, co, W, H)
    cov = fid >= 0; d = pos - C; r = np.linalg.norm(d, axis=-1); rr = r / R
    el = np.degrees(np.arcsin(np.clip(d[..., 2] / np.maximum(r, 1e-9), -1, 1)))
    az = np.degrees(np.abs(np.arctan2(d[..., 0], -d[..., 1])))  # 0 정면(-Y), 180 뒤
    head = cov & (rr < RMAX) & (rr > 0.85)
    fa, fe = sp['front']; facezone = (az < fa) & (el < fe)
    region = head & (el > sp['e0']) & ~facezone
    refm = head & (el > sp['ref'][0]) & (el < sp['ref'][1]) & (az > 90)
    px = np.empty(W * H * 4, np.float32); tex.pixels.foreach_get(px); rgb = px.reshape(H, W, 4)[..., :3].astype(np.float64)
    ref = np.median(rgb[refm], 0)
    # 잔무늬를 눌러 덩어리 색 차이만 봅니다
    sm = nconv(rgb, np.logical_or(region, refm), 2)[0]
    dist = np.linalg.norm(sm - ref, axis=-1)
    bad = region & (dist > sp['thr'])
    if 'keep_dark' in sp: bad &= rgb.mean(-1) > sp['keep_dark']
    # 털 잔무늬의 작은 점은 자국이 아니므로 MIN_BLOB 텍셀보다 작은 덩어리는 버립니다. 남은 자국은 2텍셀 넓혀 경계의 중간색까지 덮습니다.
    bad = blobs(bad, sp.get('min_blob', MIN_BLOB))
    bad = region & (gblur(bad.astype(float), 1.5) > 0.12)
    good_ref = head & (el > sp['ref'][0]) & (dist < sp['thr'])
    line = np.zeros_like(bad)
    if 'footprint' in sp:
        # 착용물 자리: 지우기 전 파일의 머리 착용물(acc_ 재질) 표면에서 footprint 거리 안에 있는 정수리 텍셀입니다.
        # 테가 눌렀던 가는 평행선은 털과 색이 비슷해 색 판정에 안 걸리므로 이 자리는 통째로 둘레 털의 무늬로 다시 칠합니다.
        acc = acc_tree(os.path.join(PRE, k + '.glb'), C, R)
        idx = np.where(region)
        dd = np.array([acc.find_nearest(Vector(pp))[3] for pp in pos[idx]])
        line[idx] = dd < sp['footprint']; bad |= line
        print('FOOTPRINT', k, 'within %.3f' % sp['footprint'], 'texels', int(line.sum()), 'of region', int(region.sum()))
    if os.environ.get('CROWN_PROBE'):
        for uv in os.environ['CROWN_PROBE'].split(';'):
            u, v = map(float, uv.split(',')); x, y = min(int(u * W), W - 1), min(int(v * H), H - 1)
            print('PROBE', k, uv, 'elev %.1f az %.1f r/R %.3f region %d bad %d line %d dist %.3f' % (el[y, x], az[y, x], rr[y, x], region[y, x], bad[y, x], line[y, x], dist[y, x]))
    print('REF', k, 'ref_rgb %s' % np.round(ref, 3).tolist(), 'region_texels', int(region.sum()), 'bad', int(bad.sum()),
          'dist_pct50/90/99 %.3f %.3f %.3f' % tuple(np.percentile(dist[region], [50, 90, 99])) if region.any() else '')
    if DEBUG:
        ov = rgb.copy(); ov[region] = ov[region] * 0.6 + np.array([0.0, 0.3, 0.6]) * 0.4; ov[bad] = ov[bad] * 0.4 + np.array([1, 0, 0]) * 0.6
        ov[refm] = ov[refm] * 0.6 + np.array([0, 0.6, 0]) * 0.4; ov[line] = ov[line] * 0.4 + np.array([1, 0, 1]) * 0.6
        heat = np.clip(dist / (3 * sp['thr']), 0, 1)[..., None] * np.array([1.0, 0.8, 0.2]) * (region | refm)[..., None]
        elv = np.where(head, np.clip(el / 90, 0, 1), 0)[..., None] * np.array([1.0, 1.0, 1.0])
        npx = np.empty(W * H * 4, np.float32); nrm.pixels.foreach_get(npx); nrgb = npx.reshape(H, W, 4)[..., :3]
        save_img(np.concatenate([rgb, ov, nrgb, heat + elv * 0.3], 1), os.path.join(DEBUG, k + '_uv.png'))
    if DEBUG:
        # 섬 경계에서의 거리별로 정수리 텍셀 밝기가 둘레보다 얼마나 어두운지 출력합니다(이음매 선 진단).
        lum = rgb.mean(-1); loc = nconv(rgb, region, 4)[0].mean(-1); ed = np.zeros((H, W), np.int32); cur = cov.copy()
        for i in range(1, 6):
            er = cur.copy()
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): er &= np.roll(cur, (dy, dx), (0, 1))
            ed[cur & ~er] = i; cur = er
        ed[cur] = 6
        print('EDGE', k, ' '.join('d%d:n=%d,dl=%+.3f' % (i, int((region & (ed == i)).sum()), float((lum - loc)[region & (ed == i)].mean())) for i in range(1, 7) if (region & (ed == i)).any()))
    changed = {}
    if bad.any():
        np.random.seed(7)
        a, chg = repair(tex, region, good_ref, bad, line, k, 'tex'); changed['tex'] = (tex, a, chg)
        if sp.get('nrm') and nrm is not None:
            np.random.seed(7)
            a2, chg2 = repair(nrm, region, good_ref, bad, line, k, 'nrm'); changed['nrm'] = (nrm, a2, chg2)
        for tag, (im, a, chg) in changed.items():
            bx = boxes(chg)
            print('BOX', k, tag, 'components', len(bx), ' '.join('%d@[%.3f,%.3f..%.3f,%.3f]' % b for b in bx[:6]))
    if 'crease' in sp: crease(ch_o, C, R, sp['crease'], k)
    if DEBUG and changed:
        save_img(np.concatenate([changed['tex'][1][..., :3]] + ([changed['nrm'][1][..., :3]] if 'nrm' in changed else []), 1), os.path.join(DEBUG, k + '_fixed.png'))
    if DRY or not (changed or 'crease' in sp): print('SKIP', k); continue
    for tag, (im, a, chg) in changed.items():
        o0 = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(o0); o0 = o0.reshape(H, W, 4)[..., :3]
        q, err = jpeg_quality(bytes(im.packed_file.data)); n = pack_jpeg(im, a, q)
        o1 = np.empty(W * H * 4, np.float32); im.pixels.foreach_get(o1); dd = np.abs(o1.reshape(H, W, 4)[..., :3] - o0).max(-1) * 255
        # 재압축 오차: 정수리 밖 텍셀이 원본에서 얼마나 달라졌는지(디코드 기준). 블록 단위 JPEG 라서 0 이 될 수는 없습니다.
        far = ~(gblur(region.astype(float), 6) > 1e-3)  # 정수리에서 16텍셀 넘게 떨어진 곳(같은 JPEG 블록을 공유하지 않음)
        print('PACK', k, tag, im.name, 'quality', q, 'qerr', err, 'bytes', n, 'outside_region_diff max %.0f p99 %.0f mean %.2f, far max %.0f p99 %.0f /255' % (
            dd[~region].max(), np.percentile(dd[~region], 99), dd[~region].mean(), dd[far].max(), np.percentile(dd[far], 99)))
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, k + '.glb'), export_format='GLB', export_draco_mesh_compression_enable=True, export_image_format='AUTO', export_yup=True, export_apply=False)
    print('FIXED', k)
