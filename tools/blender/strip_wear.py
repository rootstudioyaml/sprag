"""캐스트 glb에서 원래 생성기가 구워 넣은 착용물(모자, 리본, 헤드폰, 목도리, 안경, 목걸이 등)을 지웁니다.
대상은 이름이 acc_ 로 시작하는 재질과 EXTRA 목록에 적은 재질의 면이며, 어느 면에도 쓰이지 않게 된 정점과 빈 재질 칸도 함께 없앱니다.
몸통(chibi)과 얼굴 부품의 위치, UV, 텍스처는 건드리지 않습니다.
Blender -b --factory-startup --python strip_wear.py -- <srcdir> <outdir|-> <keys,comma|all>
outdir 를 - 로 주면 지우지 않고 파일마다 재질 이름과 면 수, 지울지 여부만 출력합니다(검사 전용). 내보내기 설정은 fix_slivers.py 와 같습니다."""
import bpy, bmesh, sys, os, glob, numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
src, out, keys = argv[0], argv[1], argv[2]
keys = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(src, '*.glb'))) if keys == 'all' else keys.split(',')
DRY = out == '-'
# acc_ 로 시작하지 않지만 착용물인 재질입니다. 렌더로 확인해 정확한 이름만 적습니다.
EXTRA = set()
wear = lambda name: name.startswith('acc_') or name in EXTRA
if not DRY: os.makedirs(out, exist_ok=True)


def bbox(o):
    n = len(o.data.vertices); co = np.empty(n * 3, dtype=np.float64); o.data.vertices.foreach_get('co', co)
    co = co.reshape(n, 3); return n, co.min(axis=0), co.max(axis=0)


for k in keys:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, k + '.glb'))
    hit = 0
    for o in sorted([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: o.name):
        me = o.data
        mi = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
        names = [m.name if m else '-' for m in me.materials]
        for i, name in enumerate(names):
            print('MAT', k, o.name, name, int((mi == i).sum()), 'DELETE' if wear(name) else 'keep')
        dead = [i for i, name in enumerate(names) if wear(name)]
        bad = np.isin(mi, dead)
        if not bad.any(): continue
        hit += int(bad.sum())
        if DRY: continue
        before = bbox(o)
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.where(bad)[0]], context='FACES')  # 면과 그 면만 쓰던 모서리, 정점을 지움
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(me); bm.free(); me.update()
        # 빈 재질 칸을 지우고 남은 면의 재질 번호를 앞으로 당깁니다. clear 가 번호를 0으로 되돌리므로 번호는 마지막에 씁니다.
        mi = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
        used = sorted(set(mi.tolist())); remap = np.zeros(max(len(names), 1), dtype=np.int32)
        for new, old in enumerate(used): remap[old] = new
        mats = [me.materials[i] for i in used]
        me.materials.clear()
        for m in mats: me.materials.append(m)
        me.polygons.foreach_set('material_index', remap[mi]); me.update()
        after = bbox(o)
        print('STRIP', k, o.name, 'verts %d -> %d' % (before[0], after[0]), 'bbox', np.round(before[1], 4).tolist(), np.round(before[2], 4).tolist(), '->', np.round(after[1], 4).tolist(), np.round(after[2], 4).tolist())
    print('STRIPPED' if hit and not DRY else 'FOUND' if hit else 'CLEAN', k, hit)
    if DRY or not hit: continue
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, k + '.glb'), export_format='GLB', export_draco_mesh_compression_enable=True, export_image_format='AUTO', export_yup=True, export_apply=False)
