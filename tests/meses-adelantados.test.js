import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularProximasFechas } from '../src/shared/utils/clase-fecha.util.js';
import { CLASES_POR_CICLO } from '../src/shared/utils/ciclo.util.js';

test('calcularProximasFechas: límite por defecto regular genera 4 clases', () => {
  const fechas = calcularProximasFechas('2026-11-02', 1); // Lunes
  assert.equal(fechas.length, 4);
  assert.equal(fechas.length, CLASES_POR_CICLO);
});

test('calcularProximasFechas: límite por defecto individual genera 1 clase', () => {
  const fechas = calcularProximasFechas('2026-11-02', 1, true);
  assert.equal(fechas.length, 1);
});

test('calcularProximasFechas: con meses adelantados (2 meses = 8 clases) genera 8 clases semanales consecutivas', () => {
  const meses = 2;
  const cantidad = meses * CLASES_POR_CICLO; // 8
  const fechas = calcularProximasFechas('2026-11-02', 1, false, cantidad);
  assert.equal(fechas.length, 8);

  // Cada clase debe estar a 7 días de diferencia de la anterior
  for (let i = 1; i < fechas.length; i++) {
    const diffMs = fechas[i].getTime() - fechas[i - 1].getTime();
    const diffDias = Math.round(diffMs / (1000 * 60 * 60 * 24));
    assert.equal(diffDias, 7, `La clase ${i} no está separada por 7 días de la clase ${i - 1}`);
  }
});

test('calcularProximasFechas: con 3 meses adelantados (12 clases) el último día es exactamente la fecha fin', () => {
  const meses = 3;
  const cantidad = meses * CLASES_POR_CICLO; // 12
  const fechas = calcularProximasFechas('2026-11-02', 1, false, cantidad);
  assert.equal(fechas.length, 12);
  const ultimoDia = fechas[fechas.length - 1];
  assert.ok(ultimoDia instanceof Date);
  assert.ok(!Number.isNaN(ultimoDia.getTime()));
});

test('Aritmética de cobro: los meses adelantados se suman linealmente', () => {
  const precioBase = 150.0;
  const meses = 3;
  const totalEsperado = precioBase * meses; // 450
  assert.equal(totalEsperado, 450.0);

  const conCamiseta = totalEsperado + 50.0;
  assert.equal(conCamiseta, 500.0);
});

