import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { db } from './helpers/database';
import { harness } from './helpers/harness';
import { call, login } from './helpers/server';
import { splitName } from '../src/services/paperContracts';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

describe('paper contracts', () => {
  const h = harness();

  async function uploadPdf(token: string, purpose = 'contract_pdf'): Promise<string> {
    const target = await call(h.server(), 'POST', '/uploads', {
      token,
      body: { purpose, content_type: 'application/pdf', file_name: 'smith-contract.pdf' },
    });
    assert.equal(target.status, 201, JSON.stringify(target.body));
    const put = await fetch(`${h.server().url}${target.body.data.upload_url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: PDF,
    });
    assert.equal(put.status, 201);
    return target.body.data.key as string;
  }

  async function file(token: string, body: Record<string, unknown>) {
    return call(h.server(), 'POST', '/customers/paper-contracts', { token, body });
  }

  it('splits a name into first and last', () => {
    assert.deepEqual(splitName('Mary Anne Smith'), { first_name: 'Mary Anne', last_name: 'Smith' });
    assert.deepEqual(splitName('  Cher '), { first_name: 'Cher', last_name: '' });
  });

  it('files a customer from just a name, the PDF and the value', async () => {
    const token = await login(h.server(), h.world().emails.sales);
    const key = await uploadPdf(token);
    const reply = await file(token, { customer_name: 'Jane Smith', contract_value: '1250.00', pdf_key: key });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));

    const { customer, paper_contract } = reply.body.data;
    assert.equal(customer.first_name, 'Jane');
    assert.equal(customer.last_name, 'Smith');
    assert.equal(customer.status, 'active');
    assert.equal(customer.email, null);
    assert.equal(customer.phone, null);
    assert.equal(customer.branch_id, h.world().branches.kingston, 'filed in the rep’s own branch');
    assert.equal(paper_contract.contract_value, '1250.00');
    assert.equal(paper_contract.pdf_key, key);
    assert.equal(paper_contract.file_name, 'smith-contract.pdf');

    // Listed with the other customers, marked as paper.
    const list = await call(h.server(), 'GET', '/customers?search=Smith', { token });
    const row = list.body.data.find((c: { id: string }) => c.id === customer.id);
    assert.equal(row.paper_contract_value, '1250.00');

    // And on their own page, with the PDF.
    const summary = await call(h.server(), 'GET', `/customers/${customer.id}/summary`, { token });
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.equal(summary.body.data.paper_contracts.length, 1);
    assert.equal(summary.body.data.paper_contracts[0].pdf_key, key);
    assert.ok(await db('audit_log').where({ action: 'paper_contract.created' }).first());
  });

  it('asks corporate for the branch, and refuses a missing value or a file that is not a contract', async () => {
    const token = await login(h.server(), h.world().emails.corporate);
    const key = await uploadPdf(token);
    const noBranch = await file(token, { customer_name: 'Jane Smith', contract_value: 500, pdf_key: key });
    assert.equal(noBranch.status, 400);

    const branch_id = h.world().branches.kingston;
    const noValue = await file(token, { customer_name: 'Jane Smith', contract_value: 0, pdf_key: key, branch_id });
    assert.equal(noValue.status, 400);
    const noName = await file(token, { customer_name: '  ', contract_value: 500, pdf_key: key, branch_id });
    assert.equal(noName.status, 400);

    const receipt = await uploadPdf(token, 'receipt');
    const wrongKind = await file(token, { customer_name: 'Jane Smith', contract_value: 500, pdf_key: receipt, branch_id });
    assert.equal(wrongKind.status, 400);

    const ok = await file(token, { customer_name: 'Jane Smith', contract_value: 500, pdf_key: key, branch_id });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((await db('customers').where({ first_name: 'Jane', last_name: 'Smith' })).length, 1, 'nothing half-filed by the refusals');
  });

  it('removes the filing and keeps the customer', async () => {
    const token = await login(h.server(), h.world().emails.sales);
    const reply = await file(token, { customer_name: 'Jane Smith', contract_value: 500, pdf_key: await uploadPdf(token) });
    const { customer, paper_contract } = reply.body.data;
    const gone = await call(h.server(), 'DELETE', `/customers/paper-contracts/${paper_contract.id}`, { token });
    assert.equal(gone.status, 204);
    assert.equal((await db('paper_contracts')).length, 0);
    assert.ok(await db('customers').where({ id: customer.id }).first());
  });

  it('still asks for an email or phone on the ordinary customer form', async () => {
    const token = await login(h.server(), h.world().emails.sales);
    const reply = await call(h.server(), 'POST', '/customers', { token, body: { first_name: 'No', last_name: 'Contact' } });
    assert.equal(reply.status, 400);
  });
});
