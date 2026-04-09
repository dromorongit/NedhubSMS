const { migrateCampaigns } = require('./migrateCampaigns');
const { migrateMessages } = require('./migrateMessages');

async function runMigrations() {
  try {
    console.log('Starting migrations...');
    await migrateCampaigns();
    await migrateMessages();
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };