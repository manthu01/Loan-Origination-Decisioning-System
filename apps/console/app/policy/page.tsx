'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, Policy, PolicyRule, SimulationResult } from '@/lib/api';

const DEFAULT_RULES: PolicyRule[] = [
  { id: 'AGE_MIN', priority: 10, expr: 'applicant.age >= 21', onFail: 'DECLINE', reason: 'R101' },
  { id: 'MIN_INCOME', priority: 20, expr: 'applicant.monthlyIncome >= 25000', onFail: 'DECLINE', reason: 'R110' },
  {
    id: 'FOIR_CAP',
    priority: 30,
    expr: '(applicant.obligations + application.estimatedEmi) / applicant.monthlyIncome <= 0.55',
    onFail: 'REFER',
    reason: 'R204',
  },
  { id: 'SCORE_FLOOR', priority: 50, expr: 'score.value >= 560', onFail: 'DECLINE', reason: 'R400' },
];

export default function PolicyPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [product, setProduct] = useState('PL');
  const [version, setVersion] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [rulesText, setRulesText] = useState(JSON.stringify(DEFAULT_RULES, null, 2));
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function loadPolicies() {
    api.policies().then(setPolicies).catch((e) => setError(String(e)));
  }
  useEffect(loadPolicies, []);

  function parseRules(): PolicyRule[] | null {
    try {
      const parsed = JSON.parse(rulesText);
      if (!Array.isArray(parsed)) throw new Error('rules must be a JSON array');
      return parsed;
    } catch (e) {
      setError(`invalid rules JSON: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async function runSimulation() {
    const rules = parseRules();
    if (!rules) return;
    setError(null);
    setBusy('simulate');
    try {
      setSimResult(await api.simulate({ product, rules, sampleSize: 10000 }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    const rules = parseRules();
    if (!rules || !version || !createdBy) {
      setError('version, createdBy, and valid rules JSON are required');
      return;
    }
    setError(null);
    setBusy('save');
    try {
      await api.createPolicy({ version, product, createdBy, rules });
      loadPolicies();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function activate(v: string) {
    if (!approvedBy) {
      setError('enter an "activated by" user (must differ from the creator) before activating');
      return;
    }
    setError(null);
    setBusy('activate');
    try {
      await api.activatePolicy(v, approvedBy);
      loadPolicies();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function loadIntoEditor(p: Policy) {
    setProduct(p.product);
    setVersion(p.version);
    setCreatedBy(p.createdBy);
    setRulesText(JSON.stringify(p.rules, null, 2));
    setSimResult(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Policy editor</h1>
        <p className="text-sm text-slate-500">
          Edit draft policy JSON, simulate its impact against recent applications, then submit for a different user to activate.
        </p>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold">Draft</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Product</label>
              <select className="input" value={product} onChange={(e) => setProduct(e.target.value)}>
                <option value="PL">PL</option>
                <option value="BL">BL</option>
                <option value="AUTO">AUTO</option>
              </select>
            </div>
            <div>
              <label className="label">Version</label>
              <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2026.03.2" />
            </div>
            <div>
              <label className="label">Created by</label>
              <input className="input" value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="alice" />
            </div>
          </div>
          <div>
            <label className="label">Rules (JSON)</label>
            <textarea
              className="input font-mono text-xs"
              rows={16}
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={busy !== null} onClick={runSimulation}>
              {busy === 'simulate' ? 'Simulating…' : 'Simulate'}
            </button>
            <button className="btn-primary" disabled={busy !== null} onClick={saveDraft}>
              {busy === 'save' ? 'Saving…' : 'Save as draft'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {simResult && <SimulationPanel result={simResult} />}

          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Existing policies</h2>
            <div className="mb-3 flex items-end gap-2">
              <div className="flex-1">
                <label className="label">Activated by (checker)</label>
                <input className="input" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="bob" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Created by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id}>
                      <td className="font-mono">{p.version}</td>
                      <td>{p.product}</td>
                      <td>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            p.status === 'ACTIVE'
                              ? 'bg-green-100 text-green-800'
                              : p.status === 'DRAFT'
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-slate-100 text-slate-400'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td>{p.createdBy}</td>
                      <td className="space-x-2 text-right">
                        <button className="text-xs text-slate-500 hover:underline" onClick={() => loadIntoEditor(p)}>
                          Edit
                        </button>
                        {p.status === 'DRAFT' && (
                          <button className="text-xs font-medium text-slate-900 hover:underline" onClick={() => activate(p.version)}>
                            Activate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {policies.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-slate-400">
                        No policies yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function SimulationPanel({ result }: { result: SimulationResult }) {
  return (
    <div className="card">
      <h2 className="mb-3 text-sm font-semibold">Simulation result ({result.sampleSize.toLocaleString()} applications replayed)</h2>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Current policy</p>
          <Row k="Approval rate" v={pct(result.current.approvalRate)} />
          <Row k="Refer rate" v={pct(result.current.referRate)} />
          <Row k="Decline rate" v={pct(result.current.declineRate)} />
          <Row k="Avg score" v={result.current.avgScore} />
          <Row k="Projected bad rate" v={pct(result.current.projectedBadRate)} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Draft policy</p>
          <Row k="Approval rate" v={pct(result.draft.approvalRate)} />
          <Row k="Refer rate" v={pct(result.draft.referRate)} />
          <Row k="Decline rate" v={pct(result.draft.declineRate)} />
          <Row k="Avg score" v={result.draft.avgScore} />
          <Row k="Projected bad rate" v={pct(result.draft.projectedBadRate)} />
        </div>
      </div>

      <div className="mt-3 flex gap-4 rounded-md bg-slate-50 p-2 text-sm">
        <span>
          Δ approval rate:{' '}
          <b className={result.delta.approvalRate < 0 ? 'text-red-700' : 'text-green-700'}>
            {result.delta.approvalRate >= 0 ? '+' : ''}
            {pct(result.delta.approvalRate)}
          </b>
        </span>
        <span>
          Δ projected bad rate:{' '}
          <b className={result.delta.projectedBadRate > 0 ? 'text-red-700' : 'text-green-700'}>
            {result.delta.projectedBadRate >= 0 ? '+' : ''}
            {pct(result.delta.projectedBadRate)}
          </b>
        </span>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Swap set — who changes outcome</p>
        <div className="flex gap-4 text-sm">
          <span className="text-red-700">{result.swapSet.approvedNowDeclined} approved → declined (lost)</span>
          <span className="text-green-700">{result.swapSet.declinedNowApproved} declined → approved (gained)</span>
        </div>
        {Object.keys(result.swapSet.byReason).length > 0 && (
          <ul className="mt-1 text-xs text-slate-500">
            {Object.entries(result.swapSet.byReason).map(([code, count]) => (
              <li key={code}>
                {code}: {count}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
