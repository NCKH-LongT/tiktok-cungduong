import assert from 'node:assert/strict';
import { test } from 'node:test';
import { videoId } from '../app/overlay/[id]/music';

test('extracts official YouTube video links', () => {
  assert.equal(videoId('https://www.youtube.com/watch?v=M7lc1UVf-VE'), 'M7lc1UVf-VE');
  assert.equal(videoId('https://youtu.be/M7lc1UVf-VE'), 'M7lc1UVf-VE');
});
test('rejects lookalike hosts and non-HTTPS URLs', () => {
  assert.equal(videoId('https://youtube.com.evil.example/watch?v=M7lc1UVf-VE'), null);
  assert.equal(videoId('http://youtube.com/watch?v=M7lc1UVf-VE'), null);
});
