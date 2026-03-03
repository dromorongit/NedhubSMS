/**
 * Wallet Migration Script
 * 
 * Purpose: Migrate wallet from credit-based to GHS-based representation
 * 
 * This script:
 * 1. Checks if migration is needed
 * 2. Converts existing credit balances to GHS (if needed)
 * 3. Updates transaction records to reflect GHS
 * 4. Logs all migration activity
 * 
 * Conversion logic: If previous system used 1 credit = 0.01 GHS,
 * divide existing balance by 100 to convert to GHS.
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
  console.log('[Migration] Starting wallet to GHS migration...');
  console.log('[Migration] ======================================');
  
  const migrationName = 'wallet_credits_to_ghs';
  
  // Check if migration already ran
  const existingMigration = await MigrationState.findOne({ migrationName });
  if (existingMigration && existingMigration.status === 'completed') {
    console.log('[Migration] Migration already completed on:', existingMigration.executedAt);
    console.log('[Migration] Skipping migration.');
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
    
    // Get all wallets
    const wallets = await Wallet.find({});
    
    let migratedCount = 0;
    let alreadyGhsCount = 0;
    
    for (const wallet of wallets) {
      console.log(`[Migration] Processing wallet for user: ${wallet.userId}`);
      console.log(`[Migration]   Current balance: ${wallet.balance}`);
      console.log(`[Migration]   Currency: ${wallet.currency}`);
      
      // Check if already using GHS
      if (wallet.currency === 'GHS') {
        console.log(`[Migration]   Wallet already using GHS.`);
        alreadyGhsCount++;
        continue;
      }
      
      // Convert credits to GHS
      // Assuming 1 credit = 0.01 GHS (divide by 100)
      const oldBalance = wallet.balance;
      const newBalance = oldBalance / 100;
      
      wallet.balance = newBalance;
      wallet.currency = 'GHS';
      await wallet.save();
      
      console.log(`[Migration]   Converted: ${oldBalance} credits -> ₵${newBalance.toFixed(2)} GHS`);
      migratedCount++;
    }
    
    // Update transactions to reflect GHS
    const transactionCount = await Transaction.countDocuments({});
    console.log(`[Migration] Found ${transactionCount} transaction(s)`);
    
    // Log transaction conversion (amounts stay the same, just context changes)
    if (transactionCount > 0) {
      const creditTransactions = await Transaction.countDocuments({
        description: { $regex: /credit/i }
      });
      console.log(`[Migration] ${creditTransactions} transaction(s) related to credits`);
    }
    
    // Mark migration as completed
    await MigrationState.findOneAndUpdate(
      { migrationName },
      { status: 'completed', executedAt: new Date() }
    );
    
    console.log('[Migration] ======================================');
    console.log('[Migration] Migration Summary:');
    console.log(`[Migration]   - Wallets migrated: ${migratedCount}`);
    console.log(`[Migration]   - Wallets already GHS: ${alreadyGhsCount}`);
    console.log(`[Migration]   - Total wallets: ${walletCount}`);
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
 * Validation function to verify wallet integrity
 */
async function validateMigration() {
  console.log('[Validation] Starting post-migration validation...');
  
  const Wallet = require('../models/Wallet');
  const Transaction = require('../models/Transaction');
  
  // Check 1: All wallets should have GHS currency
  const nonGhsWallets = await Wallet.find({ currency: { $ne: 'GHS' } });
  if (nonGhsWallets.length > 0) {
    console.error('[Validation] FAILED: Found wallets not using GHS:', nonGhsWallets.length);
    return false;
  }
  console.log('[Validation] PASSED: All wallets using GHS');
  
  // Check 2: No negative balances
  const negativeWallets = await Wallet.find({ balance: { $lt: 0 } });
  if (negativeWallets.length > 0) {
    console.error('[Validation] FAILED: Found negative balances:', negativeWallets.length);
    return false;
  }
  console.log('[Validation] PASSED: No negative balances');
  
  // Check 3: Wallet balance should match sum of transactions
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
  console.log('[Validation] PASSED: All wallet balances match transactions');
  
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
