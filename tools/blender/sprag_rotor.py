# Blender 4.5: the Sprag mark (site/assets/logo/sprag-mark.svg) modelled as one machined part, not stacked slabs.
# Outer race and hub are turned profiles (spun 360 degrees) with chamfers and a groove; three sprags sit tilted between
# the races; three garter springs are real coils. The gap between the races stays open, as in the mark, and there is
# no ground or shadow, so the edges stay crisp on the page.
# The camera looks straight down with a little perspective, so the inner walls show depth. Lights and the world are the
# same from every side, so the page can rotate the picture without its highlights moving.
# usage: blender -b --factory-startup --python tools/blender/sprag_rotor.py -- <outdir> [size=1400] [samples=256]
#   writes sprag-rotor-xl.png (dark metal, for light pages) and sprag-rotor-light-xl.png (silver, for dark pages);
#   tools/blender/README.md has the webp step. Rendered with Blender 4.5 (Cycles, CPU).
import bpy, bmesh, math, sys

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
SIZE = int(argv[1]) if len(argv) > 1 else 1400
U = 1 / 29.0                                   # mark units -> model units (outer race edge = 1.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
col = sc.collection

def link(ob):
    col.objects.link(ob); return ob

def smooth(ob, angle=32):
    for p in ob.data.polygons: p.use_smooth = True
    m = ob.modifiers.new('sm', 'WEIGHTED_NORMAL'); m.keep_sharp = True
    try:
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        ob.select_set(False)
    except Exception:
        pass

def lathe(name, prof, steps=360):
    """prof: list of (r, z) going around the cross-section; spun about Z"""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    es = [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=steps, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me)); smooth(ob); return ob

def chamfered(r0, r1, z0, z1, c):
    return [(r0 + c, z0), (r1 - c, z0), (r1, z0 + c), (r1, z1 - c), (r1 - c, z1), (r0 + c, z1), (r0, z1 - c), (r0, z0 + c)]

def P(x, y):                                   # svg coords (64 grid, y down) -> model xy (y up)
    return ((x - 32) * U, -(y - 32) * U)

# ---------- outer race: wide chamfers, a turned groove on the face, a lip on the inner wall ----------
c = 0.02                                       # wide chamfers: they catch the horizon light as crisp bright edges
race = lathe('race', [
    (0.793 + c, 0.0), (1.0 - c, 0.0), (1.0, c), (1.0, 0.16 - c), (1.0 - c, 0.16),
    (0.915, 0.16), (0.912, 0.152), (0.888, 0.152), (0.885, 0.16),          # the groove
    (0.793 + 0.018, 0.16), (0.793 + 0.004, 0.148), (0.793, 0.148 - 0.004),   # a deeper chamfer on the inner top edge
    (0.793, 0.05), (0.775, 0.045), (0.775, 0.012), (0.775 + c * 0.6, 0.0)   # a lip that carries the cage
])

# ---------- hub: a raised collar around the bore, chamfers, and a keyway cut ----------
hub = lathe('hub', [
    (0.224 + 0.01, -0.01), (0.362 - c, -0.01), (0.362, -0.01 + c), (0.362, 0.19 - c), (0.362 - c, 0.19),
    (0.31, 0.19), (0.30, 0.2), (0.30, 0.225), (0.29, 0.235), (0.234, 0.235), (0.224, 0.225), (0.224, 0.0)
])
kw = link(bpy.data.objects.new('kw', bpy.data.meshes.new('kw')))
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bm.to_mesh(kw.data); bm.free()
kw.scale = (0.07, 0.05, 0.4); kw.location = (0.0, 0.245, 0.1)
b = hub.modifiers.new('kw', 'BOOLEAN'); b.object = kw; b.operation = 'DIFFERENCE'; b.solver = 'EXACT'
bpy.context.view_layer.objects.active = hub; bpy.ops.object.modifier_apply(modifier='kw')
bpy.data.objects.remove(kw)

# no cage plate: the gap between the races stays open, as in the mark

# ---------- sprags: the mark's blocks, scaled to sit between the races, wedged against both ----------
def rrect(cx, cy, w, h, r, ang, n=10):
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = sx * (w / 2 - r), sy * (h / 2 - r)
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            x, y = ox + r * math.cos(a), oy + r * math.sin(a)
            ca, sa = math.cos(ang), math.sin(ang)
            pts.append(P(cx + x * ca - y * sa, cy + x * sa + y * ca))
    return pts

def prism(name, pts, z0, z1, bev):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in pts]; top = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(bot[::-1]); bm.faces.new(top)
    for i in range(len(pts)):
        j = (i + 1) % len(pts); bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    m = ob.modifiers.new('bev', 'BEVEL'); m.width = bev; m.segments = 2; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(40)
    smooth(ob, 40); return ob

S = 0.78                                        # block scale so the sprag spans the gap between the races
sprags = []
for k in range(3):
    th = math.radians(-90 + 120 * k)
    rc = 16.6                                   # centre radius in mark units (mid gap)
    cx, cy = 32 + rc * math.cos(th), 32 + rc * math.sin(th)
    sprags.append(prism(f'sprag{k}', rrect(cx, cy, 15.2 * S, 11.2 * S, 0.3, th - math.radians(30)), 0.03, 0.128, 0.007))

