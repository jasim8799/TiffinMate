const express = require('express');
const router = express.Router();

// GET /profile/:userId
router.get('/profile/:userId', (req, res) => {
  const { userId } = req.params;

  // Static user info (for now)
  const userProfile = {
    userId: userId,
    name: 'Test User',
    phone: '9999999999',
    city: 'Surat',
    address: 'Adajan, Surat',
    activeSubscription: null,
  };

  res.json(userProfile);
});

module.exports = router;
