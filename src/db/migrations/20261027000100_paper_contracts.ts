import type { Knex } from 'knex';

/**
 * Paper contracts filed straight from the Customers page: the customer's
 * name, the scanned PDF and what the contract is worth. Everything else
 * (address, dates, terms) is on the PDF, so the CRM does not ask for it.
 *
 * A customer filed this way may have no email or phone yet, so the
 * contactable check also allows a customer with neither. The API's own
 * customer form still asks for one, so this only lets the paper filing
 * through.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('paper_contracts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('customer_id').notNullable().references('id').inTable('customers').onDelete('CASCADE');
    table.uuid('branch_id').notNullable().references('id').inTable('branches').onDelete('RESTRICT');
    table.text('pdf_key').notNullable();
    table.text('file_name').nullable();
    table.decimal('contract_value', 12, 2).notNullable();
    table.uuid('uploaded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['customer_id'], 'paper_contracts_customer_id_index');
  });
  await knex.raw(`
    alter table paper_contracts add constraint paper_contracts_value_check check (contract_value > 0)
  `);

  await knex.raw('alter table customers drop constraint customers_contactable_check');
  await knex.raw(`
    alter table customers add constraint customers_contactable_check
      check (
        (preferred_contact = 'email' and email is not null)
        or (preferred_contact = 'sms' and phone is not null)
        or (preferred_contact = 'both' and email is not null and phone is not null)
        or (email is null and phone is null)
      )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('paper_contracts');
  await knex.raw('alter table customers drop constraint customers_contactable_check');
  await knex.raw(`
    alter table customers add constraint customers_contactable_check
      check (
        (preferred_contact = 'email' and email is not null)
        or (preferred_contact = 'sms' and phone is not null)
        or (preferred_contact = 'both' and email is not null and phone is not null)
      )
  `);
}
