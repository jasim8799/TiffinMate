const express = require("express");
const router = express.Router();
const Subscription = require("../models/Subscription");

// GET /api/users/profile/:userId
router.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // IMPORTANT: match schema values exactly
    const subscription = await Subscription.findOne({
      userId: userId,
      status: { $in: ["Active", "Paused"] }, // ✅ FIXED
    })
      .sort({ createdAt: -1 })
      .populate("providerId");

    let activeSubscription = null;

    if (subscription) {
      activeSubscription = {
        _id: subscription._id,
        providerName: subscription.providerId?.name || "Unknown",
        plan: subscription.mealType, // ✅ FIXED
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status,
      };
    }

    return res.status(200).json({
      userId,
      name: "Test User",
      phone: "9999999999",
      city: "Surat",
      address: "Adajan, Surat",
      activeSubscription,
    });
  } catch (error) {
    console.error("Profile API error:", error);
    return res.status(500).json({
      message: "Failed to load profile",
    });
  }
});

module.exports = router;
