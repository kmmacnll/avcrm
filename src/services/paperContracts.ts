import type { Knex } from 'knex';
import { db as defaultDb } from '../db/client';
import type { AuthenticatedUser, BranchScope } from '../types/auth';
import type { Customer, PaperContract, Upload } from '../types/models';
import { badRequest, notFound } from '../utils/errors';
import { applyBranchScope } from '../utils/scope';
import { recordAudit, type AuditActor } from './audit';

/**
 * A paper contract filed in one step from the Customers page: the customer's
 * name, the scanned PDF and the contract's value. The customer is made
 * active, with no address or contact details yet: those are on the PDF, and
 * can be added on the customer's page later.
 */

export interface PaperContractInput {
  branch_id: string;
  customer_name: string;
  /** Cents. */
  contract_value: number;
  pdf_key: string;
}

/** "Mary Anne Smith" → Mary Anne / Smith. One word is a first name with no last name. */
export function splitName(full: string): { first_name: string; last_name: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first_name: words[0] ?? '', last_name: '' };
  return { first_name: words.slice(0, -1).join(' '), last_name: words.at(-1)! };
}

function dollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export async function createPaperContract(
  user: AuthenticatedUser,
  actor: AuditActor,
  input: PaperContractInput,
  db: Knex = defaultDb,
): Promise<{ customer: Customer; paper_contract: PaperContract }> {
  const { first_name, last_name } = splitName(input.customer_name);
  if (!first_name) throw badRequest('Enter the customer’s name', [{ path: 'customer_name', message: 'Required' }]);
  if (!Number.isInteger(input.contract_value) || input.contract_value <= 0) {
    throw badRequest('Enter what the contract is worth', [{ path: 'contract_value', message: 'More than zero' }]);
  }

  const upload = (await db('uploads').where({ key: input.pdf_key }).first()) as Upload | undefined;
  if (!upload || upload.status !== 'stored') throw badRequest('The contract PDF has not finished uploading');
  if (upload.purpose !== 'contract_pdf') throw badRequest('That file was not uploaded as a contract');
  if (upload.uploaded_by_user_id !== user.id) throw badRequest('Attach a file you uploaded yourself');

  return db.transaction(async (trx) => {
    const branch = await trx('branches').where({ id: input.branch_id }).first('id');
    if (!branch) throw badRequest('Choose a branch');

    const [customer] = (await trx('customers')
      .insert({
        branch_id: input.branch_id,
        created_by_user_id: user.id,
        first_name,
        last_name,
        email: null,
        phone: null,
        // No contact details yet: they are on the paper contract.
        preferred_contact: 'email',
        status: 'active',
        notes: 'Signed on paper; the contract PDF is on file.',
      })
      .returning('*')) as Customer[];
    const [paper] = (await trx('paper_contracts')
      .insert({
        customer_id: customer!.id,
        branch_id: input.branch_id,
        pdf_key: input.pdf_key,
        file_name: upload.file_name,
        contract_value: dollars(input.contract_value),
        uploaded_by_user_id: user.id,
      })
      .returning('*')) as PaperContract[];
    // The scan belongs to the branch the customer does, like any other file.
    await trx('uploads').where({ key: input.pdf_key }).update({ branch_id: input.branch_id });

    await recordAudit(actor, { action: 'paper_contract.created', entity_type: 'paper_contract', entity_id: paper!.id, after: paper }, trx);
    return { customer: customer!, paper_contract: paper! };
  });
}

export async function listPaperContracts(customerId: string, db: Knex = defaultDb): Promise<PaperContract[]> {
  return (await db('paper_contracts').where({ customer_id: customerId }).orderBy('created_at', 'desc')) as PaperContract[];
}

/** The customer stays: only the filing goes. The PDF stays on disk for the audit trail. */
export async function deletePaperContract(id: string, actor: AuditActor, scope: BranchScope, db: Knex = defaultDb): Promise<void> {
  await db.transaction(async (trx) => {
    const paper = (await applyBranchScope(trx('paper_contracts'), 'branch_id', scope).andWhere({ id }).first()) as
      | PaperContract
      | undefined;
    if (!paper) throw notFound('No such paper contract');
    await trx('paper_contracts').where({ id }).delete();
    await recordAudit(actor, { action: 'paper_contract.deleted', entity_type: 'paper_contract', entity_id: id, before: paper }, trx);
  });
}
