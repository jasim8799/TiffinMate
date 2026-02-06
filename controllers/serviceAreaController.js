const ServiceArea = require('../models/ServiceArea');

// @desc    Get all service areas
// @route   GET /api/service-areas
// @access  Private (Owner only)
exports.getServiceAreas = async (req, res) => {
  try {
    const serviceAreas = await ServiceArea.find({})
      .sort({ areaName: 1 })
      .select('pincode areaName isActive createdAt');

    res.status(200).json({
      success: true,
      count: serviceAreas.length,
      data: serviceAreas
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching service areas',
      error: error.message
    });
  }
};

// @desc    Create new service area
// @route   POST /api/service-areas
// @access  Private (Owner only)
exports.createServiceArea = async (req, res) => {
  try {
    const { pincode, areaName, isActive = true } = req.body;

    // Check if pincode already exists
    const existingArea = await ServiceArea.findOne({ pincode });
    if (existingArea) {
      return res.status(400).json({
        success: false,
        message: 'Service area with this pincode already exists'
      });
    }

    const serviceArea = await ServiceArea.create({
      pincode,
      areaName,
      isActive
    });

    res.status(201).json({
      success: true,
      data: serviceArea
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Service area with this pincode already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating service area',
      error: error.message
    });
  }
};

// @desc    Update service area
// @route   PUT /api/service-areas/:id
// @access  Private (Owner only)
exports.updateServiceArea = async (req, res) => {
  try {
    const { pincode, areaName, isActive } = req.body;

    const serviceArea = await ServiceArea.findByIdAndUpdate(
      req.params.id,
      { pincode, areaName, isActive },
      { new: true, runValidators: true }
    );

    if (!serviceArea) {
      return res.status(404).json({
        success: false,
        message: 'Service area not found'
      });
    }

    res.status(200).json({
      success: true,
      data: serviceArea
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Service area with this pincode already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating service area',
      error: error.message
    });
  }
};

// @desc    Delete service area
// @route   DELETE /api/service-areas/:id
// @access  Private (Owner only)
exports.deleteServiceArea = async (req, res) => {
  try {
    const serviceArea = await ServiceArea.findByIdAndDelete(req.params.id);

    if (!serviceArea) {
      return res.status(404).json({
        success: false,
        message: 'Service area not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Service area deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting service area',
      error: error.message
    });
  }
};
