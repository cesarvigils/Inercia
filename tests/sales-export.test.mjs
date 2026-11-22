// VENTAS: custom date range, payment-method breakdown, CSV export, and the
// filter buttons no longer stealing REEMBOLSOS' clicks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isInSalesRange, paymentBreakdown, paymentLabel, salesCsv } from '../js/sales-logic.js';

const NOW = new Date(2026, 5, 17, 15, 30);

test('PERSONALIZADO includes both ends of the range, in local dates', () => {
  const custom = { from: '2026-03-01', to: '2026-03-31' };
  assert.equal(isInSalesRange(new Date(2026, 2, 1, 0, 0), 'custom', NOW, custom), true);
  assert.equal(isInSalesRange(new Date(2026, 2, 31, 23, 59), 'custom', NOW, custom), true);
  assert.equal(isInSalesRange(new Date(2026, 1, 28, 23, 59), 'custom', NOW, custom), false);
  assert.equal(isInSalesRange(new Date(2026, 3, 1, 0, 0), 'custom', NOW, custom), false);
  assert.equal(isInSalesRange(new Date(2025, 0, 1), 'custom', NOW, { to: '2026-01-01' }), true);
});

test('paymentBreakdown totals by method, biggest first', () => {
  const rows = [
    { paymentMethod: 'efectivo', total: 100 },
    { paymentMethod: 'tarjeta', total: 500 },
    { paymentMethod: 'efectivo', total: 150 },
    { paymentMethod: 'paypal', total: 50 }
  ];
  assert.deepEqual(paymentBreakdown(rows), [
    { label: 'TARJETA', total: 500, count: 1 },
    { label: 'EFECTIVO', total: 250, count: 2 },
    { label: 'PAYPAL', total: 50, count: 1 }
  ]);
  assert.equal(paymentLabel({ method: 'transferencia' }), 'TRANSFERENCIA');
  assert.equal(paymentLabel(undefined), 'N/D');
});

test('salesCsv has a BOM, a header, quoted commas and neutralised formulas', () => {
  const csv = salesCsv([
    { date: new Date(2026, 5, 17, 10), description: 'Pepsi, lata', quantity: 2, paymentMethod: 'efectivo', type: 'manual', total: 60 },
    { date: new Date(2026, 5, 16, 10), description: '=HYPERLINK("x")', paymentMethod: 'tarjeta', type: 'reservation', total: 200 }
  ]);
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'FECHA,CONCEPTO,METODO,ORIGEN,TOTAL');
  assert.equal(lines[1], '2026-06-17,"2 Pepsi, latas",EFECTIVO,MANUAL,60.00');
  assert.equal(lines[2], `2026-06-16,"'=HYPERLINK(""x"")",TARJETA,RESERVA,200.00`);
});

test('VENTAS filters are bound by [data-range], not every .filter button', () => {
  const admin = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(admin, /\$\$\(\s*["']\.filter["']\s*\)/);
  assert.match(admin, /\$\$\(\s*["']\[data-range\]["']\s*\)/);
  // The REEMBOLSOS buttons share the .filter style but not data-range.
  assert.doesNotMatch(html, /data-refund-filter="[^"]*"[^>]*data-range/);
});
