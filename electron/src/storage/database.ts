// SQLite Database Connection Manager - Phase 3
// Manages the SQLite database connection for Electron main process

import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { Database as DatabaseType } from 'better-sqlite3';

// Database instance (lazy loaded)
let db: DatabaseType | null = null;

// Database file path
export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'secuchat.db');
}

// Schema file path (relative to this file)
function getSchemaPath(): string {
  return join(__dirname, 'schema.sql');
}

/**
 * Initialize the SQLite database
 * Creates tables if they don't exist
 */
export function initializeDatabase(): DatabaseType {
  if (db) {
    return db;
  }

  // Dynamic import for better-sqlite3 (native module)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');

  const dbPath = getDatabasePath();
  console.log('[Storage] Opening database at:', dbPath);
  console.log('[Storage] Database directory exists:', require('fs').existsSync(require('path').dirname(dbPath)));

  // Open database with WAL mode for better concurrency
  const newDb: DatabaseType = new Database(dbPath);
  newDb.pragma('journal_mode = WAL');
  newDb.pragma('foreign_keys = ON');

  // Initialize schema
  initializeSchema(newDb);

  // Run migrations to handle schema updates for existing databases
  migrateDatabase(newDb);

  db = newDb;

  console.log('[Storage] Database initialized successfully');
  return newDb;
}

/**
 * Initialize database schema from SQL file
 */
function initializeSchema(database: DatabaseType): void {
  const schemaPath = getSchemaPath();

  if (!existsSync(schemaPath)) {
    console.warn('[Storage] Schema file not found, using inline schema');
    initializeSchemaInline(database);
    return;
  }

  try {
    const schema = readFileSync(schemaPath, 'utf-8');
    database.exec(schema);
    console.log('[Storage] Schema applied from file');
  } catch (error) {
    console.error('[Storage] Failed to apply schema from file:', error);
    initializeSchemaInline(database);
  }
}

/**
 * Fallback inline schema initialization
 */
function initializeSchemaInline(database: DatabaseType): void {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT,
      pgp_public_key TEXT NOT NULL,
      pgp_private_key TEXT,
      fingerprint TEXT NOT NULL UNIQUE,
      i2p_address TEXT NOT NULL,
      i2p_public_key TEXT,
      i2p_private_key TEXT,
      i2p_sam_destination TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pgp_public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      p2p_identifier TEXT NOT NULL,
      i2p_address TEXT NOT NULL,
      last_seen TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL UNIQUE,
      last_message_timestamp TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending',
      type TEXT NOT NULL DEFAULT 'text',
      reply_to TEXT,
      file_info TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      i2p_address TEXT NOT NULL UNIQUE,
      last_sync TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_fingerprint ON contacts(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_chats_contact_id ON chats(contact_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_devices_i2p ON devices(i2p_address);
  `;

  database.exec(schema);
  console.log('[Storage] Inline schema applied');
}

/**
 * Get the database instance (initializes if needed)
 */
export function getDatabase(): DatabaseType {
  if (!db) {
    return initializeDatabase();
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Storage] Database closed');
  }
}

/**
 * Check if database is initialized
 */
export function isDatabaseInitialized(): boolean {
  return db !== null;
}

/**
 * Migrate database schema for existing databases
 * Handles adding columns to existing tables (CREATE TABLE IF NOT EXISTS doesn't add columns)
 */
function migrateDatabase(database: DatabaseType): void {
  try {
    // Check if i2p_sam_destination column exists in users table
    const tableInfo = database.pragma('table_info(users)') as Array<{ name: string }>;
    const hasSamDestinationColumn = tableInfo.some(col => col.name === 'i2p_sam_destination');

    if (!hasSamDestinationColumn) {
      console.log('[Storage] Migration: Adding i2p_sam_destination column to users table');
      database.exec('ALTER TABLE users ADD COLUMN i2p_sam_destination TEXT');
      console.log('[Storage] Migration: i2p_sam_destination column added successfully');
    }
  } catch (error) {
    console.error('[Storage] Migration failed:', error);
    // Don't throw - allow app to continue even if migration fails
    // The column might already exist or there might be a different issue
  }
}

/**
 * Run a transaction with automatic rollback on error
 */
export function runTransaction<T>(fn: () => T): T {
  const database = getDatabase();
  const transaction = database.transaction(fn);
  return transaction();
}
