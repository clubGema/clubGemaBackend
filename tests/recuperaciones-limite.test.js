import test from 'node:test';
import assert from 'node:assert/strict';
import { limiteRecuperaciones } from '../src/features/recuperaciones/recuperacion.service.js';

test('limiteRecuperaciones: 1 día/semana = 1 recuperación al ciclo', () => {
  assert.equal(limiteRecuperaciones(1), 1);
});

test('limiteRecuperaciones: 2 y 3 días = 2; 4 o más = 4; sin inscripción = 0', () => {
  assert.equal(limiteRecuperaciones(2), 2);
  assert.equal(limiteRecuperaciones(3), 2);
  assert.equal(limiteRecuperaciones(4), 4);
  assert.equal(limiteRecuperaciones(5), 4);
  assert.equal(limiteRecuperaciones(0), 0);
  assert.equal(limiteRecuperaciones(undefined), 0);
});

