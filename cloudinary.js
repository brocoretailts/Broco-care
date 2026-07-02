const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

const USE_CLOUDINARY = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

async function uploadBuffer(buffer, options = {}) {
  if (!USE_CLOUDINARY) return null;
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream({
      folder: 'broco-cms',
      resource_type: 'auto',
      ...options
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result.secure_url);
    });
    uploadStream.end(buffer);
  });
}

module.exports = { uploadBuffer, USE_CLOUDINARY };
