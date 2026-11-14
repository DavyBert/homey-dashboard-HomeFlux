'use strict';

// Locale-independent candidates. Locale is used only to suggest, never to guess.
function parseNumericInput(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input } : { invalid: true };
  if (typeof input !== 'string' || !input.trim()) return { invalid: true };
  const raw = input.trim().replace(/\u2212/g, '-');
  const match = raw.match(/^([+-]?)([\d., \u00a0\u202f]+)([eE][+-]?\d+)?$/);
  if (!match) return { invalid: true };
  const [, sign, body, exponent = ''] = match;
  const choices = [];
  function add(kind, normalized, separator) {
    const value = Number(sign + normalized + exponent);
    if (Number.isFinite(value) && !choices.some(x => x.value === value)) choices.push({ kind, value, separator });
  }
  if (/^\d+$/.test(body)) add('plain', body, '');
  for (const sep of ['.', ',']) {
    const escaped = sep === '.' ? '\\.' : ',';
    const other = sep === '.' ? ',' : '.';
    // Decimal with no grouping, or with consistently grouped thousands.
    const parts = body.split(sep);
    if (parts.length === 2 && /^\d*$/.test(parts[0]) && /^\d+$/.test(parts[1])) add('decimal', (parts[0] || '0') + '.' + parts[1], sep);
    const grouping = other === '.' ? '\\.' : ',';
    const decimalPattern = new RegExp('^\\d{1,3}(?:' + grouping + '\\d{3})+' + escaped + '\\d+$');
    if (decimalPattern.test(body)) add('decimal', body.split(other).join('').replace(sep, '.'), sep);
    if (new RegExp('^\\d{1,3}(?:' + escaped + '\\d{3})+$').test(body)) add('grouped', body.split(sep).join(''), sep);
  }
  if (/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/.test(body)) add('spaced', body.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'), ' ');
  if (!choices.length) return { invalid: true };
  return choices.length === 1 ? { value: choices[0].value } : { choices };
}
module.exports = { parseNumericInput };
