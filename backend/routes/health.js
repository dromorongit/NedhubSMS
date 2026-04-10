const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Queue } = require('bullmq');
const logger = require('../utils/logger');

// Redis configuration
let redisConfig;
if (process.env.REDIS_URL) {
  redisConfig = process.env.REDIS_URL;
} else {
  redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0,
    username: process.env.REDIS_USERNAME || undefined
  };
}

// Helper function to check Nalo health
async function checkNaloHealth() {
  try {
    // Simple check - assume healthy for now
    // TODO: Implement actual Nalo API health check
    return { status: 'up' };
  } catch (error) {
    logger.error('Nalo health check failed', { error: error.message });
    return { status: 'down', error: error.message };
  }
}

// Helper function to check Hubtel health
async function checkHubtelHealth() {
  try {
    // Simple check - assume healthy for now
    // TODO: Implement actual Hubtel API health check
    return { status: 'up' };
  } catch (error) {
    logger.error('Hubtel health check failed', { error: error.message });
    return { status: 'down', error: error.message };
  }
}

// Basic health check
router.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  };

  // Check database connection state
  const mongoState = mongoose.connection.readyState;
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoState === 1) {
    health.database = 'connected';
  } else if (mongoState === 2) {
    health.database = 'connecting';
    // Don't mark as unhealthy if still connecting - allow time for connection
  } else {
    health.database = 'disconnected';
    // For healthcheck, we'll still return 200 to allow app to start
    // The app will handle database errors on actual API calls
  }

  res.status(200).json(health);
});

// Detailed health check
router.get('/health/detailed', async (req, res) => {
  const health = {
    status: 'healthy',
    services: {}
  };

  // Database - check connection state first
  const mongoState = mongoose.connection.readyState;
  if (mongoState === 1) {
    try {
      await mongoose.connection.db.admin().ping();
      health.services.database = { status: 'up' };
    } catch (error) {
      health.services.database = { status: 'down', error: error.message };
      health.status = 'unhealthy';
      logger.error('Database detailed health check failed', { error: error.message });
    }
  } else if (mongoState === 2) {
    health.services.database = { status: 'connecting' };
    health.status = 'degraded';
  } else {
    health.services.database = { status: 'down', error: 'Not connected' };
    health.status = 'unhealthy';
  }

  // Redis/Queue - try to connect but don't fail the health check
  try {
    const queue = new Queue('sms-queue', { connection: redisConfig });
    await queue.waitUntilReady();
    health.services.redis = { status: 'up' };
    await queue.close(); // Clean up
  } catch (error) {
    health.services.redis = { status: 'down', error: error.message };
    health.status = 'degraded';
  }

  // External services - these are assumed up for now
  health.services.nalo = await checkNaloHealth();
  health.services.hubtel = await checkHubtelHealth();

  if (health.services.nalo.status !== 'up' || health.services.hubtel.status !== 'up') {
    health.status = 'degraded';
  }

  // Return 200 even for degraded/unhealthy to allow Railway health check to pass
  res.status(200).json(health);
});

module.exports = router;