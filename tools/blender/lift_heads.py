"""머리를 목에서 위로 숙임 보정(카메라가 30도 위에서 보므로 얼굴을 들게 함). 텍스처와 UV는 건드리지 않습니다.
Blender -b --factory-startup --python improve.py -- <srcdir> <outdir> <keys,comma> [deg]"""
import bpy, sys, os, math, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
src, out, keys = argv[0], argv[1], argv[2].split(','); DEG = float(argv[3]) if len(argv) > 3 else 18.0
os.makedirs(out, exist_ok=True)
def get(me, coll, attr, n, d=3):
    a = np.empty(n * d, dtype=np.float32); coll.foreach_get(attr, a); return a.reshape(n, d).astype(np.float64)
for k in keys:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, k + '.glb'))
    objs = [o for o in bpy.data.objects if o.type == 'MESH']
    face = next((o for o in objs if any(m and m.name == 'white' for m in o.data.materials)), None)
    if face is None:  # pose 모델은 눈을 감아 하이라이트가 없으므로 같은 종 앉은 자세의 값을 받습니다
        ze, u = float(os.environ['ZE']), float(os.environ['U'])
    else:
        me = face.data; wi = [i for i, m in enumerate(me.materials) if m and m.name == 'white'][0]
        mi = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
        vs = sorted({v for p in np.where(mi == wi)[0] for v in me.polygons[p].vertices}); hv = get(me, me.vertices, 'co', len(me.vertices))[vs]
        ze = float(np.median(hv[:, 2])); u = float(np.percentile(hv[:, 0], 95) - np.percentile(hv[:, 0], 5)) / 0.26
    z0, z1 = ze - 0.27 * u, ze - 0.13 * u
    body = max(objs, key=lambda o: len(o.data.vertices)); bv = get(body.data, body.data.vertices, 'co', len(body.data.vertices))
    band = bv[(bv[:, 2] > z0) & (bv[:, 2] < z1)]; py, pz = float(band[:, 1].mean()), (z0 + z1) / 2
    print('IMP', k, 'eye_z %.3f unit %.2f neck %.3f..%.3f pivot_y %.3f' % (ze, u, z0, z1, py))
    for o in objs:
        m = o.data; n = len(m.vertices); co = get(m, m.vertices, 'co', n); L = len(m.loops)
        M = np.array(o.matrix_world, dtype=np.float64); R, T = M[:3, :3], M[:3, 3]; Ri = np.linalg.inv(R); co = co @ R.T + T
        if not np.allclose(M, np.eye(4), atol=1e-5): print('IMPNODE', k, o.name, 'zmax %.2f' % co[:, 2].max())
        cn = get(m, m.corner_normals, 'vector', L) @ R.T; lv = np.empty(L, dtype=np.int32); m.loops.foreach_get('vertex_index', lv)
        t = np.clip((co[:, 2] - z0) / (z1 - z0), 0, 1); w = t * t * (3 - 2 * t); a = -math.radians(DEG) * w; c, s = np.cos(a), np.sin(a)
        y, z = co[:, 1] - py, co[:, 2] - pz
        co[:, 1], co[:, 2] = py + y * c - z * s, pz + y * s + z * c
        m.vertices.foreach_set('co', ((co - T) @ Ri.T).astype(np.float32).ravel())
        cl, sl = c[lv], s[lv]; ny, nz = cn[:, 1].copy(), cn[:, 2].copy(); cn[:, 1], cn[:, 2] = ny * cl - nz * sl, ny * sl + nz * cl
        cn = cn @ Ri.T; cn /= np.maximum(np.linalg.norm(cn, axis=1, keepdims=True), 1e-9); m.normals_split_custom_set(cn.tolist()); m.update()
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, k + '.glb'), export_format='GLB', export_draco_mesh_compression_enable=True, export_image_format='AUTO', export_yup=True, export_apply=False)
