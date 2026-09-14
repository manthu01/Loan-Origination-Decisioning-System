'use client';

import { useEffect, useState } from 'react';
import { api, DashboardStats } from '@/lib/api';

export default function DashboardPage() {
  const [product, setProduct] = useState('');
  const [days, setDays] = useState(90);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .stats(product || undefined, days)
      .then(setStats)
      .catch((e) => setError(String(e)));
  }, [product, days]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">
            {stats ? `${stats.totalDecisions.toLocaleString()} decisions in the last ${stats.windowDays} days` : 'Loading…'}
          </p>
        </div>
        <div className="flex gap-2">
          <select className="input" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All products</option>
            <option value="PL">PL</option>
            <option value="BL">BL</option>
            <option value="AUTO">AUTO</option>
          </select>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>365 days</option>
          </select>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {stats && stats.totalDecisions === 0 && (
        <div className="card text-center text-sm text-slate-400">
          No decisions in this window yet. Submit some applications (or run the seed script) to populate the dashboard.
        </div>
      )}

      {stats && stats.totalDecisions > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Approval rate over time</h2>
            <LineChart data={stats.approvalRateOverTime.map((d) => ({ label: d.day.slice(5), value: d.approvalRate }))} />
          </div>

          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Score distribution</h2>
            <BarChart
              data={stats.scoreDistribution.map((b) => ({ label: `${b.rangeStart}`, value: b.count }))}
            />
          </div>

          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Reason code frequency</h2>
            <BarChart data={stats.reasonCodeFrequency.slice(0, 10).map((r) => ({ label: r.code, value: r.count }))} horizontal />
          </div>

          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Decision latency</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="p50" value={`${stats.latencyMs.p50} ms`} />
              <Stat label="p95" value={`${stats.latencyMs.p95} ms`} />
              <Stat label="p99" value={`${stats.latencyMs.p99} ms`} />
            </div>
          </div>

          <div className="card lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">
              Champion vs. challenger score{' '}
              {stats.championVsChallenger.correlation !== null && (
                <span className="text-xs font-normal text-slate-500">
                  (Pearson r = {stats.championVsChallenger.correlation.toFixed(3)})
                </span>
              )}
            </h2>
            <Scatter points={stats.championVsChallenger.points} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 py-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

const CHART_H = 160;
const CHART_W = 480;

function LineChart({ data }: { data: { label: string; value: number }[] }) {
  if (data.length === 0) return <Empty />;
  const max = Math.max(0.01, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? CHART_W / (data.length - 1) : CHART_W;
  const points = data.map((d, i) => `${i * stepX},${CHART_H - (d.value / max) * CHART_H}`).join(' ');

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`} className="w-full" role="img" aria-label="approval rate over time">
      <polyline points={points} fill="none" stroke="#0f172a" strokeWidth={2} />
      {data.map((d, i) => (
        <circle key={i} cx={i * stepX} cy={CHART_H - (d.value / max) * CHART_H} r={2.5} fill="#0f172a" />
      ))}
      {data.length > 0 && (
        <>
          <text x={0} y={CHART_H + 15} fontSize={10} fill="#64748b">
            {data[0].label}
          </text>
          <text x={CHART_W - 30} y={CHART_H + 15} fontSize={10} fill="#64748b">
            {data[data.length - 1].label}
          </text>
        </>
      )}
    </svg>
  );
}

function BarChart({ data, horizontal }: { data: { label: string; value: number }[]; horizontal?: boolean }) {
  if (data.length === 0) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.value));

  if (horizontal) {
    const rowH = 22;
    return (
      <svg viewBox={`0 0 ${CHART_W} ${data.length * rowH}`} className="w-full">
        {data.map((d, i) => (
          <g key={d.label} transform={`translate(0, ${i * rowH})`}>
            <text x={0} y={rowH / 2 + 4} fontSize={10} fill="#334155">
              {d.label}
            </text>
            <rect x={50} y={2} width={(d.value / max) * (CHART_W - 90)} height={rowH - 6} fill="#0f172a" rx={2} />
            <text x={54 + (d.value / max) * (CHART_W - 90)} y={rowH / 2 + 4} fontSize={10} fill="#64748b">
              {d.value}
            </text>
          </g>
        ))}
      </svg>
    );
  }

  const barW = CHART_W / data.length;
  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H + 20}`} className="w-full">
      {data.map((d, i) => {
        const h = (d.value / max) * CHART_H;
        return (
          <g key={i}>
            <rect x={i * barW + 2} y={CHART_H - h} width={barW - 4} height={h} fill="#0f172a" rx={2} />
            <text x={i * barW + barW / 2} y={CHART_H + 14} fontSize={8} fill="#64748b" textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Scatter({ points }: { points: { score: number; challengerScore: number }[] }) {
  if (points.length === 0) return <Empty />;
  const allValues = points.flatMap((p) => [p.score, p.challengerScore]);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const scale = (v: number) => ((v - min) / (max - min || 1)) * CHART_H;

  return (
    <svg viewBox={`0 0 ${CHART_H} ${CHART_H}`} className="mx-auto block w-full max-w-md">
      <line x1={0} y1={CHART_H} x2={CHART_H} y2={0} stroke="#cbd5e1" strokeDasharray="4 4" />
      {points.map((p, i) => (
        <circle key={i} cx={scale(p.score)} cy={CHART_H - scale(p.challengerScore)} r={2.5} fill="#0f172a" opacity={0.5} />
      ))}
    </svg>
  );
}

function Empty() {
  return <p className="py-8 text-center text-xs text-slate-400">Not enough data yet.</p>;
}
