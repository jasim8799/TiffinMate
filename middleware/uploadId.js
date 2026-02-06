const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create ID documents directory if it doesn't exist
const uploadDir = './uploads/id-documents';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `id_${req.user._id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueSuffix);
  },
});

const fileFilter = (req, file, cb) => {
  console.log('🆔 ID Document fileFilter:');
  console.log('   Original name:', file.originalname);
  console.log('   MIME type:', file.mimetype);
  console.log('   Field name:', file.fieldname);
  
  const allowed =
    file.mimetype && (file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf');

  if (allowed) {
    console.log('   ✅ File accepted');
    cb(null, true);
  } else {
    console.log('   ❌ File rejected - invalid type');
    cb(new Error('Only image or PDF files allowed'), false);
  }
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});
