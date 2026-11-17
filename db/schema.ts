import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const crisisState = sqliteTable("crisis_state", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  payload: text("payload").notNull(),
});

export const citizenAccounts = sqliteTable("citizen_accounts", {
  id: text("id").primaryKey(), username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(), passwordSalt: text("password_salt").notNull(),
  createdAt: integer("created_at").notNull(), operatorStatus: text("operator_status").notNull().default("pending"),
});
