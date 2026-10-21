import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../public/voxcpm2-engine.js';

test('VoxCPM2 Float32 audio is converted to valid playable PCM WAV', async () => {
  const blob = encodeWav(new Float32Array([0, -1, 1, 0.5]), 24000);
  const data = Buffer.from(await blob.arrayBuffer());
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WAVE');
  assert.equal(data.readUInt16LE(20), 1);
  assert.equal(data.readUInt16LE(22), 1);
  assert.equal(data.readUInt32LE(24), 24000);
  assert.equal(data.readUInt32LE(40), 8);
  assert.equal(data.readInt16LE(44), 0);
  assert.equal(data.readInt16LE(46), -32768);
  assert.equal(data.readInt16LE(48), 32767);
});

test('Invalid samples and sample rates are rejected', () => {
  assert.throws(() => encodeWav(new Float32Array(), 24000), /samples/);
  assert.throws(() => encodeWav(new Float32Array([0]), 0), /sample rate/);
});
