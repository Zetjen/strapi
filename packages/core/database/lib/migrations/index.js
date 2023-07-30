'use strict';

const path = require('path');
const fse = require('fs-extra');
const { Umzug } = require('umzug');

const createStorage = require('./storage');

const wrapTransaction = (db) => (fn) => () =>
  db.connection.transaction((trx) => Promise.resolve(fn(trx)));

// TODO: check multiple commands in one sql statement
const migrationResolver = ({ name, path, context }) => {
  const { db } = context;

  // if sql file run with knex raw
  if (path.match(/\.sql$/)) {
    const sql = fse.readFileSync(path, 'utf8');

    return {
      name,
      up: wrapTransaction(db)((knex) => knex.raw(sql)),
      down() {},
    };
  }

  // NOTE: we can add some ts register if we want to handle ts migration files at some point
  const migration = require(path);
  return {
    name,
    up: wrapTransaction(db)(migration.up),
    down: wrapTransaction(db)(migration.down),
  };
};

const createUmzugProvider = (db) => {
  // Changed for compatibility with PKG
  // strapi.dirs.app.root was trying to write inside the executable (snapshot) folder
  // using process.cwd() we set the path outside of the executable.

  // WAS: const migrationDir = path.join(strapi.dirs.app.root, 'database/migrations');
  const migrationDir = path.join(process.cwd(), 'database/migrations');

  fse.ensureDirSync(migrationDir);

  return new Umzug({
    storage: createStorage({ db, tableName: 'strapi_migrations' }),
    context: { db },
    migrations: {
      glob: ['*.{js,sql}', { cwd: migrationDir }],
      resolve: migrationResolver,
    },
  });
};

// NOTE: when needed => add internal migrations for core & plugins. How do we overlap them with users migrations ?

/**
 * Creates migrations provider
 * @type {import('.').createMigrationsProvider}
 */
const createMigrationsProvider = (db) => {
  const migrations = createUmzugProvider(db);

  return {
    async shouldRun() {
      const pending = await migrations.pending();

      return pending.length > 0 && db.config.settings.runMigrations;
    },
    async up() {
      await migrations.up();
    },
    async down() {
      await migrations.down();
    },
  };
};

module.exports = { createMigrationsProvider };
