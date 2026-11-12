"""캐스트 glb에서 길게 늘어난 슬리버 면만 지웁니다. 원래 생성기가 목도리(acc_nks_c1)에 가끔 정점 하나를 멀리 보내서 귀까지 가는 가는 선이 생겼습니다.
재질별로 면의 가장 긴 모서리를 재서 (그 재질 99퍼센타일 x RATIO)와 MIN을 모두 넘는 면만 지우고 어느 면에도 쓰이지 않는 정점도 함께 지웁니다.
Blender -b --factory-startup --python fix_slivers.py -- <srcdir> <outdir|-> <keys,comma|all> [ratio=2] [min=0.25]
outdir 를 - 로 주면 지우지 않고 해당 면만 출력합니다(검사 전용). 내보내기 설정은 lift_heads.py 와 같습니다."""
import bpy, bmesh, sys, os, glob, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
src, out, keys = argv[0], argv[1], argv[2]
RATIO = float(argv[3]) if len(argv) > 3 else 2.0; MIN = float(argv[4]) if len(argv) > 4 else 0.25
keys = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(src, '*.glb'))) if keys == 'all' else keys.split(',')
DRY = out == '-'
if not DRY: os.makedirs(out, exist_ok=True)
for k in keys:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, k + '.glb'))
    hit = 0
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        me = o.data; n = len(me.vertices); M = np.array(o.matrix_world, dtype=np.float64)
        co = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(n, 3).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
        mi = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
        L = np.zeros(len(me.polygons))
        for pi, p in enumerate(me.polygons):
            v = co[list(p.vertices)]; L[pi] = np.linalg.norm(v - np.roll(v, 1, axis=0), axis=1).max()
        bad = np.zeros(len(L), dtype=bool)
        for m in set(mi.tolist()):
            sel = mi == m; bad |= sel & (L > RATIO * np.percentile(L[sel], 99)) & (L > MIN)
        if not bad.any(): continue
        mat = lambda pi: me.materials[mi[pi]].name if mi[pi] < len(me.materials) and me.materials[mi[pi]] else '-'
        for pi in np.where(bad)[0]:
            c = co[list(me.polygons[pi].vertices)].mean(axis=0)
            print('SLIVER', k, o.name, mat(pi), 'len %.3f' % L[pi], 'center %.3f %.3f %.3f' % tuple(c))
        hit += int(bad.sum())
        if DRY: continue
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.where(bad)[0]], context='FACES')  # 면과 그 면만 쓰던 모서리, 정점을 지움
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(me); bm.free(); me.update()
    print('FIXED' if hit and not DRY else 'FOUND' if hit else 'CLEAN', k, hit)
    if DRY or not hit: continue
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, k + '.glb'), export_format='GLB', export_draco_mesh_compression_enable=True, export_image_format='AUTO', export_yup=True, export_apply=False)
