import { NARROW, barList, columnChart, escapeHtml, formatNumber, formatShare, lineChart, seriesTable } from './charts.ts';
import type { Dashboard } from './model.ts';

export const RANGES = [30, 90, 180, 365] as const;

// The reference palette of the charts: slot 1 blue and slot 2 orange, each stepped for its own surface.
const STYLE = `
:root {
    color-scheme: light dark;
    --page: #f9f9f7;
    --surface: #fcfcfb;
    --ink: #0b0b0b;
    --ink-2: #52514e;
    --muted: #898781;
    --grid: #e1e0d9;
    --axis: #c3c2b7;
    --ring: rgba(11, 11, 11, 0.1);
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --track: #cde2fb;
}
@media (prefers-color-scheme: dark) {
    :root {
        --page: #0d0d0d;
        --surface: #1a1a19;
        --ink: #f0efec;
        --ink-2: #c3c2b7;
        --muted: #898781;
        --grid: #2c2c2a;
        --axis: #383835;
        --ring: rgba(255, 255, 255, 0.1);
        --series-1: #3987e5;
        --series-2: #d95926;
        --track: #184f95;
    }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 24px 64px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
h2 { font-size: 14px; font-weight: 600; margin: 0 0 4px; }
.sub { color: var(--ink-2); margin: 0 0 12px; font-size: 12px; }
nav a { color: var(--ink-2); text-decoration: none; padding: 4px 8px; border-radius: 6px; font-size: 12px; }
nav a[aria-current] { color: var(--ink); background: var(--surface); box-shadow: 0 0 0 1px var(--ring); }
.notice { background: var(--surface); box-shadow: 0 0 0 1px var(--ring); border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; color: var(--ink-2); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile, .card { background: var(--surface); box-shadow: 0 0 0 1px var(--ring); border-radius: 8px; padding: 16px; }
.tile .label { color: var(--ink-2); font-size: 12px; }
.tile .value { font-size: 32px; font-weight: 600; line-height: 1.2; }
.tile .note { color: var(--muted); font-size: 12px; }
.card { margin-bottom: 16px; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; }
.pair > .card { margin-bottom: 0; }
.chart { width: 100%; height: auto; display: block; }
.gridline { stroke: var(--grid); stroke-width: 1; }
.baseline { stroke: var(--axis); stroke-width: 1; }
.tick { fill: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.end-label { fill: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.line.series-1 { stroke: var(--series-1); }
.line.series-2 { stroke: var(--series-2); }
.dot { stroke: var(--surface); stroke-width: 2; }
.dot.series-1 { fill: var(--series-1); }
.dot.series-2 { fill: var(--series-2); }
.bar { fill: var(--series-1); }
.hit { fill: transparent; }
.hit:hover { fill: var(--ring); }
.legend { display: flex; gap: 16px; color: var(--ink-2); font-size: 12px; margin: 0 0 8px; }
.legend span::before { content: ""; display: inline-block; width: 12px; height: 2px; vertical-align: middle; margin-right: 6px; background: var(--key); }
.bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.bars li { display: grid; grid-template-columns: minmax(96px, 38%) 1fr auto; align-items: center; gap: 12px; }
.bar-label { color: var(--ink-2); font-size: 12px; overflow-wrap: anywhere; }
.track { height: 12px; }
.fill { display: block; height: 12px; background: var(--series-1); border-radius: 0 4px 4px 0; min-width: 2px; }
.bar-value { font-variant-numeric: tabular-nums; font-size: 12px; text-align: right; min-width: 48px; }
.muted { color: var(--muted); }
.empty { color: var(--muted); margin: 0; font-size: 12px; }
details { margin-top: 8px; }
summary { color: var(--muted); font-size: 12px; cursor: pointer; }
.table-wrap { max-height: 280px; overflow: auto; }
table { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; width: 100%; }
th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--grid); }
th:first-child, td:first-child { text-align: left; }
th { color: var(--ink-2); font-weight: 500; }
.cohorts td.cell { color: var(--ink); }
.cohorts td.cell.strong { color: #ffffff; }
`;

function tileValue(label: string, value: number | null): string {
    if (value === null) {
        return '-';
    }
    return label === 'Signed in' ? formatShare(value) : formatNumber(value);
}

function card(title: string, sub: string, body: string): string {
    return `<section class="card"><h2>${escapeHtml(title)}</h2>${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}${body}</section>`;
}

