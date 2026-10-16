import type { Point, Series } from './model.ts';

// A chart in a full-width card and in half of one, so the text keeps its size where the card is narrow.
export const WIDE = 880;
export const NARROW = 440;
const MARGIN = { top: 16, right: 56, bottom: 28, left: 48 };

export function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function formatNumber(value: number): string {
    const magnitude = Math.abs(value);
    if (magnitude >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (magnitude >= 10_000) {
        return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    }
    return Math.round(value).toLocaleString('en-US');
}

export function formatShare(value: number): string {
    return `${Math.round(value * 100)}%`;
}

/* A round step for about four gridlines up to `max`. */
function niceMax(max: number): { top: number; step: number } {
    if (max <= 0) {
        return { top: 4, step: 1 };
    }
    const rough = max / 4;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? 10 * power;
    return { top: Math.max(step, Math.ceil(max / step) * step), step: Math.max(step, 1) };
}

function grid(top: number, step: number, width: number, height: number, format: (value: number) => string): string {
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const lines: string[] = [];
    for (let value = 0; value <= top + 1e-9; value += step) {
        const y = MARGIN.top + plotHeight - (value / top) * plotHeight;
        const kind = value === 0 ? 'baseline' : 'gridline';
        lines.push(`<line class="${kind}" x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y}" y2="${y}"/>`);
        lines.push(`<text class="tick" x="${MARGIN.left - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(format(value))}</text>`);
    }
    return lines.join('');
}

function xLabels(labels: readonly string[], xOf: (index: number) => number, height: number): string {
    const picks = [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])].filter((index) => index >= 0);
    return picks
        .map((index) => {
            const anchor = index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle';
            return `<text class="tick" x="${xOf(index)}" y="${height - 8}" text-anchor="${anchor}">${escapeHtml(labels[index] ?? '')}</text>`;
        })
        .join('');
}

/* Lines over days, one per series in slot order, with a hover target per day and the last value labeled. */
export function lineChart(series: readonly Series[], options: { height?: number; format?: (value: number) => string; unit?: string } = {}): string {
    const height = options.height ?? 220;
    const width = WIDE;
    const format = options.format ?? formatNumber;
    const labels = series[0]?.points.map((point) => point.label) ?? [];
    const values = series.flatMap((line) => line.points.map((point) => point.value ?? 0));
    const { top, step } = niceMax(Math.max(0, ...values));
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const xOf = (index: number) => MARGIN.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
    const yOf = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
    const unit = options.unit ?? '';

    const lines = series
        .map((line, slot) => {
            let path = '';
            let open = false;
            line.points.forEach((point, index) => {
                if (point.value === null) {
                    open = false;
                    return;
                }
                path += `${open ? 'L' : 'M'}${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)}`;
                open = true;
            });
            const lastIndex = line.points.findLastIndex((point) => point.value !== null);
            const last = line.points[lastIndex];
            const end =
                last && last.value !== null
                    ? `<circle class="dot series-${slot + 1}" cx="${xOf(lastIndex)}" cy="${yOf(last.value)}" r="4"/><text class="end-label" x="${xOf(lastIndex) + 8}" y="${yOf(last.value) + 4}">${escapeHtml(format(last.value))}${unit}</text>`
                    : '';
            return `<path class="line series-${slot + 1}" d="${path}"/>${end}`;
        })
        .join('');

    const band = labels.length <= 1 ? plotWidth : plotWidth / (labels.length - 1);
    const targets = labels
        .map((label, index) => {
            const text = series
                .map((line) => `${line.name}: ${line.points[index]?.value === null ? 'none' : `${format(line.points[index]?.value ?? 0)}${unit}`}`)
                .join(', ');
            return `<rect class="hit" x="${xOf(index) - band / 2}" y="${MARGIN.top}" width="${band}" height="${plotHeight}"><title>${escapeHtml(`${label}  ${text}`)}</title></rect>`;
        })
        .join('');

    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${grid(top, step, width, height, format)}${lines}${xLabels(labels, xOf, height)}${targets}</svg>`;
}

/* Columns per week or month, at most 24 units wide, rounded at the data end. */
export function columnChart(points: readonly Point[], options: { height?: number; width?: number } = {}): string {
    const height = options.height ?? 220;
    const width = options.width ?? WIDE;
    const { top, step } = niceMax(Math.max(0, ...points.map((point) => point.value)));
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const band = plotWidth / Math.max(points.length, 1);
    const barWidth = Math.max(2, Math.min(24, band - 2));
    const xOf = (index: number) => MARGIN.left + band * index + band / 2;
    const bars = points
        .map((point, index) => {
            const barHeight = (point.value / top) * plotHeight;
            const x = xOf(index) - barWidth / 2;
            const y = MARGIN.top + plotHeight - barHeight;
            const radius = Math.min(4, barHeight, barWidth / 2);
            const shape =
                barHeight <= 0
                    ? ''
                    : `<path class="bar" d="M${x},${y + barHeight}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + barWidth - radius}Q${x + barWidth},${y} ${x + barWidth},${y + radius}V${y + barHeight}Z"/>`;
            const label =
                index === points.length - 1 && point.value > 0
                    ? `<text class="end-label" x="${xOf(index)}" y="${y - 6}" text-anchor="middle">${formatNumber(point.value)}</text>`
                    : '';
            return `${shape}${label}<rect class="hit" x="${xOf(index) - band / 2}" y="${MARGIN.top}" width="${band}" height="${plotHeight}"><title>${escapeHtml(`${point.label}  ${formatNumber(point.value)}`)}</title></rect>`;
        })
        .join('');
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${grid(top, step, width, height, formatNumber)}${bars}${xLabels(
        points.map((point) => point.label),
        xOf,
        height
    )}</svg>`;
}

/* Horizontal bars as rows of label, bar and value; `share` adds each row's part of the whole. */
export function barList(points: readonly Point[], options: { share?: boolean } = {}): string {
    const max = Math.max(0, ...points.map((point) => point.value));
    const total = points.reduce((sum, point) => sum + point.value, 0);
    if (total === 0) {
        return '<p class="empty">Nothing counted yet.</p>';
    }
    const rows = points
        .map((point) => {
            const width = max > 0 ? (point.value / max) * 100 : 0;
            const value = options.share
                ? `${formatShare(point.value / total)} <span class="muted">${formatNumber(point.value)}</span>`
                : formatNumber(point.value);
            return `<li><span class="bar-label">${escapeHtml(point.label)}</span><span class="track">${point.value > 0 ? `<span class="fill" style="width:${width.toFixed(2)}%"></span>` : ''}</span><span class="bar-value">${value}</span></li>`;
        })
        .join('');
    return `<ul class="bars">${rows}</ul>`;
}

/* The same numbers as a chart, for reading them exactly. */
export function seriesTable(series: readonly Series[], format: (value: number) => string = formatNumber): string {
    const labels = series[0]?.points.map((point) => point.label) ?? [];
    const head = `<tr><th>Day</th>${series.map((line) => `<th>${escapeHtml(line.name)}</th>`).join('')}</tr>`;
    const body = labels
        .map((label, index) => {
            const cells = series.map((line) => {
                const value = line.points[index]?.value ?? null;
                return `<td>${value === null ? '' : escapeHtml(format(value))}</td>`;
            });
            return `<tr><td>${escapeHtml(label)}</td>${cells.join('')}</tr>`;
        })
        .reverse()
        .join('');
    return `<details><summary>Table</summary><div class="table-wrap"><table>${head}${body}</table></div></details>`;
}
