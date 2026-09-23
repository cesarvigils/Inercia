// Tests for the helpers js/admin.js uses to build HTML from Firestore
// data. Customer names, phones and receipt links reach the panel from the
// public site, so a value that slips through here runs as script in an
// admin's session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeUrl } from '../js/html-safety.js';

test('esc neutralizes markup in text and attributes', () => {
  assert.equal(
    esc('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(esc(`O'Brien & Co`), 'O&#39;Brien &amp; Co');
});

test('esc turns null and numbers into plain strings', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(350), '350');
});

test('safeUrl keeps https links, such as Firebase Storage download URLs', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/reservation-proofs%2Fuid%2Fa.png?alt=media&token=t';
  assert.equal(safeUrl(url), url);
});

test('safeUrl drops script and data URLs that esc() would let through', () => {
  for (const bad of [
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)'
  ]) {
    assert.equal(safeUrl(bad), '', bad);
  }
});

test('safeUrl drops plain http, relative and empty values', () => {
  assert.equal(safeUrl('http://example.com/a.png'), '');
  assert.equal(safeUrl('/receipts/a.png'), '');
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');
  assert.equal(safeUrl(undefined), '');
});
