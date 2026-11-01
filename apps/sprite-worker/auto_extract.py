"""Measured sheet profiles and conservative automatic frame extraction.

Profiles identify animation strips; frame boundaries and foreground boxes are
measured from pixels on every run. Unknown sheets keep the manual importer.
"""
import hashlib
import json
import statistics
from pathlib import Path

PROFILE_PATH = Path(__file__).with_name('profiles.json')


def profile_for(source_path, size):
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    profile = json.loads(PROFILE_PATH.read_text(encoding='utf8')).get(digest)
    return profile if profile and tuple(profile['size']) == tuple(size) else None


def estimate_background(image):
    import cv2
    import numpy as np
    rgb = np.asarray(image.convert('RGB'), dtype=np.uint8)
    small = cv2.resize(rgb, (max(1, image.width // 2), max(1, image.height // 2)),
                       interpolation=cv2.INTER_AREA)
    # A large spatial median follows the painted gradient while rejecting
    # compact character silhouettes. Downsampling keeps the worker bounded.
    smooth = cv2.medianBlur(small, 31)
    return cv2.resize(smooth, (image.width, image.height), interpolation=cv2.INTER_LINEAR)


def foreground(stripe, background):
    import cv2
    import numpy as np
    rgb = np.asarray(stripe.convert('RGB'), dtype=np.uint8)
    delta = np.max(np.abs(rgb.astype(np.int16) - background.astype(np.int16)), axis=2)
    # Smooth gradient and JPEG-like color noise do not belong to a sprite.
    binary = (delta > 25).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    keep = np.zeros(binary.shape, dtype=np.uint8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= 4:
            keep[labels == index] = 1
    return delta, keep


def _boundaries(signal, count, width):
    import numpy as np
    smooth = np.convolve(signal.astype(np.float32), np.ones(7) / 7, mode='same')
    step = width / count
    result = [0]
    for ordinal in range(1, count):
        center = ordinal * step
        low = max(result[-1] + 8, round(center - step * .25))
        high = min(width - 8 * (count - ordinal), round(center + step * .25))
        if high <= low:
            split = round(center)
        else:
            segment = smooth[low:high + 1]
            split = low + int(np.argmin(segment))
        result.append(split)
    result.append(width)
    return result


def propose(source_path, image):
    profile = profile_for(source_path, image.size)
    if not profile:
        return None
    import numpy as np
    frames = []
    animations = {}
    candidates = []
    quality = []
    background = estimate_background(image)
    for spec in profile['strips']:
        action, left, top, width, height, count = spec[:6]
        measured_cuts = spec[6] if len(spec) > 6 else None
        if left < 0 or top < 0 or left + width > image.width or top + height > image.height:
            raise ValueError('INVALID_SPRITE_PROFILE')
        strip = image.crop((left, top, left + width, top + height))
        delta, foreground_mask = foreground(strip, background[top:top + height, left:left + width])
        signal = foreground_mask.sum(axis=0)
        boundaries = ([0] + [cut - left for cut in measured_cuts] + [width]
                      if measured_cuts else _boundaries(signal, count, width))
        if len(boundaries) != count + 1 or boundaries != sorted(boundaries):
            raise ValueError('INVALID_SPRITE_PROFILE_CUTS')
        timeline = []
        for ordinal in range(count):
            x0, x1 = boundaries[ordinal:ordinal + 2]
            part = foreground_mask[:, x0:x1]
            ys, xs = np.nonzero(part)
            if not len(xs):
                # Preserve uncertain frames, including effect-only cells.
                bx0, by0, bx1, by1 = x0, 0, x1, height
                confidence = 0.0
            else:
                bx0 = max(x0, x0 + int(xs.min()) - 4)
                bx1 = min(x1, x0 + int(xs.max()) + 5)
                by0 = max(0, int(ys.min()) - 4)
                by1 = min(height, int(ys.max()) + 5)
                edge = float(signal[max(x0, x1 - 3):x1].mean()) if x1 > x0 else 0
                peak = max(1.0, float(signal[x0:x1].max()))
                confidence = round(max(.15, min(.95, .9 - edge / peak * .5)), 2)
            frame_id = f'{action}_{ordinal + 1:02d}'
            crop = {'x': left + bx0, 'y': top + by0,
                    'width': max(1, bx1 - bx0), 'height': max(1, by1 - by0)}
            known_overlap = ordinal + 1 in profile.get('review', {}).get(action, [])
            status = 'PASS' if confidence >= .8 and not known_overlap else 'REVIEW_REQUIRED'
            candidates.append({'id': frame_id, **crop, 'classification': action,
                               'confidence': confidence, 'needsReview': status != 'PASS'})
            quality.append({'frameId': frame_id, 'status': status, 'confidence': confidence,
                            'reason': 'Source frames overlap; may need a new sheet or manual cleanup' if known_overlap else 'Ambiguous boundary' if status != 'PASS' else ''})
            frames.append({'id': frame_id, 'crop': crop, 'padding': 8,
                           'pivot': {'x': .5, 'y': 1}, 'footAnchor': {'x': .5, 'y': 1},
                           'headAnchor': {'x': .5, 'y': .12},
                           'hurtbox': {'x': 314, 'y': 58, 'width': 140, 'height': 185},
                           **({'hitbox': {'x': 440, 'y': 70, 'width': 220, 'height': 145}} if action in ('attack', 'combo1', 'combo2', 'skill_q', 'skill_w', 'skill_e', 'skill_r') else {}),
                           'reviewRequired': status != 'PASS', 'reviewed': False,
                           'mask': {'auto': True, 'strip': [left, top, width, height]}})
            events = ['attack.visual-impact'] if action == 'attack' and ordinal == count - 1 else []
            timeline.append({'frameId': frame_id, 'durationMs': 120 if action == 'idle' else 95,
                             'events': events})
        direction = 'left' if action.endswith('_left') else 'right' if action.endswith('_right') else 'none'
        animations[action] = {'loop': action in ('idle', 'walk_left', 'walk_right', 'run_left', 'run_right'),
                              'speed': 1, 'direction': direction, 'allowFlipX': False,
                              'holdLastFrame': action == 'die', 'priority': 0,
                              'rootMotion': {'x': 0, 'y': 0}, 'transitions': [], 'frames': timeline}
    idle_heights = [f['crop']['height'] for f in frames if f['id'].startswith('idle_')]
    scale = round(min(3.5, max(1.2, 176 / statistics.median(idle_heights))), 3)
    draft = {'canvas': {'width': 768, 'height': 256}, 'sourceScale': scale,
             'frames': frames, 'animations': animations, 'character': profile['character']}
    return {'profile': profile['name'], 'draft': draft, 'candidates': candidates,
            'quality': quality,
            'warnings': ['Automatic crop and alpha are provisional. Inspect overlap, text, weapon tips and feet before approval.']}


def alpha_from_background(source, crop_box, background):
    """Soft alpha from measured local background; source pixels are untouched."""
    import cv2
    import numpy as np
    x, y, w, h = crop_box
    rgb = np.asarray(source.crop((x, y, x + w, y + h)).convert('RGB'), dtype=np.uint8)
    local = background[y:y + h, x:x + w]
    if local.shape[:2] != (h, w):
        raise ValueError('INVALID_AUTO_MASK_REGION')
    delta = np.max(np.abs(rgb.astype(np.int16) - local.astype(np.int16)), axis=2)
    alpha = np.clip((delta - 13) * (255 / 27), 0, 255).astype(np.uint8)
    strong = (delta > 26).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(strong, 8)
    keep = np.zeros(strong.shape, dtype=np.uint8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= 3:
            keep[labels == index] = 1
    keep = cv2.dilate(keep, np.ones((3, 3), np.uint8))
    alpha = cv2.bitwise_and(alpha, alpha, mask=keep)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0.55)
    original = np.asarray(source.crop((x, y, x + w, y + h)).getchannel('A'))
    return Image_from_array(np.minimum(alpha, original))


def Image_from_array(array):
    from PIL import Image
    return Image.fromarray(array, 'L')
