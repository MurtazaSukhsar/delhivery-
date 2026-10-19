import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useAreas, useCustomers, type CustomerWithAddresses } from '../../lib/queries';
import { can } from '../../lib/domain';
import { Button } from '../../ui/controls';
import { EmptyState, Notice, PageHeader } from '../../ui/display';
import { CustomerDialog } from './CustomerDialog';
import { useOrg } from './ctx';

export default function Customers() {
  const { role } = useOrg();
  const customers = useCustomers();
  const areas = useAreas();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<CustomerWithAddresses | null | undefined>(undefined);
  const term = q.trim().toLowerCase();
  const rows = (customers.data ?? []).filter((c) => !term || [c.name, c.contact_name, c.phone, ...c.addresses.map((a) => `${a.label} ${a.line}`)].join(' ').toLowerCase().includes(term));
  const areaName = (id: string) => areas.data?.find((a) => a.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Customers"
        description="Saved customers and their delivery addresses, shared by every shop."
        actions={
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing(null)}>
            New customer
          </Button>
        }
      />
      <div className="mb-4 max-w-md">
        <label htmlFor="cq" className="mb-1 block text-sm font-medium">
          Search customers
        </label>
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input id="cq" type="search" className="field-input ps-9" placeholder="Name, phone or address" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {customers.error && <Notice tone="loss">{customers.error.message}</Notice>}
      {customers.isLoading ? (
        <p className="text-ink-2">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState title={term ? 'No customers match' : 'No customers yet'} body={term ? 'Check the spelling or add a new customer.' : 'Add your first customer and their delivery address.'} />
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Customers</caption>
            <thead className="border-b border-line bg-canvas text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Customer</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Phone</th>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">Addresses</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-2">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-canvas">
                  <th scope="row" className="px-4 py-3 text-start font-medium">
                    {c.name}
                    {c.contact_name && <div className="text-xs font-normal text-ink-2">{c.contact_name}</div>}
                  </th>
                  <td className="num px-4 py-3">
                    <a href={`tel:${c.phone}`} className="text-primary hover:underline">
                      {c.phone}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{c.addresses.map((a) => `${a.label}${a.area_id && areaName(a.area_id) ? ` (${areaName(a.area_id)})` : ''}`).join(', ')}</td>
                  <td className="px-4 py-3">
                    <span className="flex justify-end gap-1">
                      {can(role, 'deliveries.create') && (
                        <Link to={`/app/deliveries/new?customer=${c.id}`} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-soft">
                          New delivery
                        </Link>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                        Edit
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== undefined && <CustomerDialog initial={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
