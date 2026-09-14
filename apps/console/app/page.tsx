'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, QueueResponse } from '@/lib/api';
import { OutcomeBadge } from '@/components/OutcomeBadge';

export default function QueuePage() {
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [scoreMin, setScoreMin] = useState('');
  const [scoreMax, setScoreMax] = useState('');
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .queue({ status, outcome, reasonCode, scoreMin, scoreMax })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, outcome, reasonCode, scoreMin, scoreMax]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Application queue</h1>
        <p className="text-sm text-slate-500">Filter by status, outcome, reason code, and score band.</p>
      </div>

      <div className="card grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            <option value="RECEIVED">Received</option>
            <option value="PROCESSING">Processing</option>
            <option value="DECIDED">Decided</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </div>
        <div>
          <label className="label">Outcome</label>
          <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any</option>
            <option value="APPROVE">Approve</option>
            <option value="REFER">Refer</option>
            <option value="DECLINE">Decline</option>
          </select>
        </div>
        <div>
          <label className="label">Reason code</label>
          <input className="input" placeholder="R204" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
        </div>
        <div>
          <label className="label">Score min</label>
          <input className="input" type="number" value={scoreMin} onChange={(e) => setScoreMin(e.target.value)} />
        </div>
        <div>
          <label className="label">Score max</label>
          <input className="input" type="number" value={scoreMax} onChange={(e) => setScoreMax(e.target.value)} />
        </div>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="card overflow-x-auto p-0">
        <table>
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Product</th>
              <th>Status</th>
              <th>Outcome</th>
              <th>Score</th>
              <th>Grade</th>
              <th>Reason codes</th>
              <th>Approved amount</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-slate-400">
                  No applications match these filters.
                </td>
              </tr>
            )}
            {data?.rows.map((row) => (
              <tr key={row.decisionId} className="hover:bg-slate-50">
                <td>
                  <Link href={`/applications/${row.applicationId}`} className="font-medium text-slate-900 hover:underline">
                    {row.applicantName}
                  </Link>
                </td>
                <td>{row.product}</td>
                <td>{row.status}</td>
                <td>
                  <OutcomeBadge outcome={row.outcome} />
                </td>
                <td>{row.score}</td>
                <td>{row.riskGrade}</td>
                <td className="max-w-[200px] truncate">{row.reasonCodes.join(', ') || '—'}</td>
                <td>{row.approvedAmount ? row.approvedAmount.toLocaleString('en-IN') : '—'}</td>
                <td className="whitespace-nowrap text-slate-500">{new Date(row.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <p className="text-xs text-slate-400">{data.total} total matching applications</p>}
    </div>
  );
}
