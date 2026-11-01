#!/usr/bin/env python3
"""Isolated Pillow processor for Battle Arena uploads and approved drafts."""
import json
import math
import statistics
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter, ImageOps, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = 20_000_000
MAX_BYTES = 12 * 1024 * 1024
MAX_SIDE = 8192


def open_checked(path):
    if path.stat().st_size > MAX_BYTES:
        raise ValueError('IMAGE_TOO_LARGE')
    with Image.open(path) as source:
        source.verify()
    with Image.open(path) as source:
        if source.format not in ('PNG', 'JPEG', 'WEBP'):
            raise ValueError('UNSUPPORTED_IMAGE')
        if not 1 <= source.width <= MAX_SIDE or not 1 <= source.height <= MAX_SIDE:
            raise ValueError('INVALID_DIMENSIONS')
        if source.width * source.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError('TOO_MANY_PIXELS')
        return source.convert('RGBA'), source.format


def detect_regions(image, color_fallback=False):
    scale = min(1, 720 / max(image.width, image.height))
    sample = image.convert('RGB').resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))))
    if color_fallback:
        background = sample.getpixel((0, 0))
        detail = ImageChops.difference(sample, Image.new('RGB', sample.size, background)).convert('L').point(lambda value: 255 if value > 50 else 0)
    else:
        smooth = sample.filter(ImageFilter.GaussianBlur(12))
        detail = ImageChops.difference(sample, smooth).convert('L').point(lambda value: 255 if value > 30 else 0)
    detail = detail.filter(ImageFilter.MaxFilter(3))
    width, height = detail.size
    pixels = detail.load()
    seen = bytearray(width * height)
    regions = []
    for y in range(height):
        for x in range(width):
            start = y * width + x
            if seen[start] or not pixels[x, y]:
                continue
            seen[start] = 1
            stack = [(x, y)]
            x0 = x1 = x
            y0 = y1 = y
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < width and 0 <= ny < height:
                        index = ny * width + nx
                        if not seen[index] and pixels[nx, ny]:
                            seen[index] = 1
                            stack.append((nx, ny))
            box_width, box_height = x1 - x0 + 1, y1 - y0 + 1
            if area < 35 or box_width < 12 or box_height < 15 or box_width > width * .7 or box_height > height * .95:
                continue
            pad = 4
            left = max(0, math.floor((x0 - pad) / scale))
            top = max(0, math.floor((y0 - pad) / scale))
            regions.append({'id': f'candidate_{len(regions) + 1:03d}', 'x': left, 'y': top, 'width': min(image.width - left, math.ceil((box_width + 2 * pad) / scale)), 'height': min(image.height - top, math.ceil((box_height + 2 * pad) / scale)), 'classification': 'UNCLASSIFIED', 'needsReview': True})
    return sorted(regions, key=lambda region: (region['y'], region['x']))[:200]


