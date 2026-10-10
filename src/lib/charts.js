// Server-side chart rendering through QuickChart (Chart.js v4) - returns PNG buffers for Discord.
// Charts are drawn for Discord's dark theme: dark surface, light text, recessive grid, thin marks.
const QUICKCHART_URL = 'https://quickchart.io/chart';

const THEME = {
  surface: '#1a1a19',
  text: '#ffffff',
  textSecondary: '#c3c2b7',
  grid: '#383835',
  reference: '#8a8983', // neutral reference lines (capacity, quota) - never a series color
  brand: '#e67e22',
};
// Fixed categorical order (dark-mode steps). Assigned in order, never cycled.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

async function render(chart, { width = 1000, height = 480 } = {}) {
  const res = await fetch(QUICKCHART_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: '4', backgroundColor: THEME.surface, width, height, devicePixelRatio: 2, format: 'png', chart }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`QuickChart ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

function baseOptions({ title, xLabel, yLabel, legend = true, indexAxis = 'x', stacked = false, yMax, yMin = 0 }) {
  const axis = (label) => ({
    stacked,
    grid: { color: THEME.grid, drawTicks: false },
    border: { color: THEME.grid },
    ticks: { color: THEME.textSecondary, padding: 6, font: { size: 13 } },
    title: label ? { display: true, text: label, color: THEME.textSecondary, font: { size: 13 } } : undefined,
  });
  const valueAxis = { ...axis(yLabel), min: yMin, grace: '8%', ...(yMax != null ? { max: yMax } : {}) };
  const catAxis = { ...axis(xLabel), grid: { display: false } };
  return {
    indexAxis,
    layout: { padding: 16 },
    plugins: {
      title: { display: Boolean(title), text: title, color: THEME.text, font: { size: 18, weight: 'bold' }, align: 'start', padding: { bottom: 12 } },
      legend: { display: legend, position: 'top', align: 'start', labels: { color: THEME.text, boxWidth: 14, boxHeight: 14, font: { size: 13 } } },
    },
    scales: indexAxis === 'y' ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

// A dashed neutral line dataset used for capacity / quota thresholds.
function referenceDataset(label, value, length) {
  return {
    type: 'line', label, data: Array(length).fill(value), borderColor: THEME.reference,
    borderWidth: 2, borderDash: [6, 6], pointRadius: 0, fill: false, order: 0,
  };
}

// series: [{ label, data, color? }]
function line({ title, labels, series, xLabel, yLabel, reference }) {
  const single = series.length === 1;
  const datasets = series.map((s, i) => ({
    label: s.label, data: s.data,
    borderColor: s.color ?? (single ? THEME.brand : SERIES[i]),
    backgroundColor: s.color ?? (single ? THEME.brand : SERIES[i]),
    borderWidth: 2, tension: 0.25, pointRadius: labels.length > 40 ? 0 : 3, spanGaps: true, fill: false, order: 1,
  }));
  if (reference) datasets.push(referenceDataset(reference.label, reference.value, labels.length));
  return render({
    type: 'line',
    data: { labels, datasets },
    options: baseOptions({ title, xLabel, yLabel, legend: datasets.length > 1 }),
  });
}

function bar({ title, labels, series, xLabel, yLabel, horizontal = false, stacked = false, reference, yMax }) {
  const single = series.length === 1;
  const datasets = series.map((s, i) => ({
    label: s.label, data: s.data,
    backgroundColor: s.color ?? (single ? THEME.brand : SERIES[i]),
    borderColor: THEME.surface, borderWidth: stacked ? 2 : 0, borderRadius: 4, borderSkipped: 'start',
    maxBarThickness: 36, order: 1,
  }));
  if (reference) datasets.push(referenceDataset(reference.label, reference.value, labels.length));
  const height = horizontal ? Math.max(360, 60 + labels.length * 34) : 480;
  return render({
    type: 'bar',
    data: { labels, datasets },
    options: baseOptions({ title, xLabel, yLabel, legend: datasets.length > 1, indexAxis: horizontal ? 'y' : 'x', stacked, yMax }),
  }, { height });
}

// slices: [{ label, value, color }]
function doughnut({ title, slices }) {
  return render({
    type: 'doughnut',
    data: {
      labels: slices.map((s) => `${s.label} (${s.value})`),
      datasets: [{ data: slices.map((s) => s.value), backgroundColor: slices.map((s, i) => s.color ?? SERIES[i]), borderColor: THEME.surface, borderWidth: 2 }],
    },
    options: {
      cutout: '60%',
      layout: { padding: 16 },
      plugins: {
        title: { display: true, text: title, color: THEME.text, font: { size: 18, weight: 'bold' }, align: 'start' },
        legend: { position: 'right', labels: { color: THEME.text, boxWidth: 14, font: { size: 14 } } },
      },
    },
  }, { width: 800, height: 420 });
}

// Sequential single-hue ramp (brand orange) - dark near zero so empty cells recede into the surface.
function rampColor(t) {
  const stops = [[0x2b, 0x25, 0x20], [0x8a, 0x4a, 0x16], [0xe6, 0x7e, 0x22], [0xff, 0xd2, 0xa8]];
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c.join(',')})`;
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

// matrix[day 0..6][hour 0..23] -> heatmap (scatter of square points on category rows).
function heatmap({ title, matrix, dayLabels, valueLabel }) {
  const max = Math.max(1, ...matrix.flat().filter((v) => v != null));
  const points = [];
  const colors = [];
  matrix.forEach((row, d) => row.forEach((v, h) => {
    points.push({ x: HOURS[h], y: dayLabels[d] });
    colors.push(v == null ? THEME.surface : rampColor(v / max));
  }));
  const options = baseOptions({ title, xLabel: 'Hour of day (server timezone)', legend: false });
  options.scales.x = { ...options.scales.x, type: 'category', labels: HOURS, offset: true, grid: { display: false } };
  options.scales.y = { type: 'category', labels: dayLabels, offset: true, grid: { display: false }, ticks: { color: THEME.textSecondary, font: { size: 13 } }, border: { display: false } };
  options.plugins.subtitle = { display: true, text: `Darker = fewer, brighter = more ${valueLabel}. Peak cell = ${max.toFixed(1)}`, color: THEME.textSecondary, align: 'start', padding: { bottom: 10 } };
  return render({
    type: 'scatter',
    data: { datasets: [{ data: points, pointStyle: 'rect', pointRadius: 21, pointHoverRadius: 21, backgroundColor: colors, borderColor: THEME.surface, borderWidth: 2 }] },
    options,
  }, { width: 1100, height: 520 });
}

module.exports = { line, bar, doughnut, heatmap, THEME, SERIES };
