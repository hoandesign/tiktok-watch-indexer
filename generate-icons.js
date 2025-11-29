// Simple Node.js script to generate extension icons
// Requires: npm install canvas (or use the HTML version instead)

const fs = require('fs');
const path = require('path');

// Check if canvas is available
let Canvas;
try {
  Canvas = require('canvas');
} catch (e) {
  console.log('Canvas module not found. Using HTML version instead.');
  console.log('Please open generate-icons.html in your browser to generate icons.');
  process.exit(0);
}

function generateIcon(size) {
  const canvas = Canvas.createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#667eea');
  gradient.addColorStop(1, '#764ba2');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  
  // Draw magnifying glass icon
  ctx.strokeStyle = 'white';
  ctx.fillStyle = 'white';
  ctx.lineWidth = Math.max(1, size / 16);
  
  // Circle (lens)
  const centerX = size * 0.4;
  const centerY = size * 0.4;
  const radius = size * 0.2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Handle
  const handleStartX = centerX + radius * 0.7;
  const handleStartY = centerY + radius * 0.7;
  const handleEndX = centerX + radius * 1.5;
  const handleEndY = centerY + radius * 1.5;
  ctx.beginPath();
  ctx.moveTo(handleStartX, handleStartY);
  ctx.lineTo(handleEndX, handleEndY);
  ctx.lineWidth = Math.max(1, size / 12);
  ctx.stroke();
  
  return canvas;
}

// Generate all three icon sizes
const sizes = [16, 48, 128];

console.log('Generating extension icons...');

sizes.forEach(size => {
  const canvas = generateIcon(size);
  const buffer = canvas.toBuffer('image/png');
  const filename = `icon${size}.png`;
  fs.writeFileSync(filename, buffer);
  console.log(`✓ Generated ${filename}`);
});

console.log('\nAll icons generated successfully!');
console.log('You can now add them back to manifest.json if desired.');

