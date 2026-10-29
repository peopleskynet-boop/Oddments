// Gaussian splats (src/lib/splat.js): which files are splats, and the PLY that Blender 5.3, SuperSplat and Spark read
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSplatPly, isSplatFile, writeSplatPly } from '../../src/lib/splat.js';

const ascii = (s) => new TextEncoder().encode(s);

test('a 3DGS PLY is a splat, a scanned mesh is not', () => {
  const splat = ascii('ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty float f_dc_0\nproperty float opacity\nproperty float scale_0\nend_header\n');
  const mesh = ascii('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n');
  const packed = ascii('ply\nformat binary_little_endian 1.0\nelement chunk 1\nproperty float min_x\nelement vertex 256\nproperty uint packed_position\nend_header\n');
  assert.equal(isSplatPly(splat), true);
  assert.equal(isSplatPly(mesh), false);
  assert.equal(isSplatPly(packed), true);
  assert.equal(isSplatFile('spz', null), true);
  assert.equal(isSplatFile('ply', mesh), false);
  assert.equal(isSplatFile('glb', splat), false);
});

test('the written PLY: header, aligned floats, values in place', () => {
  const n = 2;
  const ply = writeSplatPly({
    n,
    pos: new Float32Array([1, 2, 3, 4, 5, 6]),
    dc: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    rest: new Float32Array(18).map((_, i) => i / 100),
    opacity: new Float32Array([2.5, -1]),
    scale: new Float32Array([-3, -3, -6, -4, -4, -7]),
    rot: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0]),
  }, 'Oddments: тест');
  const text = new TextDecoder().decode(ply);
  // in bytes: the comment is Cyrillic, so a character index would be off
  const end = new TextEncoder().encode(text.slice(0, text.indexOf('end_header\n') + 'end_header\n'.length)).length;
  assert.equal(end % 4, 0, 'floats start on a multiple of 4');
  assert.ok(isSplatPly(ply));
  const props = text.slice(0, end).split('\n').filter((l) => l.startsWith('property')).map((l) => l.split(' ')[2]);
  assert.deepEqual(props.slice(0, 9), ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2']);
  assert.equal(props.filter((p) => p.startsWith('f_rest_')).length, 9);
  assert.equal(ply.length, end + n * props.length * 4);
  const f = new Float32Array(ply.buffer, ply.byteOffset + end, n * props.length);
  const at = (i, name) => f[i * props.length + props.indexOf(name)];
  assert.equal(at(1, 'x'), 4);
  assert.ok(Math.abs(at(0, 'f_dc_2') - 0.3) < 1e-6);
  assert.ok(Math.abs(at(1, 'f_rest_8') - 0.17) < 1e-6);
  assert.equal(at(1, 'opacity'), -1);
  assert.equal(at(1, 'rot_1'), 1);
  assert.match(text, /element vertex 2\n/);
});
