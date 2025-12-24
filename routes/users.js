const express = require("express");
const router = express.Router();
const Subscription = require("../models/Subscription");

router.get("/profile/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["ACTIVE", "PAUSED"] },
    })
      .sort({ createdAt: -1 })
      .populate("providerId");

    let activeSubscription = null;

    if (subscription) {
      activeSubscription = {
        _id: subscription._id,
        providerName: subscription.providerId?.name || "Unknown",
        plan: subscription.plan,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status,
      };
    }

    res.status(200).json({
      userId,
      name: "Test User",
      phone: "9999999999",
      city: "Surat",
      address: "Adajan, Surat",
      activeSubscription,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to load profile" });
  }
});

module.exports = router;
