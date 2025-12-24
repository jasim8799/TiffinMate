const express = require("express");
const router = express.Router();
const Subscription = require("../models/Subscription");

// GET /api/users/profile/:userId
router.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("Fetching profile for userId:", userId);

    // Find latest ACTIVE or PAUSED subscription
    const subscription = await Subscription.findOne({
      userId: userId,
      status: { $in: ["ACTIVE", "PAUSED"] },
    }).sort({ createdAt: -1 });

    console.log("Subscription found:", subscription);

    let activeSubscription = null;

    if (subscription) {
      activeSubscription = {
        _id: subscription._id,
        providerName: subscription.providerName,
        plan: subscription.plan,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status,
      };
    }

    // Static user info for now (auth disabled)
    const userProfile = {
      userId: userId,
      name: "Test User",
      phone: "9999999999",
      city: "Surat",
      address: "Adajan, Surat",
      activeSubscription: activeSubscription,
    };

    return res.status(200).json(userProfile);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({
      message: "Failed to load profile",
    });
  }
});

module.exports = router;
