// The town props (site/assets/scene/props/town-props.glb) are built by tools/blender/props_town.py.
// The page looks the meshes up by name and reads only geometry and COLOR_0, so these checks pin the names,
// the vertex color attribute and the size budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const GLB = new URL('site/assets/scene/props/town-props.glb', root);
const NAMES = [
  'tree_round_trunk', 'tree_round_canopy', 'tree_tall_trunk', 'tree_tall_canopy', 'pine_trunk',
  'pine_canopy', 'bush_canopy', 'lamp_pole', 'lamp_head',
];

function readGltfJson() {
  const b = readFileSync(GLB);
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  assert.equal(b.readUInt32LE(4), 2, 'glTF version 2');
  const jsonLen = b.readUInt32LE(12);
  assert.equal(b.toString('ascii', 16, 20), 'JSON');
  return JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
}

test('town-props.glb exists and stays under 200 KB', () => {
  const size = statSync(GLB).size;
  assert.ok(size > 2_000 && size <= 200 * 1024, `town-props.glb is ${size} bytes`);
});

test('town-props.glb has the nine named meshes and every primitive carries COLOR_0', () => {
  const gltf = readGltfJson();
  const byName = new Map((gltf.meshes || []).map(m => [m.name, m]));
  for (const name of NAMES) {
    const mesh = byName.get(name);
    assert.ok(mesh, `mesh ${name} is missing`);
    assert.ok(mesh.primitives.length >= 1, `${name} has no primitives`);
    for (const prim of mesh.primitives) {
      assert.ok('COLOR_0' in prim.attributes, `${name} has no COLOR_0`);
      assert.ok('POSITION' in prim.attributes, `${name} has no POSITION`);
    }
  }
});

test('town-props.glb is Draco compressed', () => {
  const gltf = readGltfJson();
  assert.ok((gltf.extensionsUsed || []).includes('KHR_draco_mesh_compression'));
});
