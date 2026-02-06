const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const folder = req.body.folder || 'general';
    const dir = path.join(uploadDir, folder);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Allow only images
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB default
  },
  fileFilter: fileFilter
});

// Export helper for single file upload
const uploadSingle = (fieldName) => upload.single(fieldName);

// ✅ DEDICATED PROFILE IMAGE UPLOAD (Fixed folder)
const profileImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(uploadDir, 'profiles');
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadProfileImage = multer({
  storage: profileImageStorage,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB for profile images
  },
  fileFilter: (req, file, cb) => {
    console.log('📸 Profile image fileFilter:');
    console.log('   Original name:', file.originalname);
    console.log('   MIME type:', file.mimetype);
    console.log('   Field name:', file.fieldname);
    
    // Accept only image mime types
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      console.log('   ✅ File accepted');
      cb(null, true);
    } else {
      console.log('   ❌ File rejected - invalid MIME type');
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

module.exports = upload;
module.exports.uploadSingle = uploadSingle;
module.exports.uploadProfileImage = uploadProfileImage;
