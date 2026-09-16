import { sql } from 'drizzle-orm';
import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const registrations = sqliteTable('registrations', {
  id: integer('id').primaryKey(),
  email: text('email').notNull(),
  registeredAt: text('registered_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex('registrations_email_unique').on(sql`${table.email} COLLATE NOCASE`)]);
