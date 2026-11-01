import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validYouTubeVideoUrl } from '../src/youtube.js';

test('audio config accepts playable video links and rejects links without a video ID', () => {
  assert.equal(validYouTubeVideoUrl('https://www.youtube.com/watch?v=M7lc1UVf-VE'), true);
  assert.equal(validYouTubeVideoUrl('https://music.youtube.com/watch?v=M7lc1UVf-VE'), true);
  assert.equal(validYouTubeVideoUrl('https://www.youtube.com/'), false);
  assert.equal(validYouTubeVideoUrl('https://youtube.com.evil.example/watch?v=M7lc1UVf-VE'), false);
});
