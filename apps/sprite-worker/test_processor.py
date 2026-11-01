import json
import importlib.util
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

SCRIPT = Path(__file__).with_name('processor.py')
SOURCE = Path(__file__).resolve().parents[2] / 'assets' / 'battle' / 'source'


class ProcessorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def run_processor(self, mode, source, draft=None):
        result = subprocess.run([sys.executable, str(SCRIPT), mode, str(source), str(draft or '-'), str(self.root / 'out')], capture_output=True, text=True)
        return result

    def fixture(self):
        image = Image.new('RGB', (180, 100), (36, 52, 75))
        draw = ImageDraw.Draw(image)
        draw.rectangle((22, 20, 52, 85), fill=(230, 80, 40))
        draw.rectangle((102, 15, 145, 85), fill=(55, 190, 240))
        source = self.root / 'sprite.png'
        image.save(source)
        return source

    def test_inspect_proposes_unclassified_regions(self):
        result = self.run_processor('inspect', self.fixture())
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertGreaterEqual(len(report['candidates']), 2)
        self.assertTrue(all(c['classification'] == 'UNCLASSIFIED' and c['needsReview'] for c in report['candidates']))
        self.assertTrue((self.root / 'out' / 'thumbnail.png').is_file())

    def test_render_preserves_alpha_aspect_and_timing(self):
        source = self.fixture()
        draft = {'canvas': {'width': 128, 'height': 128}, 'frames': [
            {'id': 'red', 'crop': {'x': 15, 'y': 10, 'width': 45, 'height': 80}, 'mask': {'threshold': 35}},
            {'id': 'blue', 'crop': {'x': 95, 'y': 10, 'width': 60, 'height': 80}, 'mask': {'threshold': 35}},
        ], 'animations': {'attack': {'loop': False, 'frames': [{'frameId': 'red', 'durationMs': 75, 'events': ['attack.visual-impact']}, {'frameId': 'blue', 'durationMs': 125}]}}}
        config = self.root / 'draft.json'
        config.write_text(json.dumps(draft))
        result = self.run_processor('render', source, config)
        self.assertEqual(result.returncode, 0, result.stderr)
        frame = Image.open(self.root / 'out' / 'frames' / 'red.png')
        self.assertEqual(frame.mode, 'RGBA')
        self.assertEqual(frame.size, (128, 128))
        self.assertEqual(frame.getpixel((0, 0))[3], 0)
        self.assertEqual(frame.getextrema()[3][1], 255)
        metadata = json.loads((self.root / 'out' / 'metadata.json').read_text())
        self.assertEqual([f['durationMs'] for f in metadata['animations']['attack']['frames']], [75, 125])
        self.assertEqual(metadata['frames']['red']['x'], 0)
        self.assertEqual(metadata['frames']['blue']['x'], 128)

    def test_rejects_invalid_and_corrupt_files(self):
        svg = self.root / 'bad.svg'
        svg.write_text('<svg></svg>')
        self.assertNotEqual(self.run_processor('inspect', svg).returncode, 0)
        corrupt = self.root / 'bad.png'
        corrupt.write_bytes(b'\x89PNG\r\n\x1a\ncorrupt')
        self.assertNotEqual(self.run_processor('inspect', corrupt).returncode, 0)

    def test_rejects_oversized_upload_and_invalid_crop(self):
        oversized = self.root / 'big.png'
        oversized.write_bytes(b'X' * (12 * 1024 * 1024 + 1))
        self.assertIn('IMAGE_TOO_LARGE', self.run_processor('inspect', oversized).stderr)
        wide = self.root / 'wide.png'
        Image.new('RGB', (8193, 1)).save(wide)
        self.assertIn('INVALID_DIMENSIONS', self.run_processor('inspect', wide).stderr)
        source = self.fixture()
        config = self.root / 'draft.json'
        config.write_text(json.dumps({'frames': [{'id': 'bad', 'crop': {'x': 170, 'y': 0, 'width': 50, 'height': 50}}]}))
        self.assertIn('INVALID_FRAME_RECTANGLE', self.run_processor('render', source, config).stderr)

    @unittest.skipUnless(importlib.util.find_spec('cv2') and importlib.util.find_spec('numpy'), 'OpenCV environment required')
    def test_real_sheets_generate_editable_animation_drafts_without_overwriting_source(self):
        for filename, expected in [('tutien1.png', 84), ('tutien2.png', 94)]:
            with self.subTest(filename=filename):
                source = SOURCE / filename
                checksum = hashlib.sha256(source.read_bytes()).hexdigest()
                output = self.root / filename
                result = subprocess.run([sys.executable, str(SCRIPT), 'auto', str(source), '-', str(output)],
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                draft = json.loads((output / 'draft.json').read_text())
                quality = json.loads((output / 'quality.json').read_text())
                self.assertEqual(len(draft['frames']), expected)
                self.assertEqual(len(draft['animations']), 15)
                self.assertTrue(all(item['status'] != 'FAIL' for item in quality))
                self.assertTrue(any(item['status'] == 'REVIEW_REQUIRED' for item in quality))
                self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), checksum)
                self.assertTrue((output / 'atlas.png').is_file())
                self.assertTrue((output / 'atlas.json').is_file())
                self.assertTrue((output / 'preview.html').is_file())
                atlas_image = Image.open(output / 'atlas.png')
                self.assertLessEqual(max(atlas_image.size), 4096)
                self.assertEqual(atlas_image.getextrema()[3][0], 0)
                self.assertIn('idle', json.loads((output / 'animations.json').read_text()))
                rerun = subprocess.run([sys.executable, str(SCRIPT), 'auto', str(source), '-', str(output)],
                                       capture_output=True, text=True, timeout=10)
                self.assertIn('OUTPUT_NOT_EMPTY', rerun.stderr)


if __name__ == '__main__':
    unittest.main()
