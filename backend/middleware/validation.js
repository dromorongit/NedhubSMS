const { validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      error: {
        code: 'VALIDATION_ERROR',
        details: errors.array()
      }
    });
  }
  next();
};

const validatePhoneNumber = (phoneNumber) => {
  // Ghana phone number validation
  const ghanaPhoneRegex = /^(?:\+233|0)(?:20|50|24|54|27|57|26|56|23|53|28|58|25|55)[0-9]{7}$/;
  return ghanaPhoneRegex.test(phoneNumber);
};

module.exports = {
  validateRequest,
  validatePhoneNumber
};