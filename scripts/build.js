const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

try {
  // 1. Clean and create public directory
  console.log('Cleaning public directory...');
  if (fs.existsSync('public')) {
    fs.rmSync('public', { recursive: true, force: true });
  }
  fs.mkdirSync('public', { recursive: true });

  // 2. Copy captive portal files
  console.log('Copying captive portal files...');
  copyRecursiveSync('captive-portal', 'public');

  // 3. Install admin dependencies & Build React app
  console.log('Installing admin dependencies...');
  execSync('npm install', { cwd: 'admin', stdio: 'inherit' });

  console.log('Building React admin panel...');
  execSync('npm run build', { cwd: 'admin', stdio: 'inherit' });

  // 4. Copy admin build assets to public/admin
  console.log('Copying React build assets to public/admin...');
  copyRecursiveSync('admin/dist', 'public/admin');

  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