function retentionTable(dashboard: Dashboard): string {
    if (dashboard.retention.length === 0) {
        return '<p class="empty">No cohorts yet.</p>';
    }
    const weeks = dashboard.retention[0]?.shares.length ?? 0;
    const head = `<tr><th>Cohort</th><th>Machines</th>${Array.from({ length: weeks }, (_, i) => `<th>W${i}</th>`).join('')}</tr>`;
    const rows = dashboard.retention
        .map((cohort) => {
            const cells = cohort.shares
                .map((share) => {
                    if (share === null) {
                        return '<td></td>';
                    }
                    const strength = Math.round(Math.min(1, share) * 85);
                    return `<td class="cell${share > 0.55 ? ' strong' : ''}" style="background:color-mix(in oklab, var(--series-1) ${strength}%, var(--surface))">${formatShare(share)}</td>`;
                })
                .join('');
            return `<tr><td>${escapeHtml(cohort.week)}</td><td>${formatNumber(cohort.size)}</td>${cells}</tr>`;
        })
        .join('');
    return `<div><table class="cohorts">${head}${rows}</table></div>`;
}

/* The one page of the dashboard, drawn on the server. */
export function renderPage(dashboard: Dashboard, days: number, notices: readonly string[]): string {
    const ranges = RANGES.map((range) => `<a href="?days=${range}"${range === days ? ' aria-current="page"' : ''}>${range} days</a>`).join('');
    const tiles = dashboard.tiles
        .map(
            (tile) =>
                `<div class="tile"><div class="label">${escapeHtml(tile.label)}</div><div class="value">${tileValue(tile.label, tile.value)}</div><div class="note">${escapeHtml(tile.note)}</div></div>`
        )
        .join('');
    const legend = `<p class="legend"><span style="--key: var(--series-1)">p50</span><span style="--key: var(--series-2)">p90</span></p>`;
    const features = dashboard.features.map((group) => card(group.title, 'Total over the range', barList(group.items))).join('');
    const body = [
        notices.map((notice) => `<p class="notice">${escapeHtml(notice)}</p>`).join(''),
        `<div class="tiles">${tiles}</div>`,
        card('Daily active machines', 'Machines that sent a day', lineChart([dashboard.daily]) + seriesTable([dashboard.daily])),
        `<div class="pair">${card(
            'Weekly active machines',
            'Per ISO week',
            columnChart(
                dashboard.weekly.points.map((point) => ({ label: point.label, value: point.value ?? 0 })),
                { width: NARROW }
            )
        )}${card(
            'Monthly active machines',
            'Per calendar month (UTC)',
            columnChart(
                dashboard.monthly.points.map((point) => ({ label: point.label, value: point.value ?? 0 })),
                { width: NARROW }
            )
        )}</div>`,
        `<div class="pair">${card('Versions', 'Share of machine-days, last 7 days', barList(dashboard.versions, { share: true }))}${card(
            'Signed in',
            'Share of machine-days, last 28 days',
            barList(dashboard.signedIn, { share: true })
        )}</div>`,
        `<div class="pair">${card('Platforms', 'Share of machine-days, last 28 days', barList(dashboard.platforms, { share: true }))}${card(
            'Architectures',
            'Share of machine-days, last 28 days',
            barList(dashboard.arches, { share: true })
        )}</div>`,
        `<div class="pair">${card('Chats started per provider', 'Total over the range', barList(dashboard.chats))}${card(
            'Turns per provider',
            'Total over the range',
            barList(dashboard.turns)
        )}</div>`,
        card('How the machine runs', 'Share of machine-days, last 28 days', barList(dashboard.launchers, { share: true })),
        `<div class="pair">${features}</div>`,
        card('Retention by cohort week', 'Share of each cohort active in the weeks after its first', retentionTable(dashboard)),
        card(
            'Desktop start until the first connection',
            'Median and 90th percentile over machines, per day, in milliseconds',
            legend + lineChart(dashboard.startup, { unit: ' ms' }) + seriesTable(dashboard.startup)
        )
    ].join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Ruimte usage</title><style>${STYLE}</style></head><body><main><header><h1>Ruimte usage</h1><nav>${ranges}</nav></header><p class="sub">${escapeHtml(
        `${dashboard.from} to ${dashboard.to}, UTC. Test versions (0.0.0) are left out.`
    )}</p>${body}</main></body></html>`;
}