def inspect(source_path, output_dir):
    image, image_format = open_checked(source_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    thumb = ImageOps.contain(image, (640, 640))
    thumb.save(output_dir / 'thumbnail.png')
    candidates = detect_regions(image) if image_format == 'PNG' else []
    if image_format == 'PNG' and len(candidates) < 2:
        candidates = detect_regions(image, color_fallback=True)
    report = {'format': image_format, 'width': image.width, 'height': image.height, 'hasAlpha': image.getextrema()[3][0] < 255, 'candidates': candidates, 'warnings': ['Frame regions are proposals; review labels, weapons, effects and overlaps before approval.'] if candidates else ['No automatic frame candidates; add crops manually.']}
    (output_dir / 'report.json').write_text(json.dumps(report, ensure_ascii=False), encoding='utf8')
    return report


def rectangle(value, width, height):
    x, y, w, h = (int(value.get(key, 0)) for key in ('x', 'y', 'width', 'height'))
    if w < 1 or h < 1 or x < 0 or y < 0 or x + w > width or y + h > height:
        raise ValueError('INVALID_FRAME_RECTANGLE')
    return x, y, w, h


def transparent_crop(image, mask_options):
    if not mask_options or not mask_options.get('enabled', True):
        return image
    threshold = max(0, min(255, int(mask_options.get('threshold', 35))))
    pixels = image.load()
    alpha = image.getchannel('A')
    alpha_pixels = alpha.load()
    width, height = image.size
    border = [pixels[x, y][:3] for x in range(0, width, max(1, width // 16)) for y in (0, height - 1)]
    border += [pixels[x, y][:3] for y in range(0, height, max(1, height // 16)) for x in (0, width - 1)]
    median = tuple(int(statistics.median(sample[channel] for sample in border)) for channel in range(3))
    samples = [tuple(mask_options['color'])] if mask_options.get('color') else [sample for sample in border if sum((sample[channel] - median[channel]) ** 2 for channel in range(3)) < 80 ** 2]
    if not samples:
        samples = [median]
    samples = samples[::max(1, len(samples) // 16)]
    limit = threshold * threshold
    seen = bytearray(width * height)
    stack = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    stack += [(0, y) for y in range(height)] + [(width - 1, y) for y in range(height)]
    while stack:
        x, y = stack.pop()
        index = y * width + x
        if seen[index]:
            continue
        seen[index] = 1
        color = pixels[x, y]
        if min(sum((color[channel] - sample[channel]) ** 2 for channel in range(3)) for sample in samples) > limit:
            continue
        alpha_pixels[x, y] = 0
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[ny * width + nx]:
                stack.append((nx, ny))
    for stroke in mask_options.get('strokes', [])[:500]:
        px, py = int(stroke.get('x', 0)), int(stroke.get('y', 0))
        radius = max(1, min(100, int(stroke.get('radius', 8))))
        fill = 255 if stroke.get('mode') == 'restore' else 0
        from PIL import ImageDraw
        ImageDraw.Draw(alpha).ellipse((px-radius, py-radius, px+radius, py+radius), fill=fill)
    feather = max(0, min(5, float(mask_options.get('feather', 0))))
    if feather:
        alpha = alpha.filter(ImageFilter.GaussianBlur(feather))
    image.putalpha(alpha)
    return image


def render(source_path, draft_path, output_dir):
    image, _ = open_checked(source_path)
    draft = json.loads(draft_path.read_text(encoding='utf8'))
    frames = draft.get('frames', [])
    if not 1 <= len(frames) <= 150:
        raise ValueError('FRAME_COUNT_OUT_OF_RANGE')
    canvas = draft.get('canvas', {'width': 512, 'height': 512})
    canvas_width, canvas_height = int(canvas['width']), int(canvas['height'])
    if not 64 <= canvas_width <= 1024 or not 64 <= canvas_height <= 1024:
        raise ValueError('INVALID_CANVAS')
    output_dir.mkdir(parents=True, exist_ok=True)
    frame_dir = output_dir / 'frames'
    frame_dir.mkdir(exist_ok=True)
    atlas_width = 2048
    x = y = row_height = 0
    rendered = []
    positions = {}
    for index, frame in enumerate(frames):
        frame_id = str(frame.get('id', f'frame_{index + 1:03d}'))
        if not frame_id.replace('_', '').replace('-', '').isalnum() or len(frame_id) > 60 or frame_id in positions:
            raise ValueError('INVALID_FRAME_ID')
        crop_box = frame.get('crop', frame)
        bx, by, bw, bh = rectangle(crop_box, image.width, image.height)
        crop = transparent_crop(image.crop((bx, by, bx + bw, by + bh)), frame.get('mask', {}))
        padding = max(0, min(80, int(frame.get('padding', 20))))
        scale = min((canvas_width - padding * 2) / bw, (canvas_height - padding * 2) / bh)
        if scale <= 0:
            raise ValueError('INVALID_PADDING')
        resized = crop.resize((max(1, round(bw * scale)), max(1, round(bh * scale))), Image.Resampling.LANCZOS)
        normalized = Image.new('RGBA', (canvas_width, canvas_height))
        anchor_x = max(0, min(1, float(frame.get('footAnchor', {}).get('x', .5))))
        anchor_y = max(0, min(1, float(frame.get('footAnchor', {}).get('y', .9))))
        px = round(canvas_width * anchor_x - resized.width * anchor_x)
        py = round(canvas_height * anchor_y - resized.height)
        normalized.alpha_composite(resized, (px, py))
        normalized.save(frame_dir / f'{frame_id}.png')
        if x + canvas_width > atlas_width:
            x, y, row_height = 0, y + row_height, 0
        positions[frame_id] = {'x': x, 'y': y, 'width': canvas_width, 'height': canvas_height, 'pivot': frame.get('pivot', {'x': anchor_x, 'y': anchor_y}), 'hitbox': frame.get('hitbox'), 'hurtbox': frame.get('hurtbox'), 'collisionBox': frame.get('collisionBox'), 'headAnchor': frame.get('headAnchor', {'x': .5, 'y': .12})}
        rendered.append((normalized, x, y))
        x += canvas_width
        row_height = max(row_height, canvas_height)
    atlas_height = y + row_height
    if atlas_height > 16384:
        raise ValueError('ATLAS_TOO_LARGE')
    atlas = Image.new('RGBA', (atlas_width, atlas_height))
    for frame, px, py in rendered:
        atlas.alpha_composite(frame, (px, py))
    atlas.save(output_dir / 'atlas.png', optimize=True)
    animations = draft.get('animations', {})
    frame_ids = set(positions)
    for name, animation in animations.items():
        if not animation.get('frames') or any(item.get('frameId') not in frame_ids or not 20 <= int(item.get('durationMs', 0)) <= 2000 for item in animation['frames']):
            raise ValueError(f'INVALID_ANIMATION:{name}')
    metadata = {'canvas': canvas, 'frames': positions, 'animations': animations, 'atlas': 'atlas.png'}
    (output_dir / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf8')
    return {'frameCount': len(frames), 'animationCount': len(animations), 'atlasWidth': atlas_width, 'atlasHeight': atlas_height, 'warnings': ['Review transparency and frame boundaries visually before publishing.']}


def main():
    mode, source, config, output = sys.argv[1:5]
    result = inspect(Path(source), Path(output)) if mode == 'inspect' else render(Path(source), Path(config), Path(output))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
