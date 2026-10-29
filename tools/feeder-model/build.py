#!/usr/bin/env python3
"""
Build the OptiFeed feeder model from tools/feeder-model/dimensions.json.

Machine space: X right, Y up, Z forward (towards the operator).
Blender space is Z-up, so machine (x, y, z) -> Blender (x, -z, y).
The glTF exporter converts Blender Z-up to glTF Y-up; with this mapping the
exported model keeps +Y up and +Z forward, which is what the viewer expects.

Run headless:

  blender --background --factory-startup --python tools/feeder-model/build.py -- ^
    --dims tools/feeder-model/dimensions.json ^
    --glb apps/web/public/models/feeder-v1.0.0.glb ^
    --manifest apps/web/lib/feeder/model-manifest.json ^
    --preview docs/feeder
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

M = 0.001  # millimetres -> metres


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Build the OptiFeed feeder GLB.")
    parser.add_argument("--dims", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--preview", default="")
    parser.add_argument("--version", default="1.0.0")
    parser.add_argument("--contract", type=int, default=1)
    parser.add_argument("--skip-preview", action="store_true")
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# Space helpers
# ---------------------------------------------------------------------------


def bp(x: float, y: float, z: float) -> tuple[float, float, float]:
    """Machine point -> Blender point."""
    return (x * M, -z * M, y * M)


def bsize(sx: float, sy: float, sz: float) -> tuple[float, float, float]:
    """Machine size (X, Y up, Z forward) -> Blender scale (X, Y, Z)."""
    return (sx * M, sz * M, sy * M)


def bdir(dx: float, dy: float, dz: float) -> Vector:
    """Machine direction -> Blender direction."""
    return Vector((dx, -dz, dy)).normalized()


def select_only(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def link(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for coll in list(obj.users_collection):
        coll.objects.unlink(obj)
    collection.objects.link(obj)


# ---------------------------------------------------------------------------
# Scene and materials
# ---------------------------------------------------------------------------


def reset_scene() -> bpy.types.Scene:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background:
        background.inputs[0].default_value = (0.82, 0.84, 0.86, 1.0)
        background.inputs[1].default_value = 0.45
    scene.world = world
    return scene


def make_material(
    name: str,
    color: tuple[float, float, float],
    *,
    roughness: float = 0.5,
    metallic: float = 0.0,
    transmission: float = 0.0,
    emission: tuple[float, float, float] | None = None,
    emission_strength: float = 0.0,
    alpha: float = 1.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, alpha)

    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError(f"Principled BSDF missing on {name}")

    def set_input(names: tuple[str, ...], value) -> None:
        for key in names:
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = value
                return

    set_input(("Base Color",), (*color, 1.0))
    set_input(("Roughness",), roughness)
    set_input(("Metallic",), metallic)
    set_input(("Transmission Weight", "Transmission"), transmission)
    set_input(("Alpha",), alpha)
    set_input(("IOR",), 1.45)
    if emission is not None:
        set_input(("Emission Color", "Emission"), (*emission, 1.0))
        set_input(("Emission Strength",), emission_strength)

    if alpha < 1.0 or transmission > 0.0:
        for attr, value in (("blend_method", "BLEND"), ("surface_render_method", "BLENDED")):
            try:
                setattr(mat, attr, value)
            except Exception:
                pass
        mat.show_transparent_back = False
    return mat


def build_materials() -> dict[str, bpy.types.Material]:
    return {
        "paint_white": make_material("Paint_White", (0.86, 0.87, 0.85), roughness=0.42),
        "paint_white_dim": make_material("Paint_White_Dim", (0.78, 0.79, 0.77), roughness=0.5),
        "paint_black": make_material("Paint_Black", (0.025, 0.028, 0.03), roughness=0.48),
        # Alpha blending, not transmission: the GLB viewer has no environment map,
        # so transmissive glass would render nearly black in the browser.
        "glass": make_material("Glass_PET", (0.97, 0.99, 1.0), roughness=0.02, alpha=0.05),
        "tube_glass": make_material("Glass_Tube", (0.88, 0.95, 0.99), roughness=0.18, alpha=0.42),
        "rubber": make_material("Rubber_Black", (0.012, 0.012, 0.012), roughness=0.88),
        "rubber_brown": make_material("Rubber_Coupling", (0.42, 0.16, 0.10), roughness=0.78),
        "pvc_brown": make_material("PVC_Brown", (0.36, 0.10, 0.08), roughness=0.52),
        "funnel_gray": make_material("Funnel_Gray", (0.55, 0.56, 0.55), roughness=0.45),
        "glass_rim": make_material("Glass_Rim", (0.78, 0.84, 0.87), roughness=0.32),
        "auger_dark": make_material("Auger_Dark", (0.05, 0.05, 0.05), roughness=0.45, metallic=0.5),
        "cable_red": make_material("Cable_Red", (0.55, 0.04, 0.05), roughness=0.62),
        "cable_gray": make_material("Cable_Gray", (0.20, 0.21, 0.22), roughness=0.7),
        "motor": make_material("Motor_Olive", (0.24, 0.23, 0.14), roughness=0.55, metallic=0.35),
        "silver": make_material("Metal_Silver", (0.72, 0.73, 0.74), roughness=0.25, metallic=1.0),
        "brass": make_material("Metal_Brass", (0.72, 0.55, 0.22), roughness=0.3, metallic=1.0),
        "plywood": make_material("Plywood", (0.55, 0.38, 0.21), roughness=0.72),
        "blue": make_material("Blue_PETG", (0.03, 0.20, 0.72), roughness=0.38),
        "red": make_material("Red_PVC", (0.62, 0.07, 0.09), roughness=0.48),
        "grain": make_material("Feed_Grain", (0.34, 0.22, 0.10), roughness=0.92, emission=(0.10, 0.05, 0.02), emission_strength=0.15),
        "label": make_material("Label_White", (0.95, 0.95, 0.94), roughness=0.35),
        "dark_text": make_material("Label_Dark", (0.04, 0.09, 0.14), roughness=0.5),
        "led_red": make_material("LED_Red", (0.9, 0.05, 0.05), roughness=0.3, emission=(1.0, 0.03, 0.02), emission_strength=4.0),
        "led_green": make_material("LED_Green", (0.05, 0.8, 0.2), roughness=0.3, emission=(0.05, 1.0, 0.15), emission_strength=3.0),
        "pcb": make_material("PCB_Blue", (0.02, 0.12, 0.3), roughness=0.45),
        "ground": make_material("Preview_Ground", (0.58, 0.60, 0.62), roughness=0.9),
    }


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def apply_modifier(obj: bpy.types.Object, mod: bpy.types.Modifier) -> None:
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def bevel_object(obj: bpy.types.Object, width_mm: float = 2.0, segments: int = 2) -> None:
    if width_mm <= 0:
        return
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width_mm * M
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(35)
    apply_modifier(obj, mod)


def cut_cylinder_hole(
    obj: bpy.types.Object,
    center: tuple[float, float, float],
    radius: float,
    depth: float,
) -> None:
    """Cut a vertical cylindrical hole through a horizontal panel."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=64,
        radius=radius * M,
        depth=depth * M,
        location=bp(*center),
    )
    cutter = bpy.context.object
    assert cutter is not None
    cutter.name = "Hole_Cutter"
    boolean = obj.modifiers.new("Hole", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.object = cutter
    try:
        boolean.solver = "EXACT"
    except Exception:
        pass
    apply_modifier(obj, boolean)
    bpy.data.objects.remove(cutter, do_unlink=True)


def add_box(
    name: str,
    size: tuple[float, float, float],
    center: tuple[float, float, float],
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    bevel_mm: float = 2.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=bp(*center))
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    obj.scale = bsize(*size)
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link(obj, collection)
    obj.data.materials.append(material)
    bevel_object(obj, bevel_mm)
    return obj


def add_cylinder(
    name: str,
    radius: float,
    depth: float,
    center: tuple[float, float, float],
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    axis: str = "Y",
    verts: int = 48,
    bevel_mm: float = 1.0,
    smooth: bool = True,
) -> bpy.types.Object:
    rotation = {
        "X": (0.0, math.pi / 2.0, 0.0),
        "Y": (0.0, 0.0, 0.0),
        "Z": (math.pi / 2.0, 0.0, 0.0),
    }[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts,
        radius=radius * M,
        depth=depth * M,
        location=bp(*center),
        rotation=rotation,
    )
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    link(obj, collection)
    obj.data.materials.append(material)
    if smooth:
        bpy.ops.object.shade_smooth()
    bevel_object(obj, bevel_mm)
    return obj


def add_tube(
    name: str,
    outer_radius: float,
    inner_radius: float,
    depth: float,
    center: tuple[float, float, float],
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    axis: str = "Y",
    verts: int = 64,
) -> bpy.types.Object:
    rotation = {
        "X": (0.0, math.pi / 2.0, 0.0),
        "Y": (0.0, 0.0, 0.0),
        "Z": (math.pi / 2.0, 0.0, 0.0),
    }[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts,
        radius=outer_radius * M,
        depth=depth * M,
        location=bp(*center),
        rotation=rotation,
        end_fill_type="NOTHING",
    )
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    link(obj, collection)
    obj.data.materials.append(material)

    solidify = obj.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = (outer_radius - inner_radius) * M
    solidify.offset = 1.0
    solidify.use_rim = True
    apply_modifier(obj, solidify)
    bpy.ops.object.shade_smooth()
    return obj


def add_lathe(
    name: str,
    profile: list[tuple[float, float]],
    center: tuple[float, float, float],
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    segments: int = 64,
    solidify_mm: float = 0.0,
    cap_bottom: bool = False,
    cap_top: bool = False,
) -> bpy.types.Object:
    """Revolve a (radius_mm, height_mm) profile around the machine Y axis."""
    verts: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []

    for radius, height in profile:
        r = max(radius, 0.4) * M
        z = height * M
        for index in range(segments):
            angle = 2.0 * math.pi * index / segments
            verts.append((r * math.cos(angle), r * math.sin(angle), z))

    for row in range(len(profile) - 1):
        for index in range(segments):
            nxt = (index + 1) % segments
            a = row * segments + index
            b = row * segments + nxt
            c = (row + 1) * segments + nxt
            d = (row + 1) * segments + index
            faces.append((a, b, c, d))

    if cap_bottom:
        faces.append(tuple(reversed(range(segments))))
    if cap_top:
        offset = (len(profile) - 1) * segments
        faces.append(tuple(offset + i for i in range(segments)))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = bp(*center)
    obj.data.materials.append(material)
    select_only(obj)
    bpy.ops.object.shade_smooth()

    if solidify_mm > 0:
        solidify = obj.modifiers.new("Solidify", "SOLIDIFY")
        solidify.thickness = solidify_mm * M
        solidify.offset = -1.0
        solidify.use_rim = True
        apply_modifier(obj, solidify)
    return obj


def add_poly_curve(
    name: str,
    points: list[tuple[float, float, float]],
    radius_mm: float,
    material: bpy.types.Material,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 6
    curve.bevel_depth = radius_mm * M
    curve.bevel_resolution = 2

    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for index, point in enumerate(points):
        spline.points[index].co = (*bp(*point), 1.0)

    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    select_only(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_text(
    name: str,
    body: str,
    size_mm: float,
    center: tuple[float, float, float],
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    face: str = "front",
) -> bpy.types.Object | None:
    """Text on a vertical face. `front` faces machine +Z, `right` faces +X."""
    try:
        rotation = (math.pi / 2.0, 0.0, 0.0) if face == "front" else (math.pi / 2.0, 0.0, math.pi / 2.0)
        bpy.ops.object.text_add(location=bp(*center), rotation=rotation)
        obj = bpy.context.object
        assert obj is not None
        obj.name = name
        obj.data.body = body
        obj.data.size = size_mm * M
        obj.data.extrude = 0.12 * M
        obj.data.align_x = "CENTER"
        obj.data.align_y = "CENTER"
        obj.data.resolution_u = 2
        select_only(obj)
        bpy.ops.object.convert(target="MESH")
        obj = bpy.context.object
        assert obj is not None
        obj.name = name
        link(obj, collection)
        obj.data.materials.append(material)
        return obj
    except Exception as exc:
        print(f"[warn] text '{name}' skipped: {exc}")
        return None


# ---------------------------------------------------------------------------
# Mounts and parenting
# ---------------------------------------------------------------------------


def add_mount(
    name: str,
    origin_machine: tuple[float, float, float],
    direction_machine: tuple[float, float, float],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    collection.objects.link(empty)
    empty.empty_display_size = 0.02
    empty.location = bp(*origin_machine)
    empty.rotation_mode = "QUATERNION"
    empty.rotation_quaternion = Vector((1.0, 0.0, 0.0)).rotation_difference(
        bdir(*direction_machine)
    )
    return empty


def parent_identity(child: bpy.types.Object, parent: bpy.types.Object) -> None:
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)


def add_tube_part_cylinder(
    name: str,
    mount: bpy.types.Object,
    local_x: float,
    radius: float,
    length: float,
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    bevel_mm: float = 0.8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=48,
        radius=radius * M,
        depth=length * M,
        location=(0.0, 0.0, 0.0),
        rotation=(0.0, math.pi / 2.0, 0.0),
    )
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    link(obj, collection)
    obj.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    bevel_object(obj, bevel_mm)
    parent_identity(obj, mount)
    obj.location = (local_x * M, 0.0, 0.0)
    return obj


def add_tube_part_open(
    name: str,
    mount: bpy.types.Object,
    local_x: float,
    outer_radius: float,
    inner_radius: float,
    length: float,
    material: bpy.types.Material,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=64,
        radius=outer_radius * M,
        depth=length * M,
        location=(0.0, 0.0, 0.0),
        rotation=(0.0, math.pi / 2.0, 0.0),
        end_fill_type="NOTHING",
    )
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    link(obj, collection)
    obj.data.materials.append(material)

    solidify = obj.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = (outer_radius - inner_radius) * M
    solidify.offset = 1.0
    solidify.use_rim = True
    apply_modifier(obj, solidify)
    bpy.ops.object.shade_smooth()

    parent_identity(obj, mount)
    obj.location = (local_x * M, 0.0, 0.0)
    return obj


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


def build(dims: dict, mats: dict[str, bpy.types.Material], collection: bpy.types.Collection) -> None:
    # --- Base plate -------------------------------------------------------
    base = dims["base_plate"]
    add_box(
        "Base_Plate",
        (base["width"], base["thickness"], base["depth"]),
        tuple(base["center"]),
        mats["paint_white"],
        collection,
        bevel_mm=2,
    )

    # --- Chassis ----------------------------------------------------------
    chassis = dims["chassis"]
    chassis_center = chassis["center"]
    chassis_w = chassis["width"]
    chassis_d = chassis["depth"]
    lid_t = chassis["lid_thickness"]
    body_h = chassis["height"] - lid_t
    body_center_y = chassis_center[1] - lid_t / 2.0
    add_box(
        "Chassis",
        (chassis_w, body_h, chassis_d),
        (chassis_center[0], body_center_y, chassis_center[2]),
        mats["paint_white"],
        collection,
        bevel_mm=4,
    )
    add_box(
        "Chassis_Lid",
        (chassis_w + 4, lid_t, chassis_d + 4),
        (chassis_center[0], body_center_y + body_h / 2.0 + lid_t / 2.0, chassis_center[2]),
        mats["paint_white"],
        collection,
        bevel_mm=2,
    )
    chassis_front = chassis_center[2] + chassis_d / 2.0
    chassis_back = chassis_center[2] - chassis_d / 2.0
    chassis_top = body_center_y + body_h / 2.0 + lid_t

    panel = dims["panel"]
    add_box(
        "Panel",
        (panel["width"], panel["height"], panel["depth"]),
        tuple(panel["center"]),
        mats["paint_black"],
        collection,
        bevel_mm=1.5,
    )
    panel_front = panel["center"][2] + panel["depth"] / 2.0

    sticker = dims["sticker"]
    add_box(
        "Sticker",
        (sticker["width"], sticker["height"], sticker["depth"]),
        tuple(sticker["center"]),
        mats["label"],
        collection,
        bevel_mm=1,
    )
    sticker_front = sticker["center"][2] + sticker["depth"] / 2.0

    dial = panel["dial_center"]
    add_cylinder(
        "Dial",
        panel["dial_diameter"] / 2.0,
        8,
        (dial[0], dial[1], panel_front + 3.0),
        mats["paint_black"],
        collection,
        axis="Z",
        verts=40,
        bevel_mm=1.5,
    )
    add_cylinder(
        "Dial_Cap",
        panel["dial_diameter"] / 2.0 - 4,
        2,
        (dial[0], dial[1], panel_front + 7.5),
        mats["silver"],
        collection,
        axis="Z",
        verts=40,
        bevel_mm=0.6,
    )
    add_cylinder(
        "Dial_Marker",
        1.3,
        9,
        (dial[0], dial[1] + panel["dial_diameter"] / 2.0 - 3, panel_front + 7.5),
        mats["label"],
        collection,
        axis="Z",
        verts=12,
        bevel_mm=0,
    )

    switch = panel["switch_center"]
    add_box(
        "Switch",
        (14, 8, 5),
        (switch[0], switch[1], panel_front + 2.5),
        mats["label"],
        collection,
        bevel_mm=1,
    )
    add_box(
        "Switch_Toggle",
        (5, 4, 7),
        (switch[0], switch[1] + 3, panel_front + 4),
        mats["silver"],
        collection,
        bevel_mm=0.6,
    )

    for index, led in enumerate(panel["led_centers"]):
        add_cylinder(
            f"LED_{'Power' if index == 0 else 'Status'}",
            3,
            3,
            (led[0], led[1], chassis_front + 1.5),
            mats["led_red"] if index == 0 else mats["led_green"],
            collection,
            axis="Z",
            verts=20,
            bevel_mm=0.5,
        )

    add_cylinder(
        "Chassis_Lock",
        5,
        4,
        (chassis_center[0], 20, chassis_front + 2),
        mats["silver"],
        collection,
        axis="Z",
        verts=24,
        bevel_mm=0.6,
    )

    hinge_y = chassis_top + 3
    hinge_z = chassis_back + 15
    for index, hinge_x in enumerate(
        (
            chassis_center[0] - chassis_w * 0.3,
            chassis_center[0] + chassis_w * 0.3,
        )
    ):
        add_box(
            f"Hinge_{index + 1}",
            (20, 5, 15),
            (hinge_x, hinge_y, hinge_z),
            mats["silver"],
            collection,
            bevel_mm=1,
        )

    # Side-panel screws from the reference photos.
    for index, (screw_y, screw_z) in enumerate(
        ((60, -150), (240, -150), (60, 150), (240, 150))
    ):
        add_cylinder(
            f"Chassis_Screw_{index + 1}",
            3,
            2,
            (chassis_center[0] + chassis_w / 2.0 + 1.5, screw_y, screw_z),
            mats["silver"],
            collection,
            axis="X",
            verts=16,
            bevel_mm=0.4,
        )

    # Sticker detail: logo bar, text, QR-like grid.
    add_box(
        "Sticker_LogoBar",
        (18, 3, 1),
        (sticker["center"][0] - 30, sticker["center"][1] + 22, sticker_front + 0.8),
        mats["blue"],
        collection,
        bevel_mm=0.3,
    )
    add_text(
        "Sticker_Text_Title",
        "Pakaon AI",
        5,
        (sticker["center"][0] + 8, sticker["center"][1] + 22, sticker_front + 0.8),
        mats["dark_text"],
        collection,
    )
    add_text(
        "Sticker_Text_Rating",
        "220V  1.2A   264VA",
        2.2,
        (sticker["center"][0] - 14, sticker["center"][1] + 5, sticker_front + 0.8),
        mats["dark_text"],
        collection,
    )
    add_text(
        "Sticker_Text_Model",
        "FEEDER CONTROLLER",
        1.8,
        (sticker["center"][0] - 16, sticker["center"][1] - 8, sticker_front + 0.8),
        mats["dark_text"],
        collection,
    )
    qr_origin = (sticker["center"][0] + 30, sticker["center"][1] - 2)
    for row in range(7):
        for col in range(7):
            if (row * 3 + col * 5) % 4 in (0, 1):
                add_box(
                    f"QR_{row}_{col}",
                    (1.6, 1.6, 0.4),
                    (qr_origin[0] + (col - 3) * 2.2, qr_origin[1] + (row - 3) * 2.2, sticker_front + 0.7),
                    mats["dark_text"],
                    collection,
                    bevel_mm=0,
                )

    add_text(
        "Panel_Text_Title",
        "MOTOR CONTROLLER",
        2.2,
        (panel["center"][0], panel["center"][1] + 42, panel_front + 0.8),
        mats["label"],
        collection,
    )
    add_text(
        "Panel_Text_Run",
        "RUN",
        1.7,
        (switch[0], switch[1] - 14, panel_front + 0.8),
        mats["label"],
        collection,
    )
    add_text(
        "Panel_Text_Stop",
        "STOP",
        1.7,
        (switch[0], switch[1] - 20, panel_front + 0.8),
        mats["label"],
        collection,
    )

    # --- Shelf and jar ----------------------------------------------------
    shelf = dims["shelf"]
    add_box(
        "Shelf",
        (shelf["width"], shelf["thickness"], shelf["depth"]),
        tuple(shelf["center"]),
        mats["paint_white"],
        collection,
        bevel_mm=1.5,
    )
    cut_cylinder_hole(
        bpy.data.objects["Shelf"],
        (dims["hopper"]["center"][0], shelf["center"][1], dims["hopper"]["center"][2]),
        shelf["hole_diameter"] / 2.0,
        shelf["thickness"] + 10,
    )
    cleat = dims["shelf_cleat"]
    add_box(
        "Shelf_Cleat",
        (cleat["width"], cleat["height"], cleat["depth"]),
        tuple(cleat["center"]),
        mats["paint_white_dim"],
        collection,
        bevel_mm=1,
    )
    support = dims["shelf_support"]
    add_box(
        "Shelf_Support",
        (support["width"], support["height"], support["depth"]),
        tuple(support["center"]),
        mats["paint_white"],
        collection,
        bevel_mm=1.5,
    )
    for index, screw_y in enumerate((100, 160)):
        add_cylinder(
            f"Shelf_Support_Screw_{index + 1}",
            3,
            1.5,
            (support["center"][0] - support["width"] / 2.0 - 0.5, screw_y, support["center"][2]),
            mats["silver"],
            collection,
            axis="X",
            verts=16,
            bevel_mm=0.3,
        )

    neck = dims["neck"]
    add_cylinder(
        "Neck_Collar",
        neck["diameter"] / 2.0,
        neck["height"],
        tuple(neck["center"]),
        mats["paint_white"],
        collection,
        axis="Y",
        verts=40,
        bevel_mm=1,
    )
    riser = dims["riser"]
    add_tube(
        "Feed_Riser",
        riser["outer_diameter"] / 2.0,
        riser["inner_diameter"] / 2.0,
        riser["height"],
        tuple(riser["center"]),
        mats["blue"],
        collection,
        axis="Y",
        verts=40,
    )

    hopper = dims["hopper"]
    hopper_height = hopper["height"]
    body_r = hopper["diameter"] / 2.0
    neck_r = hopper["neck_diameter"] / 2.0
    shoulder_r = hopper["shoulder_diameter"] / 2.0
    shoulder_h = hopper["shoulder_height"]
    body_h = hopper["body_start_height"]
    # One whole PET jar: threaded neck at the bottom, conical shoulder, then
    # the cylindrical body. The profile carries the bottle's horizontal ribs.
    hopper_profile = [
        (neck_r, 0),
        (neck_r + 3, 5),
        (neck_r + 10, 15),
        (neck_r + 20, 30),
        (55, 48),
        (70, 64),
        (shoulder_r, shoulder_h),
        (shoulder_r + 10, 90),
        (body_r - 2, 105),
        (body_r, body_h),
        (body_r, hopper_height - 30),
        (body_r - 2, hopper_height - 15),
        (body_r - 4, hopper_height - 5),
        (body_r - 5, hopper_height),
    ]
    ribbed: list[tuple[float, float]] = []
    ribs = {150, 210, 270, 330}
    for radius, height in hopper_profile:
        ribbed.append((radius, height))
    # Add ribs that fall on the long straight section rather than a profile point.
    for rib in sorted(ribs):
        ribbed.extend(((body_r, rib - 2), (body_r - 2.5, rib), (body_r, rib + 2)))
    ribbed.sort(key=lambda point: point[1])
    add_lathe(
        "Hopper_Glass",
        ribbed,
        tuple(hopper["center"]),
        mats["glass"],
        collection,
        segments=72,
        solidify_mm=hopper["wall"],
    )

    strap_radius = body_r + 3.0
    for index, strap_height in enumerate(hopper.get("strap_heights", [])):
        strap_y = hopper["center"][1] + float(strap_height)
        add_tube(
            f"Hopper_Strap_{index + 1}",
            strap_radius,
            strap_radius - 3.5,
            hopper["strap_width"],
            (hopper["center"][0], strap_y, hopper["center"][2]),
            mats["rubber"],
            collection,
            axis="Y",
            verts=64,
        )
        add_box(
            f"Strap_Buckle_{index + 1}",
            (22, 25, 6),
            (
                hopper["center"][0],
                strap_y,
                hopper["center"][2] + strap_radius,
            ),
            mats["rubber"],
            collection,
            bevel_mm=1,
        )

    lid = dims["lid"]
    add_cylinder(
        "Hopper_Lid",
        lid["diameter"] / 2.0,
        lid["thickness"],
        tuple(lid["center"]),
        mats["plywood"],
        collection,
        axis="Y",
        verts=72,
        bevel_mm=1,
    )
    for index, angle in enumerate((0, 120, 240)):
        radians = math.radians(angle)
        add_cylinder(
            f"Lid_Bolt_{index + 1}",
            3,
            2.5,
            (
                lid["center"][0] + 70 * math.cos(radians),
                lid["center"][1] + lid["thickness"] / 2.0 + 1,
                lid["center"][2] + 70 * math.sin(radians),
            ),
            mats["silver"],
            collection,
            axis="Y",
            verts=12,
            bevel_mm=0.3,
        )

    # --- Ultrasonic sensor on the lid ------------------------------------
    sensor = dims["sensor"]
    add_box(
        "Sensor_Gasket",
        (sensor["width"] + 4, 1, sensor["depth"] + 4),
        (sensor["center"][0], sensor["center"][1] - sensor["height"] / 2.0, sensor["center"][2]),
        mats["rubber"],
        collection,
        bevel_mm=0.3,
    )
    add_box(
        "Sensor_Top",
        (sensor["width"], sensor["height"], sensor["depth"]),
        tuple(sensor["center"]),
        mats["label"],
        collection,
        bevel_mm=0.8,
    )
    add_box(
        "Sensor_Connector",
        (10, 4, 2),
        (
            sensor["center"][0],
            sensor["center"][1],
            sensor["center"][2] + sensor["depth"] / 2.0 + 1,
        ),
        mats["paint_black"],
        collection,
        bevel_mm=0.3,
    )
    for index, direction in enumerate((-1, 1)):
        add_cylinder(
            f"Sensor_Transducer_{index + 1}",
            sensor["transducer_diameter"] / 2.0,
            sensor["transducer_height"],
            (
                sensor["center"][0],
                sensor["center"][1] + sensor["height"] / 2.0 + sensor["transducer_height"] / 2.0,
                sensor["center"][2] + direction * sensor["transducer_offset"],
            ),
            mats["paint_black"],
            collection,
            axis="Y",
            verts=20,
            bevel_mm=0.4,
        )
    add_box(
        "Sensor_Chip",
        (14, 4, 6),
        (
            sensor["center"][0],
            sensor["center"][1] - 1,
            sensor["center"][2] - sensor["depth"] / 2.0 - 2,
        ),
        mats["paint_black"],
        collection,
        bevel_mm=0.3,
    )

    # --- Sensor post and wire arm ----------------------------------------
    post = dims["post"]
    add_box(
        "Post",
        (post["width"], post["height"], post["depth"]),
        tuple(post["center"]),
        mats["paint_white"],
        collection,
        bevel_mm=1,
    )
    arm = dims["post_arm"]
    add_box(
        "Post_Arm",
        (arm["width"], arm["height"], arm["depth"]),
        tuple(arm["center"]),
        mats["paint_white"],
        collection,
        bevel_mm=1,
    )

    # --- Auger tube, motor, outlet ---------------------------------------
    tube = dims["tube"]
    yaw = math.radians(tube["yaw_deg"])
    pitch = math.radians(tube["pitch_deg"])
    direction = (
        math.cos(pitch) * math.cos(yaw),
        -math.sin(pitch),
        math.cos(pitch) * math.sin(yaw),
    )
    mount = add_mount("Tube_Mount", tuple(tube["start"]), direction, collection)
    length = tube["length"]
    radius_outer = tube["outer_diameter"] / 2.0
    radius_inner = radius_outer - tube["wall"]

    add_tube_part_open(
        "Tube_Glass",
        mount,
        length / 2.0,
        radius_outer,
        radius_inner,
        length,
        mats["tube_glass"],
        collection,
    )

    auger = dims["auger"]
    auger_length = length - 20
    add_helix(
        "Auger",
        mount,
        auger_length,
        auger["diameter"] / 2.0,
        auger["pitch"],
        auger["wire_diameter"] / 2.0,
        mats["auger_dark"],
        collection,
    )
    add_tube_part_cylinder(
        "Auger_Shaft",
        mount,
        length / 2.0,
        auger["shaft_diameter"] / 2.0,
        length,
        mats["auger_dark"],
        collection,
        bevel_mm=0.3,
    )

    # Blue inlet collar and vertical riser from the jar neck.
    add_tube(
        "Tube_Inlet_Blue",
        30,
        26,
        34,
        (dims["hopper"]["center"][0], tube["start"][1], dims["hopper"]["center"][2]),
        mats["blue"],
        collection,
        axis="Z",
        verts=40,
    )

    motor = dims["motor"]
    motor_center = -motor["offset_from_tube_start"]
    add_tube_part_cylinder(
        "Motor_Body",
        mount,
        motor_center,
        motor["body_diameter"] / 2.0,
        motor["body_length"],
        mats["motor"],
        collection,
        bevel_mm=1.5,
    )
    for index in range(5):
        add_tube_part_cylinder(
            f"Motor_Rib_{index + 1}",
            mount,
            motor_center - 50 + index * 20,
            motor["body_diameter"] / 2.0 + 0.8,
            1.6,
            mats["motor"],
            collection,
            bevel_mm=0,
        )
    add_cylinder(
        "Motor_End_Cap",
        motor["body_diameter"] / 2.0 - 4,
        10,
        (tube["start"][0], tube["start"][1], motor_center + tube["start"][2] - motor["body_length"] / 2.0 - 5),
        mats["paint_black"],
        collection,
        axis="Z",
        verts=32,
        bevel_mm=1,
    )
    add_box(
        "Motor_Label",
        (2, 40, 45),
        (tube["start"][0] + motor["body_diameter"] / 2.0 + 0.5, tube["start"][1], motor_center + tube["start"][2]),
        mats["label"],
        collection,
        bevel_mm=0.3,
    )
    add_text(
        "Motor_Text_Title",
        "CHUAN MOTOR",
        3.2,
        (tube["start"][0] + motor["body_diameter"] / 2.0 + 1.7, tube["start"][1] + 8, motor_center + tube["start"][2]),
        mats["dark_text"],
        collection,
        face="right",
    )
    add_text(
        "Motor_Text_Rating",
        "1/4 HP  200W",
        2,
        (tube["start"][0] + motor["body_diameter"] / 2.0 + 1.7, tube["start"][1] - 8, motor_center + tube["start"][2]),
        mats["dark_text"],
        collection,
        face="right",
    )

    coupling = dims["coupling"]
    add_cylinder(
        "Motor_Coupling",
        coupling["diameter"] / 2.0,
        coupling["length"],
        tuple(coupling["center"]),
        mats["rubber_brown"],
        collection,
        axis="Z",
        verts=40,
        bevel_mm=1,
    )
    for index in range(coupling["clamps"]):
        clamp_z = coupling["center"][2] - coupling["length"] / 2.0 + 5 + index * (coupling["length"] - 10) / max(coupling["clamps"] - 1, 1)
        add_cylinder(
            f"Coupling_Clamp_{index + 1}",
            coupling["clamp_diameter"] / 2.0,
            coupling["clamp_width"],
            (coupling["center"][0], coupling["center"][1], clamp_z),
            mats["silver"],
            collection,
            axis="Z",
            verts=40,
            bevel_mm=0.4,
        )

    mount_block = dims["motor_mount"]
    add_box(
        "Motor_Mount",
        (mount_block["width"], mount_block["height"], mount_block["depth"]),
        tuple(mount_block["center"]),
        mats["paint_white_dim"],
        collection,
        bevel_mm=2,
    )

    outlet = dims["outlet"]
    add_cylinder(
        "Outlet_Plug",
        outlet["plug_diameter"] / 2.0,
        outlet["plug_length"],
        tuple(outlet["plug_center"]),
        mats["pvc_brown"],
        collection,
        axis="Z",
        verts=48,
        bevel_mm=1.5,
    )
    add_cylinder(
        "Outlet_Nozzle",
        outlet["nozzle_diameter"] / 2.0,
        outlet["nozzle_height"],
        tuple(outlet["nozzle_center"]),
        mats["blue"],
        collection,
        axis="Y",
        verts=48,
        bevel_mm=1.5,
    )
    add_cylinder(
        "Outlet_Cap",
        outlet["cap_diameter"] / 2.0,
        outlet["cap_height"],
        tuple(outlet["cap_center"]),
        mats["red"],
        collection,
        axis="Y",
        verts=48,
        bevel_mm=2,
    )

    for index, cradle in enumerate(dims["cradles"]):
        add_box(
            f"Tube_Cradle_{index + 1}",
            (cradle["width"], cradle["height"], cradle["depth"]),
            (tube["start"][0], cradle["height"] / 2.0, cradle["z"]),
            mats["paint_white_dim"],
            collection,
            bevel_mm=1.5,
        )
        add_tube(
            f"Tube_Strap_{index + 1}",
            28,
            26,
            20,
            (tube["start"][0], tube["start"][1], cradle["z"]),
            mats["rubber"],
            collection,
            axis="Z",
            verts=48,
        )
        add_box(
            f"Tube_Strap_Buckle_{index + 1}",
            (12, 6, 20),
            (tube["start"][0], tube["start"][1] + radius_outer + 4, cradle["z"]),
            mats["rubber"],
            collection,
            bevel_mm=1,
        )

    # --- Grain fill -------------------------------------------------------
    grain = dims["grain"]
    grain_height = grain["height"]
    grain_r = grain["max_diameter"] / 2.0
    # The grain follows the jar's lower cone, then ends in a shallow mound.
    grain_profile = [
        (neck_r - 3.5, 0),
        (neck_r + 1, 5),
        (neck_r + 7, 15),
        (neck_r + 17, 30),
        (52, 48),
        (67, 64),
        (shoulder_r - 4, shoulder_h),
        (grain_r - 6, 120),
        (grain_r, grain_height * 0.94),
        (grain_r * 0.94, grain_height * 0.985),
        (grain_r * 0.55, grain_height * 0.997),
        (0.6, grain_height),
    ]
    add_lathe(
        "Grain_Fill",
        grain_profile,
        tuple(grain["center"]),
        mats["grain"],
        collection,
        segments=48,
        cap_bottom=True,
        cap_top=True,
    )

    # --- Cables -----------------------------------------------------------
    add_poly_curve(
        "Cable_Sensor",
        [
            (sensor["center"][0], sensor["center"][1] + sensor["height"] / 2.0, sensor["center"][2] - sensor["depth"] / 2.0),
            (-70, 555, 140),
            (-20, 620, 127.5),
            (-20, 745, 127.5),
            (20, 750, 127.5),
            (20, 300, 127.5),
            (24, 30, 150),
        ],
        1.5,
        mats["cable_gray"],
        collection,
    )
    add_poly_curve(
        "Cable_Motor",
        [
            (tube["start"][0], tube["start"][1] + 5, motor_center + tube["start"][2] - motor["body_length"] / 2.0 - 6),
            (tube["start"][0], 8, -325),
            (-40, 8, -230),
            (24, 8, -210),
            (24, 40, -190),
        ],
        2.2,
        mats["cable_red"],
        collection,
    )


def add_cone_between(
    name: str,
    top_center: tuple[float, float, float],
    top_radius: float,
    bottom_center: tuple[float, float, float],
    bottom_radius: float,
    material: bpy.types.Material,
    collection: bpy.types.Collection,
    *,
    segments: int = 48,
) -> bpy.types.Object:
    """Cone from a top ring to a bottom ring, in machine space."""
    top = Vector(top_center)
    bottom = Vector(bottom_center)
    axis = (bottom - top).normalized()
    # Build basis perpendicular to the axis.
    helper = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(helper).normalized()
    v = axis.cross(u).normalized()

    verts: list[tuple[float, float, float]] = []
    for center, radius in ((top, top_radius), (bottom, bottom_radius)):
        for index in range(segments):
            angle = 2.0 * math.pi * index / segments
            point = center + u * (radius * math.cos(angle)) + v * (radius * math.sin(angle))
            verts.append(bp(point.x, point.y, point.z))

    faces: list[tuple[int, ...]] = []
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.append((index, nxt, segments + nxt, segments + index))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    select_only(obj)
    bpy.ops.object.shade_smooth()

    solidify = obj.modifiers.new("Solidify", "SOLIDIFY")
    solidify.thickness = 2.0 * M
    solidify.offset = -1.0
    solidify.use_rim = True
    apply_modifier(obj, solidify)
    return obj


def add_helix(
    name: str,
    mount: bpy.types.Object,
    length: float,
    radius: float,
    pitch: float,
    wire_radius: float,
    material: bpy.types.Material,
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    turns = length / pitch
    steps = max(96, int(turns * 48))
    points: list[tuple[float, float, float]] = []
    for index in range(steps + 1):
        t = index / steps
        angle = 2.0 * math.pi * turns * t
        points.append((t * length, radius * math.cos(angle), radius * math.sin(angle)))

    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 4
    curve.bevel_depth = wire_radius * M
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for index, point in enumerate(points):
        spline.points[index].co = (point[0] * M, point[1] * M, point[2] * M, 1.0)

    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    select_only(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    assert obj is not None
    obj.name = name
    obj.data.materials.append(material)
    parent_identity(obj, mount)
    return obj


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((1e9, 1e9, 1e9))
    maximum = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, point.x)
            minimum.y = min(minimum.y, point.y)
            minimum.z = min(minimum.z, point.z)
            maximum.x = max(maximum.x, point.x)
            maximum.y = max(maximum.y, point.y)
            maximum.z = max(maximum.z, point.z)
    return minimum, maximum


def add_preview(scene: bpy.types.Scene, collection: bpy.types.Collection, mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    ground = add_box(
        "Preview_Ground",
        (1200, 2, 1200),
        (0, -11, 0),
        mats["ground"],
        collection,
        bevel_mm=0,
    )
    ground.hide_select = True

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    assert camera is not None
    camera.name = "Preview_Camera"
    link(camera, collection)
    camera.data.lens = 45
    camera.data.sensor_width = 36

    bpy.ops.object.light_add(type="AREA", location=(0.9, -1.0, 1.1))
    key = bpy.context.object
    key.name = "Preview_Key"
    key.data.energy = 80
    key.data.size = 1.4
    link(key, collection)

    bpy.ops.object.light_add(type="AREA", location=(-0.8, -0.5, 0.8))
    fill = bpy.context.object
    fill.name = "Preview_Fill"
    fill.data.energy = 25
    fill.data.size = 1.6
    link(fill, collection)

    scene.camera = camera
    return camera


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_previews(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    feeder: bpy.types.Collection,
    output_dir: Path,
) -> None:
    minimum, maximum = world_bounds(list(feeder.objects))
    center = (minimum + maximum) / 2.0
    size = maximum - minimum
    max_dim = max(size.x, size.y, size.z)

    # Show the preview at the default 62 % hopper level, like the live viewer.
    grain = bpy.data.objects.get("Grain_Fill")
    if grain is not None:
        grain.scale.z = 0.62

    scene.render.film_transparent = False
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.exposure = -0.35

    # EEVEE handles the blended PET jars; Cycles is the fallback when the
    # headless GPU context is unavailable.
    engine = "BLENDER_EEVEE_NEXT"
    try:
        scene.render.engine = engine
        if hasattr(scene, "eevee"):
            scene.eevee.taa_render_samples = 32
    except Exception:
        engine = "CYCLES"
        scene.render.engine = engine
        scene.cycles.samples = 32
        scene.cycles.use_denoising = True
    print(f"[preview] engine={scene.render.engine}")

    distance = (max_dim * 0.5) / math.tan(math.radians(19.0)) * 1.55
    views = {
        "iso": Vector((0.9, -1.05, 0.28)),
        "front": Vector((0.02, -1.0, 0.05)),
        "side": Vector((1.0, 0.02, 0.05)),
        "rear": Vector((-0.02, 1.0, 0.05)),
        "top": Vector((0.02, 0.08, 1.0)),
    }
    output_dir.mkdir(parents=True, exist_ok=True)

    for name, direction in views.items():
        camera.location = center + direction.normalized() * distance
        look_at(camera, center)
        scene.render.filepath = str(output_dir / f"preview-{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[preview] {scene.render.filepath}")


# ---------------------------------------------------------------------------
# Export / manifest
# ---------------------------------------------------------------------------


def count_triangles(objects: list[bpy.types.Object]) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return total


def export_glb(path: Path, objects: list[bpy.types.Object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]

    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {
        "filepath": str(path),
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
        "export_animations": False,
        "export_extras": True,
        "export_texcoords": True,
        "export_normals": True,
    }
    kwargs = {key: value for key, value in kwargs.items() if key in supported or key == "filepath"}
    bpy.ops.export_scene.gltf(**kwargs)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    args = parse_args()
    dims_path = Path(args.dims)
    if not dims_path.exists():
        raise SystemExit(f"dimensions not found: {dims_path}")
    dims = json.loads(dims_path.read_text(encoding="utf-8"))

    scene = reset_scene()
    feeder = bpy.data.collections.new("Feeder")
    scene.collection.children.link(feeder)
    preview_collection = bpy.data.collections.new("Preview")
    scene.collection.children.link(preview_collection)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[
        "Feeder"
    ]

    mats = build_materials()
    build(dims, mats, feeder)

    objects = list(feeder.objects)
    print(f"[build] objects={len(objects)}")

    glb_path = Path(args.glb)
    export_glb(glb_path, objects)
    print(f"[export] {glb_path} ({glb_path.stat().st_size / 1024 / 1024:.2f} MB)")

    if args.preview and not args.skip_preview:
        camera = add_preview(scene, preview_collection, mats)
        try:
            render_previews(scene, camera, feeder, Path(args.preview))
        except Exception as exc:
            print(f"[warn] preview render failed: {exc}")

    triangles = count_triangles(objects)
    manifest = {
        "name": "optifeed-feeder",
        "version": args.version,
        "contract": args.contract,
        "file": f"/models/{glb_path.name}",
        "sha256": sha256_file(glb_path),
        "bytes": glb_path.stat().st_size,
        "triangles": triangles,
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": f"Blender {bpy.app.version_string}",
        "dimensionsRevision": dims.get("revision", "unknown"),
        "nodes": sorted(obj.name for obj in objects),
    }
    manifest_path = Path(args.manifest)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent="\t") + "\n", encoding="utf-8", newline="\n")
    print(f"[manifest] {manifest_path} triangles={triangles}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
