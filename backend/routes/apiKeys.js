const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  listApiKeys,
  createApiKey,
  revokeApiKey
} = require('../controllers/apiKeyController');

router.get('/', authenticate, listApiKeys);
router.post('/', authenticate, createApiKey);
router.delete('/:keyId', authenticate, revokeApiKey);

module.exports = router;
