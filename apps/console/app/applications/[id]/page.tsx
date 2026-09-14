'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError, ApplicationDetail } from '@/lib/api';
import { OutcomeBadge } from '@/components/OutcomeBadge';

const STAGE_LABELS: Record<string, string> = {
  DEDUPE: 'Dedupe',
  KYC: 'KYC',
  BUREAU: 'Bureau pull',
  SCORE: 'Scoring',
  RULES: 'Policy rules',
  LIMIT: 'Limit assignment',
  PRICE: 'Pricing',
  PERSIST: 'Persist decision',
  OVERRIDE: 'Manual override',
};

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<any>(null);
  const [replaying, setReplaying] = useState(false);

  function load() {
    setError(null);
    api
      .application(params.id)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }

  useEffect(load, [params.id]);

  if (error) return <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-slate-400">Loading…</div>;

  const decision = data.decisions[0];
  const applicant = data.payload?.applicant ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">{String(applicant.fullName ?? 'Applicant')}</h1>
          <p className="font-mono text-xs text-slate-400">{data.id}</p>
        </div>
        {decision && <OutcomeBadge outcome={decision.outcome} />}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Application</h2>
          <dl className="space-y-1 text-sm">
            <Row k="Product" v={data.product} />
            <Row k="Requested" v={Number(data.requestedAmount).toLocaleString('en-IN')} />
            <Row k="Tenure" v={`${data.tenureMonths} mo`} />
            <Row k="Income" v={Number(data.income).toLocaleString('en-IN')} />
            <Row k="Obligations" v={Number(data.obligations).toLocaleString('en-IN')} />
            <Row k="Status" v={data.status} />
          </dl>
        </div>

        {decision && (
          <div className="card">
            <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Decision</h2>
            <dl className="space-y-1 text-sm">
              <Row k="Score" v={decision.score} />
              <Row k="PD" v={`${(Number(decision.probabilityOfDefault) * 100).toFixed(2)}%`} />
              <Row k="Grade" v={decision.riskGrade} />
              <Row k="Approved amount" v={decision.approvedAmount ? Number(decision.approvedAmount).toLocaleString('en-IN') : '—'} />
              <Row k="Interest rate" v={decision.interestRate ? `${(Number(decision.interestRate) * 100).toFixed(2)}%` : '—'} />
              <Row k="Reason codes" v={decision.reasonCodes.join(', ') || '—'} />
              <Row k="Latency" v={`${decision.latencyMs} ms`} />
              {decision.challengerScore !== null && <Row k="Challenger score" v={decision.challengerScore} />}
            </dl>
          </div>
        )}

        <div className="card">
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Determinism check</h2>
          <p className="mb-2 text-xs text-slate-500">
            Re-runs SCORE/RULES/LIMIT/PRICE against the exact policy and model version recorded on this decision.
          </p>
          <button
            className="btn-secondary"
            disabled={!decision || replaying}
            onClick={async () => {
              if (!decision) return;
              setReplaying(true);
              try {
                setReplayResult(await api.replay(decision.id));
              } catch (e) {
                setReplayResult({ error: e instanceof ApiError ? e.message : String(e) });
              } finally {
                setReplaying(false);
              }
            }}
          >
            {replaying ? 'Replaying…' : 'Replay decision'}
          </button>
          {replayResult && (
            <div className={`mt-2 rounded-md p-2 text-xs ${replayResult.matches ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {replayResult.error ? (
                replayResult.error
              ) : replayResult.matches ? (
                'Matches stored decision exactly.'
              ) : (
                <div>
                  <p className="font-semibold">Diverged:</p>
                  <ul className="list-disc pl-4">
                    {replayResult.differences.map((d: any) => (
                      <li key={d.field}>
                        {d.field}: {JSON.stringify(d.original)} → {JSON.stringify(d.replayed)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {decision?.outcome === 'REFER' && <ManualReview decisionId={decision.id} onDone={load} />}

      {decision && (decision.overriddenById || decision.overrideProposedById) && (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="mb-1 text-xs font-semibold uppercase text-amber-700">Manually overridden</h2>
          <p className="text-sm">
            Proposed by <b>{decision.overrideProposedById}</b>, approved by <b>{decision.overriddenById}</b>.
          </p>
          <p className="mt-1 text-sm italic text-slate-600">&ldquo;{decision.overrideJustification}&rdquo;</p>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Pipeline trace</h2>
        <div className="space-y-2">
          {data.events.map((event) => (
            <details key={event.id} className="card">
              <summary className="cursor-pointer text-sm font-medium">
                {STAGE_LABELS[event.stage] ?? event.stage}
                <span className="ml-2 text-xs font-normal text-slate-400">{event.durationMs} ms</span>
              </summary>
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold text-slate-500">Input</p>
                  <pre className="overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(event.input, null, 2)}</pre>
                </div>
                <div>
                  <p className="mb-1 font-semibold text-slate-500">Output</p>
                  <pre className="overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(event.output, null, 2)}</pre>
                </div>
              </div>
              <p className="mt-2 truncate font-mono text-[10px] text-slate-400">hash {event.hash}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function ManualReview({ decisionId, onDone }: { decisionId: string; onDone: () => void }) {
  const [newOutcome, setNewOutcome] = useState<'APPROVE' | 'DECLINE'>('APPROVE');
  const [justification, setJustification] = useState('');
  const [proposedBy, setProposedBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.override(decisionId, { newOutcome, justification, proposedBy, approvedBy });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card border-amber-200 bg-amber-50/60">
      <h2 className="mb-2 text-sm font-semibold">Manual review — override this REFER</h2>
      <p className="mb-3 text-xs text-slate-600">
        Requires a mandatory justification and a maker-checker pair: the proposer and approver must be different people.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">New outcome</label>
          <select className="input" value={newOutcome} onChange={(e) => setNewOutcome(e.target.value as 'APPROVE' | 'DECLINE')}>
            <option value="APPROVE">Approve</option>
            <option value="DECLINE">Decline</option>
          </select>
        </div>
        <div>
          <label className="label">Proposed by</label>
          <input className="input" value={proposedBy} onChange={(e) => setProposedBy(e.target.value)} placeholder="analyst username" />
        </div>
        <div>
          <label className="label">Approved by</label>
          <input className="input" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="different username" />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={submitting || !justification || !proposedBy || !approvedBy} onClick={submit}>
            {submitting ? 'Submitting…' : 'Submit override'}
          </button>
        </div>
      </div>
      <div className="mt-3">
        <label className="label">Justification (mandatory, min 10 characters)</label>
        <textarea className="input" rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
