const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const resources = path.join(root, 'resources');
fs.mkdirSync(resources, { recursive: true });

const macTarget = path.join(resources, 'ffmpeg-darwin-x64');
if (fs.existsSync(macTarget)) {
  console.log('macOS ffmpeg already present, keeping optimized binary:', macTarget);
} else {
  try {
    const macBinary = require('ffmpeg-static');
    if (macBinary && fs.existsSync(macBinary)) {
      fs.copyFileSync(macBinary, macTarget);
      fs.chmodSync(macTarget, 0o755);
      console.log('Copied macOS ffmpeg:', macTarget);
    }
  } catch (error) {
    console.warn('Could not copy ffmpeg-static binary:', error.message);
  }
}

const winBinary = path.join(resources, 'ffmpeg-win32-x64.exe');
if (!fs.existsSync(winBinary)) {
  console.warn('Windows ffmpeg not found. Download it into resources/ffmpeg-win32-x64.exe');
} else {
  console.log('Windows ffmpeg ready:', winBinary);
}
