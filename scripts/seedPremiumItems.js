const mongoose = require('mongoose');
const PremiumMenuItem = require('../models/PremiumMenuItem');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Premium menu items data
const premiumItems = [
  // DAL category
  { category: 'dal', name: 'DAL FRY', isVegOnly: true, compulsoryAddon: null },
  { category: 'dal', name: 'DAL MAKHANI', isVegOnly: true, compulsoryAddon: null },
  { category: 'dal', name: 'DAL TADKA', isVegOnly: true, compulsoryAddon: null },
  { category: 'dal', name: 'RAJMA DAL', isVegOnly: true, compulsoryAddon: null },
  { category: 'dal', name: 'CHANA DAL', isVegOnly: true, compulsoryAddon: null },

  // RICE category
  { category: 'rice', name: 'PLAIN RICE', isVegOnly: true, compulsoryAddon: null },
  { category: 'rice', name: 'JEERA RICE', isVegOnly: true, compulsoryAddon: null },
  { category: 'rice', name: 'FRIED RICE', isVegOnly: true, compulsoryAddon: null },
  { category: 'rice', name: 'SOYA RICE', isVegOnly: true, compulsoryAddon: null },

  // BREAD category
  { category: 'bread', name: 'ROTI', isVegOnly: true, compulsoryAddon: null },
  { category: 'bread', name: 'PARATHA', isVegOnly: true, compulsoryAddon: 'CHUTNEY' },
  { category: 'bread', name: 'LACHHA PARATHA', isVegOnly: true, compulsoryAddon: 'CHUTNEY' },
  { category: 'bread', name: 'PLAIN PARATHA', isVegOnly: true, compulsoryAddon: 'CHUTNEY' },
  { category: 'bread', name: 'SATTU PARATHA', isVegOnly: true, compulsoryAddon: 'CHUTNEY' },
  { category: 'bread', name: 'PURI', isVegOnly: true, compulsoryAddon: null },
  { category: 'bread', name: 'NAAN', isVegOnly: true, compulsoryAddon: null },

  // VEG category
  { category: 'veg', name: 'MIX-VEG', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'SEASONAL VEG', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'AALOO SOYABEEN', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'AALOO BHUJIYA', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'AALOO GOBI', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'KADAI PANEER', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'PANEER MASALA', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'PANEER TIKKA', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'PALAK PANEER', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'MUTAR MUSHROOM', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'BESAN GATTA', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'AALOO DUM', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'CHHOLE MASALA', isVegOnly: true, compulsoryAddon: null },
  { category: 'veg', name: 'RAJMA', isVegOnly: true, compulsoryAddon: null },

  // NON-VEG category
  { category: 'non-veg', name: 'CHICKEN CURRY', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'CHICKEN MASALA', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'BUTTER CHICKEN', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'CHICKEN KORMA', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'TANDOORI CHICKEN', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'EGG CURRY', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'EGG BHURJI', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'EGG AALOO DUM', isVegOnly: false, compulsoryAddon: null },
  { category: 'non-veg', name: 'KEEMA', isVegOnly: false, compulsoryAddon: null },

  // BIRYANI category
  { category: 'biryani', name: 'CHICKEN BIRYANI', isVegOnly: false, compulsoryAddon: 'CHUTNEY' },
  { category: 'biryani', name: 'EGG BIRYANI', isVegOnly: false, compulsoryAddon: 'CHUTNEY' },
  { category: 'biryani', name: 'HYDRABADI BIRYANI', isVegOnly: false, compulsoryAddon: 'CHUTNEY' },
  { category: 'biryani', name: 'MURADABADI BIRYANI', isVegOnly: false, compulsoryAddon: 'CHUTNEY' },
  { category: 'biryani', name: 'VEG BIRYANI', isVegOnly: true, compulsoryAddon: 'CHUTNEY' },
  { category: 'biryani', name: 'VEG PULAO', isVegOnly: true, compulsoryAddon: null },
  { category: 'biryani', name: 'KHICHDI', isVegOnly: true, compulsoryAddon: 'PICKLE' },
  { category: 'biryani', name: 'AALOO CHOKHA', isVegOnly: true, compulsoryAddon: null },

  // RAITA_SWEETS_SALAD category
  { category: 'raita_sweets_salad', name: 'SALAD', isVegOnly: true, compulsoryAddon: null },
  { category: 'raita_sweets_salad', name: 'RAITA', isVegOnly: true, compulsoryAddon: null },
  { category: 'raita_sweets_salad', name: 'PICKLE', isVegOnly: true, compulsoryAddon: null },
  { category: 'raita_sweets_salad', name: 'CHUTNEY', isVegOnly: true, compulsoryAddon: null },
  { category: 'raita_sweets_salad', name: 'SWEETS', isVegOnly: true, compulsoryAddon: null },
  { category: 'raita_sweets_salad', name: 'HALWA', isVegOnly: true, compulsoryAddon: null },
  { category: 'raita_sweets_salad', name: 'KHEER', isVegOnly: true, compulsoryAddon: null }
];

const seedPremiumItems = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');

    // Clear existing items
    await PremiumMenuItem.deleteMany({});
    console.log('🗑️  Cleared existing premium items');

    // Insert new items
    const result = await PremiumMenuItem.insertMany(premiumItems);
    console.log(`✅ Successfully seeded ${result.length} premium menu items`);

    // Display summary
    const summary = await PremiumMenuItem.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    console.log('\n📊 Summary by Category:');
    summary.forEach(item => {
      console.log(`  ${item._id}: ${item.count} items`);
    });

    console.log('\n🎉 Seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding premium items:', error);
    process.exit(1);
  }
};

seedPremiumItems();
