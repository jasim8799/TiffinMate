const express = require('express');
const router = express.Router();
const Provider = require('../models/Provider');

// GET /api/providers - Get all providers or filter by area
router.get('/', async (req, res) => {
  try {
    const { area } = req.query;
    let query = {};
    if (area) {
      query.area = area;
    }
    const providers = await Provider.find(query);
    res.json({
      success: true,
      data: providers,
      message: ""
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

// POST /api/providers - Create a new provider (for testing/seeding)
router.post('/', async (req, res) => {
  const provider = new Provider({
    name: req.body.name,
    area: req.body.area,
    priceMonthly: req.body.priceMonthly,
    mealTypes: req.body.mealTypes
  });

  try {
    const newProvider = await provider.save();
    res.status(201).json({
      success: true,
      data: newProvider,
      message: ""
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      data: null,
      message: error.message
    });
  }
});

module.exports = router;
