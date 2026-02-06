const express = require('express');
const router = express.Router();
const ServiceArea = require('../models/ServiceArea');
const { protect, authorize } = require('../middleware/auth');

// Create service area (OWNER)
router.post('/', protect, authorize('owner'), async (req, res) => {
  try {
    const { pincode, areaName } = req.body;

    if (!pincode || !areaName) {
      return res.status(400).json({
        success: false,
        message: 'Pincode and area name are required'
      });
    }

    const area = await ServiceArea.create({
      pincode,
      areaName
    });

    res.status(201).json({
      success: true,
      data: area
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create service area',
      error: error.message
    });
  }
});

// Get all service areas (OWNER)
router.get('/', protect, authorize('owner'), async (req, res) => {
  try {
    const areas = await ServiceArea.find().sort({ pincode: 1 });
    res.json({
      success: true,
      data: areas
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service areas'
    });
  }
});

module.exports = router;
