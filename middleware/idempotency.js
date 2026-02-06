const Idempotency = require('../models/Idempotency');

const idempotencyMiddleware = (req, res, next) => {
  // Only apply to POST requests
  if (req.method !== 'POST') {
    return next();
  }

  const idempotencyKey = req.headers['x-idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      success: false,
      message: 'X-Idempotency-Key header is required for POST requests'
    });
  }

  // Validate key format (basic UUID check)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(idempotencyKey)) {
    return res.status(400).json({
      success: false,
      message: 'X-Idempotency-Key must be a valid UUID'
    });
  }

  const userId = req.user ? req.user._id : null;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const endpoint = req.originalUrl;

  // Check if key already exists
  Idempotency.findOne({ key: idempotencyKey, userId, endpoint })
    .then(existing => {
      if (existing) {
        if (existing.status === 'completed') {
          // Return the stored response
          return res.status(existing.response.statusCode).json(existing.response.body);
        } else {
          // Still processing
          return res.status(409).json({
            success: false,
            message: 'Request is still processing'
          });
        }
      }

      // Create new idempotency record
      Idempotency.create({
        key: idempotencyKey,
        userId,
        endpoint,
        status: 'processing'
      })
      .then(() => {
        // Store original response methods
        const originalJson = res.json;
        const originalStatus = res.status;

        res.json = function(body) {
          // Update idempotency record with response
          Idempotency.findOneAndUpdate(
            { key: idempotencyKey, userId, endpoint },
            {
              status: 'completed',
              response: {
                statusCode: res.statusCode,
                body: body
              }
            }
          ).catch(err => {
            console.error('Failed to update idempotency record:', err);
          });

          // Call original json method
          return originalJson.call(this, body);
        };

        next();
      })
      .catch(err => {
        console.error('Failed to create idempotency record:', err);
        return res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      });
    })
    .catch(err => {
      console.error('Failed to check idempotency:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    });
};

module.exports = idempotencyMiddleware;
