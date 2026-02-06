const ServiceArea = require('../models/ServiceArea');

async function isServiceAvailable(pincode) {
  if (!pincode) return false;

  const area = await ServiceArea.findOne({
    pincode: pincode.toString(),
    isActive: true
  });

  return !!area;
}

module.exports = {
  isServiceAvailable
};
