import type { Knex } from 'knex';

/**
 * Two changes to how the customer pays:
 *
 * - "Other" joins the payment types, for anything that is not a card,
 *   cheque, e-transfer or cash.
 * - A paper contract records its payment type too. Null on the paper
 *   contracts filed before the form asked.
 *
 * The lists are written out rather than imported: a migration is history.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table quotes drop constraint quotes_payment_type_check');
  await knex.raw(`
    alter table quotes add constraint quotes_payment_type_check
      check (payment_type in ('credit_card', 'visa_debit', 'cheque', 'e_transfer', 'cash', 'other', 'yia'))
  `);

  await knex.schema.alterTable('paper_contracts', (table) => {
    table.text('payment_type').nullable();
  });
  await knex.raw(`
    alter table paper_contracts add constraint paper_contracts_payment_type_check
      check (payment_type in ('credit_card', 'visa_debit', 'cheque', 'e_transfer', 'cash', 'other', 'yia'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table paper_contracts drop constraint paper_contracts_payment_type_check');
  await knex.schema.alterTable('paper_contracts', (table) => {
    table.dropColumn('payment_type');
  });

  await knex('quotes').where({ payment_type: 'other' }).update({ payment_type: null });
  await knex.raw('alter table quotes drop constraint quotes_payment_type_check');
  await knex.raw(`
    alter table quotes add constraint quotes_payment_type_check
      check (payment_type in ('credit_card', 'visa_debit', 'cheque', 'e_transfer', 'cash', 'yia'))
  `);
}
