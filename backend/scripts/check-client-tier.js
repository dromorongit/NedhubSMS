const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../utils/database');
const CostCalculatorService = require('../services/CostCalculatorService');
const User = require('../models/User');
const SmsMessage = require('../models/SmsMessage');

async function main() {
  try {
    await connectDB();
    console.log('Connected to MongoDB\n');

    const calculator = CostCalculatorService;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const users = await User.find({ role: 'user', status: 'active' }).select('_id name email').lean();
    console.log(`Found ${users.length} active users\n`);

    const results = [];
    for (const user of users) {
      const monthlyVolume = await SmsMessage.countDocuments({
        userId: user._id,
        status: { $in: ['sent', 'delivered'] },
        createdAt: { $gte: startOfMonth }
      });

      const providerCost = calculator.getProviderCostPerSms(monthlyVolume);
      const tierInfo = calculator.getCurrentTierInfo(monthlyVolume);

      results.push({
        userId: user._id,
        name: user.name,
        email: user.email,
        monthlyVolume,
        tier: tierInfo.tierNumber,
        tierMin: tierInfo.min,
        tierMax: tierInfo.max,
        providerCost,
        sellPriceCurrent: calculator.defaultSellPricePerSms,
      sellPriceProposed: 0.078,
      profitableAtCurrent: calculator.defaultSellPricePerSms > providerCost,
      profitableAtProposed: 0.078 > providerCost
      });
    }

    results.sort((a, b) => b.monthlyVolume - a.monthlyVolume);

    console.log('='.repeat(120));
    console.log('CLIENT TIER VERIFICATION REPORT');
    console.log('='.repeat(120));
    console.log('Proposed sell price: GHS 0.078');
    console.log('Current sell price: GHS ' + calculator.defaultSellPricePerSms);
    console.log('');

    const tier1 = results.filter(r => r.tier === 1);
    const tier2 = results.filter(r => r.tier === 2);
    const tier3 = results.filter(r => r.tier >= 3);

    console.log('SUMMARY');
    console.log('-'.repeat(120));
    console.log(`Tier 1 clients (cost GHS 0.082): ${tier1.length}`);
    console.log(`Tier 2 clients (cost GHS 0.072): ${tier2.length}`);
    console.log(`Tier 3+ clients (cost GHS 0.062): ${tier3.length}`);
    console.log('');

    console.log('DETAILED CLIENT BREAKDOWN');
    console.log('-'.repeat(120));
    console.log('Name'.padEnd(25) + 'Email'.padEnd(35) + 'Volume'.padEnd(12) + 'Tier'.padEnd(8) + 'Cost'.padEnd(10) + 'Curr OK'.padEnd(10) + 'New OK'.padEnd(10) + 'Status');
    console.log('-'.repeat(120));

    for (const r of results) {
      const name = (r.name || 'Unknown').substring(0, 24).padEnd(25);
      const email = (r.email || '').substring(0, 34).padEnd(35);
      const volume = String(r.monthlyVolume).padEnd(12);
      const tier = String(r.tier).padEnd(8);
      const cost = String(r.providerCost).padEnd(10);
      const currOk = r.profitableAtCurrent ? 'YES' : 'NO';
      const newOk = r.profitableAtProposed ? 'YES' : 'NO';
      const status = r.profitableAtProposed ? '' : 'UNPROFITABLE';
      console.log(`${name}${email}${volume}${tier}${cost}${currOk.padEnd(10)}${newOk.padEnd(10)}${status}`);
    }

    console.log('');
    console.log('='.repeat(120));
    console.log('VERIFICATION RESULT');
    console.log('='.repeat(120));

    const unprofitable = results.filter(r => !r.profitableAtProposed);
    if (unprofitable.length === 0) {
      console.log('PASS: GHS 0.078 is profitable for all checked clients.');
    } else {
        console.log(`FAIL: GHS 0.078 would be UNPROFITABLE for ${unprofitable.length} client(s):`);
      for (const r of unprofitable) {
        console.log(`  - ${r.name} (${r.email}): Tier ${r.tier}, volume ${r.monthlyVolume}, provider cost GHS ${r.providerCost}`);
      }
      console.log('');
        console.log('RECOMMENDATION: Do NOT change defaultSellPricePerSms to 0.078 GHS.');
    }

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(unprofitable.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
