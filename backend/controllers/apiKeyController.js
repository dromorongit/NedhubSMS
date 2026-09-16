const User = require('../models/User');
const { generateApiKey } = require('../utils/apiKeys');
const logger = require('../utils/logger');

const listApiKeys = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('-apiKeys.keyHash');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const apiKeys = (user.apiKeys || []).map(key => ({
      keyId: key.keyId,
      prefix: key.prefix,
      name: key.name,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revoked: key.revoked,
      revokedAt: key.revokedAt
    }));

    res.status(200).json({
      success: true,
      apiKeys
    });
  } catch (error) {
    logger.api.error('List API keys error', {
      error: error.message,
      userId: req.user?.userId
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
};

const createApiKey = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Key name is required'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const { fullKey, prefix, hash } = generateApiKey();
    const keyId = require('crypto').randomBytes(8).toString('hex');

    const newKeyDoc = {
      keyId,
      prefix,
      keyHash: hash,
      name: name.trim()
    };

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $push: { apiKeys: newKeyDoc } },
      { new: true, runValidators: false }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    logger.api.info('API key created', {
      userId,
      keyId,
      prefix
    });

    res.status(201).json({
      success: true,
      message: 'API key created successfully',
      apiKey: {
        keyId,
        prefix,
        fullKey,
        name: name.trim(),
        createdAt: new Date()
      }
    });
  } catch (error) {
    logger.api.error('Create API key error', {
      error: error.message,
      userId: req.user?.userId
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
};

const revokeApiKey = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { keyId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const apiKey = user.apiKeys.find(k => k.keyId === keyId);
    if (!apiKey) {
      return res.status(404).json({
        success: false,
        error: 'API key not found'
      });
    }

    if (apiKey.revoked) {
      return res.status(400).json({
        success: false,
        error: 'API key is already revoked'
      });
    }

    apiKey.revoked = true;
    apiKey.revokedAt = new Date();

    await User.findOneAndUpdate(
      { _id: userId, 'apiKeys.keyId': keyId },
      { $set: { 'apiKeys.$.revoked': true, 'apiKeys.$.revokedAt': apiKey.revokedAt } },
      { new: true, runValidators: false }
    );

    logger.api.info('API key revoked', {
      userId,
      keyId
    });

    const apiKeys = (user.apiKeys || []).map(key => ({
      keyId: key.keyId,
      prefix: key.prefix,
      name: key.name,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revoked: key.revoked,
      revokedAt: key.revokedAt
    }));

    res.status(200).json({
      success: true,
      message: 'API key revoked successfully',
      apiKeys
    });
  } catch (error) {
    logger.api.error('Revoke API key error', {
      error: error.message,
      userId: req.user?.userId,
      keyId: req.params?.keyId
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
};

module.exports = {
  listApiKeys,
  createApiKey,
  revokeApiKey
};
