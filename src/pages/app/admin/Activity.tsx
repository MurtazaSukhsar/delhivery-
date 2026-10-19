import { useState } from 'react';
import { Search } from 'lucide-react';
import { useActivity } from '../../../lib/queries';
import { can, ROLE_LABEL, type PlatformRole } from '../../../lib/domain';
import { dateTimeIn } from '../../../lib/format';
import { Button, SelectField } from '../../../ui/controls';
import { EmptyState, Notice, SubHeader } from '../../../ui/display';
import { useOrg } from '../ctx';

export default function Activity() {
  const { role, tz, shopName } = useOrg();
  const ok = can(role, 'activity.view');
  const log = useActivity(ok);
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  if (!ok) return <Notice tone="attention">Your role cannot see the activity log.</Notice>;

  const all = log.data ?? [];
  const people = [...new Map(all.map((e) => [e.user_id, e.user_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const term = q.trim().toLowerCase();
  const rows = all.filter((e) => (!who || e.user_id === who) && (!term || `${e.action} ${e.details} ${e.user_name}`.toLowerCase().includes(term)));

  return (
    <>
      <SubHeader title="Activity log" description="Who signed in and what they changed, newest first. Entries cannot be edited." actions={<Button onClick={() => log.refetch()} busy={log.isFetching}>Refresh</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <label htmlFor="aq" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input id="aq" type="search" className="field-input ps-9" placeholder="Action, delivery ref or name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <SelectField label="Person" value={who} onChange={(e) => setWho(e.target.value)} className="w-56">
          <option value="">Everyone</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </SelectField>
      </div>
      {log.error && <Notice tone="loss">{log.error.message}</Notice>}
      {log.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState title="Nothing recorded" body={term || who ? 'Nothing matches this search.' : 'Sign-ins and changes appear here.'} />
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Activity log, newest first</caption>
            <thead className="border-b border-line bg-canvas text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">When</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Who</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">What</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Details</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Shop</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="num whitespace-nowrap px-4 py-2.5 text-ink-2">{dateTimeIn(e.at, tz)}</td>
                  <td className="px-4 py-2.5">
                    {e.user_name}
                    <div className="text-xs text-ink-2">{ROLE_LABEL[e.role as PlatformRole] ?? e.role}</div>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{e.action}</td>
                  <td className="px-4 py-2.5 text-ink-2">{e.details}</td>
                  <td className="px-4 py-2.5 text-ink-2">{e.shop_id ? shopName(e.shop_id) || '—' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
