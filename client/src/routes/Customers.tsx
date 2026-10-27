import * as React from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { CUSTOMER_STATUSES, PREFERRED_CONTACTS } from '../../../src/types/models';
import type { Branch, Customer } from '../../../src/types/models';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { StatusPill } from '@/components/StatusPill';
import { Disclosure } from '@/components/Disclosure';
import { InlineForm } from '@/components/InlineForm';
import { Loading, ErrorNotice } from '@/components/Misc';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/auth/AuthContext';
import { useQuery } from '@/lib/useQuery';
import * as api from '@/lib/api';
import { money, stamp } from '@/lib/format';
import { formatBytes, uploadBlob } from '@/lib/upload';
import { useSubmit } from '@/lib/useSubmit';

/** A customer row, with the value of any paper contract filed for them. */
type CustomerRow = Customer & { paper_contract_value: string | null };

export function Customers(): JSX.Element {
  const { isCorporate } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [addingPaper, setAddingPaper] = React.useState(false);
  const status = params.get('status') ?? '';
  const search = params.get('search') ?? '';

  const { data, loading, error, reload } = useQuery(
    () =>
      Promise.all([
        api.list<CustomerRow>('/customers', { status, search, page_size: 50 }),
        isCorporate ? api.get<Branch[]>('/branches') : Promise.resolve<Branch[]>([]),
      ]),
    [status, search, isCorporate],
  );

  const setParam = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  if (loading) return <Loading />;
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;

  const [customers, branches] = data;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${customers.meta.total} on the books`}
        actions={
          <>
            <Disclosure label="Add lead">
              <NewLeadForm branches={branches} showBranch={isCorporate} onDone={reload} />
            </Disclosure>
            <Button type="button" variant="secondary" onClick={() => setAddingPaper(true)}>
              <FileUp className="size-4" /> Add paper contract
            </Button>
            <Button asChild>
              <Link to="/customers/add">Add customer</Link>
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="search">Search</Label>
          <Input
            id="search"
            type="search"
            defaultValue={search}
            placeholder="Name, email or phone"
            onBlur={(e) => setParam('search', e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setParam('search', e.currentTarget.value.trim());
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Status</Label>
          <Select value={status} onValueChange={(v) => setParam('status', v === 'any' ? '' : v)}>
            <SelectTrigger id="status" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any status</SelectItem>
              {CUSTOMER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        rowKey={(row) => row.id}
        rows={customers.data}
        emptyMessage={
          search || status ? 'No customers match those filters.' : 'No customers yet. Add the first one above.'
        }
        onRowClick={(row) => navigate(`/customers/${row.id}`)}
        columns={[
          {
            header: 'Name',
            cell: (row) => (
              <Link className="text-primary hover:underline" to={`/customers/${row.id}`}>
                {row.first_name} {row.last_name}
              </Link>
            ),
          },
          { header: 'Email', cell: (row) => row.email ?? '—' },
          { header: 'Phone', cell: (row) => row.phone ?? '—' },
          { header: 'Status', cell: (row) => <StatusPill status={row.status} /> },
          {
            header: 'Contract',
            cell: (row) =>
              row.paper_contract_value ? (
                <span className="whitespace-nowrap">Paper · {money(row.paper_contract_value)}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
          { header: 'Added', cell: (row) => stamp(row.created_at) },
        ]}
      />

      <PaperContractDialog
        open={addingPaper}
        onOpenChange={setAddingPaper}
        branches={branches}
        showBranch={isCorporate}
        onDone={(customerId) => {
          setAddingPaper(false);
          reload();
          navigate(`/customers/${customerId}`);
        }}
      />
    </>
  );
}

/**
 * A contract signed on paper, filed in one step: who, the scan, and what it is
 * worth. The address, dates and terms are on the PDF, so nothing else is asked.
 */
function PaperContractDialog({
  open,
  onOpenChange,
  branches,
  showBranch,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  showBranch: boolean;
  onDone: (customerId: string) => void;
}): JSX.Element {
  const [name, setName] = React.useState('');
  const [value, setValue] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [branchId, setBranchId] = React.useState('');
  const created = React.useRef<string | null>(null);
  const { run, pending, error, clearError } = useSubmit(() => {
    const id = created.current;
    setName('');
    setValue('');
    setFile(null);
    if (id) onDone(id);
  });

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    run(async () => {
      const pdfKey = await uploadBlob('contract_pdf', file!, file!.name);
      const result = await api.post<{ customer: Customer }>('/customers/paper-contracts', {
        customer_name: name.trim(),
        contract_value: value.replace(/[$,\s]/g, ''),
        pdf_key: pdfKey,
        ...(showBranch ? { branch_id: branchId } : {}),
      });
      created.current = result.customer.id;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) clearError();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add paper contract</DialogTitle>
          <DialogDescription>
            The customer's name, the signed contract and what it is worth. Everything else is on the PDF.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="paper-name">Customer name</Label>
            <Input id="paper-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="paper-file">Signed contract (PDF)</Label>
            <input
              id="paper-file"
              type="file"
              accept=".pdf,application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
            />
            {file ? <p className="text-xs text-muted-foreground">{file.name} — {formatBytes(file.size)}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="paper-value">Contract value ($)</Label>
            <Input
              id="paper-value"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          {showBranch ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="paper-branch">Branch</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="paper-branch">
                  <SelectValue placeholder="Which branch?" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? <ErrorNotice message={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || !value.trim() || !file || (showBranch && !branchId)}>
              {pending ? 'Uploading…' : 'Add paper contract'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Somebody interested who is not signing today — "come back after the first
 * snowfall". Just enough to find them again; the full sign-up runs later from
 * their page.
 */
function NewLeadForm({
  branches,
  showBranch,
  onDone,
}: {
  branches: Branch[];
  showBranch: boolean;
  onDone: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  return (
    <InlineForm
      submitLabel="Add lead"
      specs={[
        { name: 'first_name', label: 'First name', required: true },
        { name: 'last_name', label: 'Last name', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Phone' },
        {
          name: 'preferred_contact',
          label: 'Preferred contact',
          type: 'select',
          options: PREFERRED_CONTACTS.map((c) => ({ value: c, label: c })),
          help: 'Choosing "sms" or "both" also needs a phone number.',
        },
        ...(showBranch
          ? [
              {
                name: 'branch_id',
                label: 'Branch',
                type: 'select' as const,
                options: branches.map((b) => ({ value: b.id, label: b.name })),
              },
            ]
          : []),
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      onSubmit={async (values) => {
        const created = await api.post<Customer>('/customers', {
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email || null,
          phone: values.phone || null,
          preferred_contact: values.preferred_contact,
          notes: values.notes || null,
          status: 'lead',
          ...(showBranch ? { branch_id: values.branch_id } : {}),
        });
        navigate(`/customers/${created.id}`);
      }}
      onDone={onDone}
    />
  );
}
