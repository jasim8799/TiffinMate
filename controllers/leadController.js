const Lead = require('../models/Lead');
const axios = require('axios');
const { createNotification } = require('./notificationController');

// @desc    Submit lead from out-of-service area OR general inquiry
// @route   POST /api/leads
// @access  Public
exports.submitLead = async (req, res) => {
  try {
    const { name, phone, latitude, longitude, distance, address, area, message, source } = req.body;

    // Validate required fields
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name and phone number'
      });
    }

    // Check if lead already exists with same phone
    const existingLead = await Lead.findOne({ phone });
    if (existingLead) {
      return res.status(200).json({
        success: true,
        message: 'We already have your contact details. We will reach out to you soon!',
        data: existingLead
      });
    }

    // Prepare lead data
    const leadData = {
      name,
      phone,
      source: source || 'app'
    };

    // Add optional fields
    if (area) leadData.area = area;
    if (message) leadData.message = message;

    // Add location if provided (for out-of-service area leads)
    if (latitude && longitude && distance !== undefined) {
      leadData.location = {
        latitude,
        longitude,
        distance,
        address: address || ''
      };
    }

    // Create new lead
    const lead = await Lead.create(leadData);

    // Send WhatsApp notification to owner only if location-based
    if (latitude && longitude && distance !== undefined) {
      try {
        await sendWhatsAppNotification(lead);
        lead.notificationSent = true;
        await lead.save();
      } catch (whatsappError) {
        console.error('WhatsApp notification failed:', whatsappError.message);
        // Don't fail the request if WhatsApp fails
      }
    }

    // Create in-app notification for owner
    const notificationMessage = latitude && longitude 
      ? `New lead from ${name} - ${distance.toFixed(1)} km away`
      : `New service inquiry from ${name}${area ? ` in ${area}` : ''}`;
    
    await createNotification(
      'NEW_LEAD',
      notificationMessage,
      lead._id,
      'Lead',
      {
        name: name,
        phone: phone,
        area: area || '',
        distance: distance || 0
      }
    );

    res.status(201).json({
      success: true,
      message: 'Thank you! We will contact you soon.',
      data: lead
    });
  } catch (error) {
    console.error('Submit lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting lead',
      error: error.message
    });
  }
};

// @desc    Get all leads (owner only)
// @route   GET /api/leads
// @access  Private (Owner)
exports.getAllLeads = async (req, res) => {
  try {
    const { status, sort = '-createdAt' } = req.query;
    
    const filter = {};
    if (status) {
      filter.status = status;
    }

    const leads = await Lead.find(filter).sort(sort);

    res.status(200).json({
      success: true,
      count: leads.length,
      data: leads
    });
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching leads',
      error: error.message
    });
  }
};

// @desc    Update lead status (owner only)
// @route   PUT /api/leads/:id
// @access  Private (Owner)
exports.updateLead = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    if (status) lead.status = status;
    if (notes !== undefined) lead.notes = notes;

    await lead.save();

    res.status(200).json({
      success: true,
      message: 'Lead updated successfully',
      data: lead
    });
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating lead',
      error: error.message
    });
  }
};

// Helper function to send WhatsApp notification
async function sendWhatsAppNotification(lead) {
  const ownerPhone = process.env.OWNER_WHATSAPP || '919876543210'; // Without + sign
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    console.log('⚠️  WhatsApp notification skipped: FAST2SMS_API_KEY not configured');
    return;
  }

  const message = `🚀 NEW LEAD - Service Area Expansion

👤 Name: ${lead.name}
📱 Phone: ${lead.phone}
📍 Distance: ${lead.location.distance.toFixed(1)} km away
${lead.location.address ? `🏠 Address: ${lead.location.address}\n` : ''}
⏰ Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

This customer is interested in your service but is currently outside the 10 km service radius.

Contact them to discuss future service availability!`;

  try {
    const response = await axios.post('https://www.fast2sms.com/dev/bulkV2', {
      route: 'q',
      message: message,
      language: 'english',
      flash: 0,
      numbers: ownerPhone
    }, {
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ WhatsApp notification sent to owner:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ WhatsApp notification error:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = exports;
