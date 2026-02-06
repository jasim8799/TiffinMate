const mongoose = require('mongoose');
const WeeklyMenu = require('../models/WeeklyMenu');

require('dotenv').config();

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected for seeding...');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

// Weekly menu data for all plan categories
const weeklyMenuData = [
  // CLASSIC PLAN - Sunday
  {
    dayOfWeek: 'sunday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['MIX-VEG', 'DAL', 'RICE', 'SALAD'],
    description: 'Classic Sunday lunch with seasonal vegetables',
    isActive: true
  },
  {
    dayOfWeek: 'sunday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['CHICKEN BIRYANI', 'SALAD', 'RAITA'],
    description: 'Special Sunday dinner with biryani',
    isActive: true
  },

  // CLASSIC PLAN - Monday
  {
    dayOfWeek: 'monday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['AALOO SOYABEEN', 'RICE', 'SALAD'],
    description: 'Monday lunch with potato and beans',
    isActive: true
  },
  {
    dayOfWeek: 'monday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['SEASONAL VEG', 'ROTI', 'SALAD'],
    description: 'Monday dinner with seasonal vegetables',
    isActive: true
  },

  // CLASSIC PLAN - Tuesday
  {
    dayOfWeek: 'tuesday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['RAJMA', 'RICE', 'RAITA'],
    description: 'Tuesday lunch with kidney beans curry',
    isActive: true
  },
  {
    dayOfWeek: 'tuesday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['KADAI PANEER', 'ROTI', 'HALWA'],
    description: 'Tuesday dinner with paneer curry',
    isActive: true
  },

  // CLASSIC PLAN - Wednesday
  {
    dayOfWeek: 'wednesday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['CHICKEN CURRY', 'RICE', 'SALAD'],
    description: 'Wednesday lunch with chicken curry',
    isActive: true
  },
  {
    dayOfWeek: 'wednesday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['DAL FRY', 'ROTI', 'SALAD'],
    description: 'Wednesday dinner with dal fry',
    isActive: true
  },

  // CLASSIC PLAN - Thursday
  {
    dayOfWeek: 'thursday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['VEGITABLE', 'RICE', 'SALAD'],
    description: 'Thursday lunch with mixed vegetables',
    isActive: true
  },
  {
    dayOfWeek: 'thursday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['MIX-VEG', 'ROTI', 'SALAD'],
    description: 'Thursday dinner with mixed vegetables',
    isActive: true
  },

  // CLASSIC PLAN - Friday
  {
    dayOfWeek: 'friday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['CHHOLE MASALA', 'RICE', 'SALAD'],
    description: 'Friday lunch with chickpea curry',
    isActive: true
  },
  {
    dayOfWeek: 'friday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['EGG CURRY', 'ROTI', 'SALAD'],
    description: 'Friday dinner with egg curry',
    isActive: true
  },

  // CLASSIC PLAN - Saturday
  {
    dayOfWeek: 'saturday',
    mealType: 'lunch',
    planCategory: 'classic',
    items: ['KHICHDI', 'AALOO CHOKHA', 'PICKLE'],
    description: 'Saturday lunch with khichdi and potato mash',
    isActive: true
  },
  {
    dayOfWeek: 'saturday',
    mealType: 'dinner',
    planCategory: 'classic',
    items: ['CHHOLE MASALA', 'PURI', 'SWEETS'],
    description: 'Saturday dinner with chickpea curry and puri',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Sunday
  {
    dayOfWeek: 'sunday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['MIX-VEG', 'DAL', 'JEERA RICE', 'ROTI', 'SALAD'],
    description: 'Premium veg Sunday lunch with jeera rice',
    isActive: true
  },
  {
    dayOfWeek: 'sunday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['VEG BIRYANI', 'SALAD', 'RAITA'],
    description: 'Premium veg Sunday dinner with veg biryani',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Monday
  {
    dayOfWeek: 'monday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['AALOO SOYABEEN', 'DAL', 'FRIED RICE', 'ROTI', 'KHEER'],
    description: 'Premium veg Monday lunch with fried rice',
    isActive: true
  },
  {
    dayOfWeek: 'monday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['SEASONAL VEG', 'DAL', 'RICE', 'ROTI', 'SALAD'],
    description: 'Premium veg Monday dinner with seasonal vegetables',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Tuesday
  {
    dayOfWeek: 'tuesday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['RAJMA', 'AALOO BHUJIYA', 'JEERA RICE', 'ROTI', 'RAITA'],
    description: 'Premium veg Tuesday lunch with rajma and jeera rice',
    isActive: true
  },
  {
    dayOfWeek: 'tuesday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['KADAI PANEER', 'LACHHA PARATHA', 'SALAD'],
    description: 'Premium veg Tuesday dinner with paneer and paratha',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Wednesday
  {
    dayOfWeek: 'wednesday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['MUTAR MUSHROOM', 'DAL', 'SOYA RICE', 'ROTI', 'SALAD'],
    description: 'Premium veg Wednesday lunch with mushroom and soya rice',
    isActive: true
  },
  {
    dayOfWeek: 'wednesday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['DAL FRY', 'ROTI', 'KHEER'],
    description: 'Premium veg Wednesday dinner with dal fry',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Thursday
  {
    dayOfWeek: 'thursday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['VEGITABLE', 'DAL', 'RICE', 'ROTI', 'SALAD'],
    description: 'Premium veg Thursday lunch with mixed vegetables',
    isActive: true
  },
  {
    dayOfWeek: 'thursday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['MIX-VEG', 'DAL', 'FRIED RICE', 'ROTI', 'SALAD'],
    description: 'Premium veg Thursday dinner with fried rice',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Friday
  {
    dayOfWeek: 'friday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['PANEER MASALA', 'PLAIN PARATHA', 'HALWA'],
    description: 'Premium veg Friday lunch with paneer and paratha',
    isActive: true
  },
  {
    dayOfWeek: 'friday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['BESAN GATTA', 'JEERA RICE', 'ROTI', 'SALAD'],
    description: 'Premium veg Friday dinner with besan gatta',
    isActive: true
  },

  // PREMIUM-VEG PLAN - Saturday
  {
    dayOfWeek: 'saturday',
    mealType: 'lunch',
    planCategory: 'premium-veg',
    items: ['KHICHDI', 'AALOO CHOKHA', 'PICKLE'],
    description: 'Premium veg Saturday lunch with khichdi',
    isActive: true
  },
  {
    dayOfWeek: 'saturday',
    mealType: 'dinner',
    planCategory: 'premium-veg',
    items: ['CHHOLE MASALA', 'PURI', 'SWEETS'],
    description: 'Premium veg Saturday dinner with chhole and puri',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Sunday
  {
    dayOfWeek: 'sunday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['CHICKEN CURRY', 'JEERA RICE', 'ROTI', 'SALAD'],
    description: 'Premium non-veg Sunday lunch with chicken curry',
    isActive: true
  },
  {
    dayOfWeek: 'sunday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['CHICKEN BIRYANI', 'RAITA', 'SALAD'],
    description: 'Premium non-veg Sunday dinner with chicken biryani',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Monday
  {
    dayOfWeek: 'monday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['EGG CURRY', 'FRIED RICE', 'ROTI', 'KHEER'],
    description: 'Premium non-veg Monday lunch with egg curry',
    isActive: true
  },
  {
    dayOfWeek: 'monday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['TANDOORI CHICKEN', 'PARATHA', 'HALWA'],
    description: 'Premium non-veg Monday dinner with tandoori chicken',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Tuesday
  {
    dayOfWeek: 'tuesday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['CHICKEN MASALA', 'DAL', 'SOYA RICE', 'ROTI', 'SALAD'],
    description: 'Premium non-veg Tuesday lunch with chicken masala',
    isActive: true
  },
  {
    dayOfWeek: 'tuesday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['BUTTER CHICKEN', 'LACHHA PARATHA', 'SALAD'],
    description: 'Premium non-veg Tuesday dinner with butter chicken',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Wednesday
  {
    dayOfWeek: 'wednesday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['KEEMA', 'DAL', 'RICE', 'ROTI', 'SALAD'],
    description: 'Premium non-veg Wednesday lunch with keema',
    isActive: true
  },
  {
    dayOfWeek: 'wednesday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['MURADABADI BIRYANI', 'CHUTNEY', 'KHEER'],
    description: 'Premium non-veg Wednesday dinner with muradabadi biryani',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Thursday
  {
    dayOfWeek: 'thursday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['EGG AALOO DUM', 'RICE', 'ROTI', 'SALAD'],
    description: 'Premium non-veg Thursday lunch with egg aaloo dum',
    isActive: true
  },
  {
    dayOfWeek: 'thursday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['CHICKEN KORMA', 'LACHHA PARATHA', 'SALAD'],
    description: 'Premium non-veg Thursday dinner with chicken korma',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Friday
  {
    dayOfWeek: 'friday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['HYDRABADI BIRYANI', 'RAITA', 'HALWA'],
    description: 'Premium non-veg Friday lunch with hyderabadi biryani',
    isActive: true
  },
  {
    dayOfWeek: 'friday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['EGG BHURJI', 'DAL', 'JEERA RICE', 'ROTI', 'SALAD'],
    description: 'Premium non-veg Friday dinner with egg bhurji',
    isActive: true
  },

  // PREMIUM-NON-VEG PLAN - Saturday
  {
    dayOfWeek: 'saturday',
    mealType: 'lunch',
    planCategory: 'premium-non-veg',
    items: ['CHICKEN CURRY', 'DAL', 'RICE', 'ROTI', 'SALAD'],
    description: 'Premium non-veg Saturday lunch with chicken curry',
    isActive: true
  },
  {
    dayOfWeek: 'saturday',
    mealType: 'dinner',
    planCategory: 'premium-non-veg',
    items: ['BUTTER CHICKEN', 'SATTU PARATHA', 'SWEETS'],
    description: 'Premium non-veg Saturday dinner with butter chicken',
    isActive: true
  }
];

// Seed function
const seedWeeklyMenu = async () => {
  try {
    console.log('🌱 Starting WeeklyMenu seeding...');

    // Clear existing data
    await WeeklyMenu.deleteMany({});
    console.log('🗑️  Cleared existing WeeklyMenu data');

    // Insert new data
    const result = await WeeklyMenu.insertMany(weeklyMenuData);
    console.log(`✅ Successfully seeded ${result.length} WeeklyMenu documents`);

    // Verify the seeding
    const count = await WeeklyMenu.countDocuments();
    console.log(`📊 Total WeeklyMenu documents in database: ${count}`);

    // Show sample data
    const sample = await WeeklyMenu.findOne({ planCategory: 'classic', dayOfWeek: 'sunday' });
    console.log('📋 Sample document:', {
      dayOfWeek: sample.dayOfWeek,
      mealType: sample.mealType,
      planCategory: sample.planCategory,
      items: sample.items,
      isActive: sample.isActive
    });

    console.log('🎉 WeeklyMenu seeding completed successfully!');
    console.log('📝 You can now test GET /api/meals/weekly-menu');

  } catch (error) {
    console.error('❌ Error seeding WeeklyMenu:', error);
    throw error;
  }
};

// Run the seeder
const runSeeder = async () => {
  await connectDB();
  await seedWeeklyMenu();
  process.exit(0);
};

// Execute if run directly
if (require.main === module) {
  runSeeder();
}

module.exports = { seedWeeklyMenu };
