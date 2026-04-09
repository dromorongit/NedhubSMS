const express = require('express');
const router = express.Router();
const MetricsService = require('../services/MetricsService');

router.get('/metrics', (req, res) => {
  const metrics = MetricsService.getMetrics();
  res.json(metrics);
});

module.exports = router;