# ---------- garter springs: coils along the mark's arcs ----------
def coil(name, r, a0, a1, rc=0.026, wire=0.0068, pitch=0.0135, z=0.075):
    a0, a1 = math.radians(a0), math.radians(a1)
    L = abs(a1 - a0) * r * U; turns = L / pitch; n = int(turns * 18)
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = wire; cu.bevel_resolution = 3
    sp = cu.splines.new('POLY'); sp.points.add(n)
    for i in range(n + 1):
        t = i / n; a = a0 + (a1 - a0) * t; ph = 2 * math.pi * turns * t
        x, y = P(32 + r * math.cos(a), 32 + r * math.sin(a))
        nx, ny = x / math.hypot(x, y), y / math.hypot(x, y)
        sp.points[i].co = (x + rc * math.cos(ph) * nx, y + rc * math.cos(ph) * ny, z + rc * math.sin(ph), 1)
    ob = link(bpy.data.objects.new(name, cu)); return ob

springs = [coil(f'spring{k}', 20.6, 204 + 120 * k, 246 + 120 * k) for k in range(3)]

# ---------- materials ----------
def metal(name, base, rough, aniso=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*base, 1); bs.inputs['Metallic'].default_value = 1.0
    bs.inputs['Roughness'].default_value = rough
    if aniso:
        bs.inputs['Anisotropic'].default_value = aniso                      # lathe-turned rings: circular brushing
        tg = nt.nodes.new('ShaderNodeTangent'); tg.direction_type = 'RADIAL'; tg.axis = 'Z'
        nt.links.new(tg.outputs['Tangent'], bs.inputs['Tangent'])
    return m

def paint(ob, m):
    ob.data.materials.clear(); ob.data.materials.append(m)

LOOKS = {
    # name: (race/hub, sprags, springs)
    'sprag-rotor-xl':       (((0.11, 0.115, 0.125), 0.30, 0.7), ((0.55, 0.56, 0.58), 0.24, 0), ((0.80, 0.80, 0.82), 0.16, 0)),
    'sprag-rotor-light-xl': (((0.70, 0.71, 0.73), 0.26, 0.7), ((0.24, 0.25, 0.27), 0.28, 0), ((0.86, 0.86, 0.88), 0.14, 0)),
}

# no ground and no shadow catcher: the part sits on the page with crisp edges, no soft shadow

# ---------- world and lights, the same from every side ----------
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; nt = w.node_tree
tc = nt.nodes.new('ShaderNodeTexCoord'); sx = nt.nodes.new('ShaderNodeSeparateXYZ'); ramp = nt.nodes.new('ShaderNodeValToRGB')
nt.links.new(tc.outputs['Generated'], sx.inputs[0]); nt.links.new(sx.outputs['Z'], ramp.inputs['Fac'])
r = ramp.color_ramp; r.elements[0].position = 0.0; r.elements[0].color = (0.02, 0.02, 0.02, 1)
r.elements[1].position = 1.0; r.elements[1].color = (0.35, 0.35, 0.36, 1)
for pos, v in ((0.48, 0.03), (0.52, 1.0), (0.62, 0.9), (0.70, 0.18), (0.88, 0.28)):   # dark floor, a bright horizon band, a soft top
    e = r.elements.new(pos); e.color = (v, v, v * 1.02, 1)
bg = nt.nodes['Background']; nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 1.0
ld = bpy.data.lights.new('top', 'AREA'); ld.shape = 'DISK'; ld.size = 2.2; ld.energy = 220
lo = link(bpy.data.objects.new('top', ld)); lo.location = (0, 0, 4.5); lo.visible_glossy = False
bpy.ops.mesh.primitive_torus_add(major_radius=2.8, minor_radius=0.14, location=(0, 0, 1.1), major_segments=128)
ring = bpy.context.object; rm = bpy.data.materials.new('ring'); rm.use_nodes = True
em = rm.node_tree.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 16
rm.node_tree.links.new(em.outputs[0], rm.node_tree.nodes['Material Output'].inputs['Surface']); ring.data.materials.append(rm)
ring.visible_camera = False

# ---------- camera: straight down, mild perspective (outer top edge at 87% of the half frame, as before) ----------
cd = bpy.data.cameras.new('c'); cd.lens = 38.2; cd.sensor_width = 36
cam = link(bpy.data.objects.new('c', cd)); cam.location = (0, 0, 2.6); sc.camera = cam

sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = int(argv[2]) if len(argv) > 2 else 256; sc.cycles.use_denoising = True
sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'

for name, (rh, sp_, sg) in LOOKS.items():
    mr = metal('rh', *rh); ms = metal('sp', *sp_); mg = metal('sg', *sg)
    paint(race, mr); paint(hub, mr)
    for o in sprags: paint(o, ms)
    for o in springs: o.data.materials.clear(); o.data.materials.append(mg)
    sc.render.filepath = f'{out}/{name}.png'
    bpy.ops.render.render(write_still=True)
print('done')
