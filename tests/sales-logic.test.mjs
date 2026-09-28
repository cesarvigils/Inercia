// VENTAS filters (including ESTE DÍA) and the CONCEPTO text with quantities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isInSalesRange, saleDescription } from '../js/sales-logic.js';

// Wednesday 2026-06-17, mid-afternoon local time.
const NOW = new Date(2026, 5, 17, 15, 30);

test('ESTE DÍA keeps only sales from today', () => {
  assert.equal(isInSalesRange(new Date(2026, 5, 17, 0, 0), 'day', NOW), true);
  assert.equal(isInSalesRange(new Date(2026, 5, 17, 23, 59), 'day', NOW), true);
  assert.equal(isInSalesRange(new Date(2026, 5, 16, 23, 59), 'day', NOW), false);
  assert.equal(isInSalesRange(new Date(2026, 5, 18, 0, 0), 'day', NOW), false);
});

test('ESTA SEMANA runs Monday to Sunday', () => {
  assert.equal(isInSalesRange(new Date(2026, 5, 15, 9), 'week', NOW), true);
  assert.equal(isInSalesRange(new Date(2026, 5, 21, 22), 'week', NOW), true);
  assert.equal(isInSalesRange(new Date(2026, 5, 14, 22), 'week', NOW), false);
  assert.equal(isInSalesRange(new Date(2026, 5, 22, 9), 'week', NOW), false);
});

test('ESTE MES and ESTE AÑO', () => {
  assert.equal(isInSalesRange(new Date(2026, 5, 1), 'month', NOW), true);
  assert.equal(isInSalesRange(new Date(2026, 4, 31), 'month', NOW), false);
  assert.equal(isInSalesRange(new Date(2026, 0, 1), 'year', NOW), true);
  assert.equal(isInSalesRange(new Date(2025, 11, 31), 'year', NOW), false);
  assert.equal(isInSalesRange(null, 'year', NOW), false);
});

test('several of one product show the quantity', () => {
  assert.equal(saleDescription({ type: 'manual', description: 'Pepsi', quantity: 3 }), '3 Pepsis');
  assert.equal(saleDescription({ type: 'manual', description: 'Red Bull', quantity: 2 }), '2 Red Bull');
  assert.equal(saleDescription({ type: 'manual', description: 'Doritos', quantity: 4 }), '4 Doritos');
});

test('a single item, an old sale without quantity, or a reservation stay as they were', () => {
  assert.equal(saleDescription({ type: 'manual', description: 'Pepsi', quantity: 1 }), 'Pepsi');
  assert.equal(saleDescription({ type: 'manual', description: 'Pepsi' }), 'Pepsi');
  assert.equal(saleDescription({ type: 'reservation', description: 'Reserva ADM-1' }), 'Reserva ADM-1');
  assert.equal(saleDescription({ type: 'manual', description: '' }), 'Venta');
});
