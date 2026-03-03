/**
 * Wallet Migration Script
 * 
 * Purpose: Migrate wallet from credit-based to GHS-based representation
 * 
 * This script:
 * 1. Adds migrationFlag to wallet documents
 * 2. Converts existing credit balances to GHS (divides by 100)
 * 3. Only converts wallets where migrationFlag != true
 * 4. Logs all migration activity
 * 5. Prevents double execution
 * 
 * Conversion logic: 1 GHS = 100 credits
 * Formula: newBalance = oldBalance / 100
 * 
 * Run with: node backend/utils/migrateWallet.js
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment and database
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const db = require('./database');

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nedhub', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('[Migration] Connected to MongoDB');
  } catch (error) {
    console.error('[Migration] Database connection error:', error);
    process.exit(1);
  }
}

// Migration state collection to ensure migration runs only once
const MigrationStateSchema = new mongoose.Schema({
  migrationName: String,
  executedAt: Date,
  status: String
});

const MigrationState = mongoose.model('MigrationState', MigrationStateSchema);

/**
 * Main migration function
 */
async function migrateWalletToGhs() {
  console.log('[Migration] Starting wallet credit to GHS migration...');
  console.log('[Migration] ======================================');
  console.log('[Migration] Conversion: 1 GHS = 100 credits');
  console.log('[Migration] Formula: balance = balance / 100');
  console.log('[Migration] ======================================');
  
  const migrationName = 'wallet_credits_to_ghs';
  
  // Check if migration already completed successfully
  const existingMigration = await MigrationState.findOne({ 
    migrationName, 
    status: 'completed' 
  });
  
  if (existingMigration) {
    console.log('[Migration] Migration already completed on:', existingMigration.executedAt);
    console.log('[Migration] Skipping migration to prevent double conversion.');
    return;
  }
  
  // Mark migration as started
  await MigrationState.findOneAndUpdate(
    { migrationName },
    { migrationName, executedAt: new Date(), status: 'started' },
    { upsert: true }
  );
  
  try {
    // Access Wallet model
    const Wallet = require('../models/Wallet');
    const Transaction = require('../models/Transaction');
    
    // Check if any wallets exist
    const walletCount = await Wallet.countDocuments();
    console.log(`[Migration] Found ${walletCount} wallet(s)`);
    
    if (walletCount === 0) {
      console.log('[Migration] No wallets to migrate.');
      await MigrationState.findOneAndUpdate(
        { migrationName },
        { status: 'completed', executedAt: new Date() }
      );
      return;
    }
    
    // Get all wallets that need migration (migrationFlag != true)
    const wallets = await Wallet.find({ 
      $or: [
        { migrationFlag: { $exists: false } },
        { migrationFlag: { $ne: true } }
      ]
    });
    
    console.log(`[Migration] Wallets pending migration: ${wallets.length}`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    
    for (const wallet of wallets) {
      console.log(`\n[Migration] Processing wallet for user: ${wallet.userId}`);
      console.log(`[Migration]   Original balance: ${wallet.balance} credits`);
      
      // Safety check: abort if balance is negative
      if (wallet.balance < 0) {
        console.error(`[Migration]   ERROR: Negative balance detected! Aborting.`);
        failedCount++;
        continue;
      }
      
      // Convert credits to GHS
      // Formula: balance = balance / 100
      const oldBalance = wallet.balance;
      const newBalance = Math.round((oldBalance / 100) * 100) / 100;
      
      console.log(`[Migration]   New balance: ₵${newBalance.toFixed(2)} GHS`);
      
      // Update wallet with new balance and migration flag
      wallet.balance = newBalance;
      wallet.currency = 'GHS';
      wallet.migrationFlag = true;  // Mark as migrated to prevent double execution
      
      await wallet.save();
      
      console.log(`[Migration]   ✓ Migration complete`);
      migratedCount++;
    }
    
    // Summary of migration
    console.log('\n[Migration] ======================================');
    console.log('[Migration] Migration Summary:');
    console.log(`[Migration]   - Wallets migrated: ${migratedCount}`);
    console.log(`[Migration]   - Wallets skipped (already migrated): ${skippedCount}`);
    console.log(`[Migration]   - Wallets failed: ${failedCount}`);
    
    // Also migrate transactions to GHS
    console.log('\n[Migration] Migrating transactions...');
    const transactions = await Transaction.find({});
    let txMigrated = 0;
    for (const tx of transactions) {
      // Convert transaction amounts
      tx.amount = Math.round((tx.amount / 100) * 100) / 100;
      tx.balanceBefore = Math.round((tx.balanceBefore / 100) * 100) / 100;
      tx.balanceAfter = Math.round((tx.balanceAfter / 100) * 100) / 100;
      await tx.save();
      txMigrated++;
    }
    console.log(`[Migration]   - Transactions migrated: ${txMigrated}`);
    console.log('[Migration] ======================================');
    
    // Mark migration as completed
    await MigrationState.findOneAndUpdate(
      { migrationName },
      { status: 'completed', executedAt: new Date() }
    );
    
    console.log('[Migration] Migration completed successfully!');
    
  } catch (error) {
    console.error('[Migration] Error during migration:', error);
    
    // Mark migration as failed
    await MigrationState.findOneAndUpdate(
      { migrationName },
      { status: 'failed', executedAt: new Date() }
    );
    
    throw error;
  }
}

/**
 * Validation function to verify wallet integrity after migration
 */
async function validateMigration() {
  console.log('[Validation] Starting post-migration validation...');
  console.log('[Validation] ======================================');
  
  const Wallet = require('../models/Wallet');
  const Transaction = require('../models/Transaction');
  
  // Check 1: All wallets should have GHS currency
  const nonGhsWallets = await Wallet.find({ currency: { $ne: 'GHS' } });
  if (nonGhsWallets.length > 0) {
    console.error('[Validation] FAILED: Found wallets not using GHS:', nonGhsWallets.length);
    return false;
  }
  console.log('[Validation] ✓ All wallets using GHS');
  
  // Check 2: No negative balances
  const negativeWallets = await Wallet.find({ balance: { $lt: 0 } });
  if (negativeWallets.length > 0) {
    console.error('[Validation] FAILED: Found negative balances:', negativeWallets.length);
    return false;
  }
  console.log('[Validation] ✓ No negative balances');
  
  // Check 3: All wallets should have migrationFlag = true
  const unflaggedWallets = await Wallet.find({ migrationFlag: { $ne: true } });
  if (unflaggedWallets.length > 0) {
    console.error('[Validation] FAILED: Found wallets without migration flag:', unflaggedWallets.length);
    return false;
  }
  console.log('[Validation] ✓ All wallets have migration flag');
  
  // Check 4: Wallet balance should match sum of transactions
  const wallets = await Wallet.find({});
  let balanceMismatchCount = 0;
  
  for (const wallet of wallets) {
    const transactions = await Transaction.find({ userId: wallet.userId });
    
    let calculatedBalance = 0;
    for (const tx of transactions) {
      if (tx.type === 'credit') {
        calculatedBalance += tx.amount;
      } else if (tx.type === 'debit') {
        calculatedBalance -= tx.amount;
      }
    }
    
    // Allow small floating point differences
    if (Math.abs(calculatedBalance - wallet.balance) > 0.01) {
      console.error(`[Validation] Wallet ${wallet.userId}: Expected ${calculatedBalance}, got ${wallet.balance}`);
      balanceMismatchCount++;
    }
  }
  
  if (balanceMismatchCount > 0) {
    console.error('[Validation] FAILED: Balance mismatch in', balanceMismatchCount, 'wallets');
    return false;
  }
  console.log('[Validation] ✓ All wallet balances match transactions');
  
  console.log('[Validation] ======================================');
  console.log('[Validation] All validations passed!');
  return true;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const shouldValidate = args.includes('--validate');
  
  await connectDB();
  
  try {
    await migrateWalletToGhs();
    
    if (shouldValidate) {
      const isValid = await validateMigration();
      if (!isValid) {
        console.error('[Validation] Validation failed!');
        process.exit(1);
      }
    }
    
    console.log('[Migration] Done.');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { migrateWalletToGhs, validateMigration };
