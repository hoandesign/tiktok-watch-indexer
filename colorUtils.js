// Color detection utilities for visual queries
// Uses median cut algorithm for color quantization

// Vietnamese color name mapping
const COLOR_NAMES = {
  // Reds
  'đỏ': ['#FF0000', '#DC143C', '#B22222', '#8B0000', '#FF6347', '#FF4500'],
  'hồng': ['#FFC0CB', '#FF69B4', '#FF1493', '#FFB6C1', '#FFA07A'],
  'cam': ['#FFA500', '#FF8C00', '#FF7F50', '#FF6347'],
  // Yellows
  'vàng': ['#FFFF00', '#FFD700', '#FFA500', '#FFD700', '#FFE135'],
  'vàng nhạt': ['#FFFFE0', '#FFFACD', '#FFEFD5'],
  // Greens
  'xanh lá': ['#00FF00', '#32CD32', '#228B22', '#008000', '#00FF7F', '#00FA9A'],
  'xanh lá cây': ['#00FF00', '#32CD32', '#228B22', '#008000'],
  'xanh lục': ['#00FF00', '#32CD32', '#228B22', '#008000'],
  // Blues
  'xanh dương': ['#0000FF', '#4169E1', '#1E90FF', '#0000CD', '#0066CC'],
  'xanh': ['#0000FF', '#4169E1', '#1E90FF', '#0000CD', '#0066CC', '#00CED1', '#00BFFF'],
  'xanh nước biển': ['#0000FF', '#4169E1', '#1E90FF', '#0000CD'],
  'xanh da trời': ['#87CEEB', '#87CEFA', '#B0E0E6', '#ADD8E6'],
  // Purples
  'tím': ['#800080', '#9370DB', '#8B008B', '#9400D3', '#9932CC', '#BA55D3'],
  // Browns
  'nâu': ['#A52A2A', '#8B4513', '#654321', '#D2691E', '#CD853F'],
  // Grays/Blacks/Whites
  'đen': ['#000000', '#1C1C1C', '#2F2F2F', '#3D3D3D'],
  'trắng': ['#FFFFFF', '#F5F5F5', '#FAFAFA', '#F0F0F0'],
  'xám': ['#808080', '#A9A9A9', '#C0C0C0', '#D3D3D3', '#696969'],
  'grey': ['#808080', '#A9A9A9', '#C0C0C0', '#D3D3D3'],
  // Others
  'be': ['#F5F5DC', '#F5DEB3', '#DEB887'],
  'kem': ['#FFF8DC', '#FFE4B5', '#FFEBCD']
};

// Convert hex to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Convert RGB to hex
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// Calculate color distance (Euclidean in RGB space)
function colorDistance(rgb1, rgb2) {
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

// Find nearest color name
function findNearestColorName(rgb) {
  let minDistance = Infinity;
  let nearestName = null;
  
  for (const [name, hexColors] of Object.entries(COLOR_NAMES)) {
    for (const hex of hexColors) {
      const colorRgb = hexToRgb(hex);
      if (colorRgb) {
        const distance = colorDistance(rgb, colorRgb);
        if (distance < minDistance) {
          minDistance = distance;
          nearestName = name;
        }
      }
    }
  }
  
  return nearestName;
}

// Median cut algorithm for color quantization
function medianCut(pixels, numColors = 8) {
  if (pixels.length === 0) return [];
  
  // Start with all pixels in one box
  let boxes = [pixels];
  
  // Split boxes until we have enough colors
  while (boxes.length < numColors && boxes.length < pixels.length) {
    const newBoxes = [];
    
    for (const box of boxes) {
      if (box.length === 0) continue;
      
      // Find the color channel with the largest range
      let rMin = 255, rMax = 0;
      let gMin = 255, gMax = 0;
      let bMin = 255, bMax = 0;
      
      for (const pixel of box) {
        rMin = Math.min(rMin, pixel.r);
        rMax = Math.max(rMax, pixel.r);
        gMin = Math.min(gMin, pixel.g);
        gMax = Math.max(gMax, pixel.g);
        bMin = Math.min(bMin, pixel.b);
        bMax = Math.max(bMax, pixel.b);
      }
      
      const rRange = rMax - rMin;
      const gRange = gMax - gMin;
      const bRange = bMax - bMin;
      
      const maxRange = Math.max(rRange, gRange, bRange);
      
      if (maxRange === 0) {
        newBoxes.push(box);
        continue;
      }
      
      // Sort by the channel with the largest range
      let sortChannel = 'r';
      if (gRange === maxRange) sortChannel = 'g';
      else if (bRange === maxRange) sortChannel = 'b';
      
      box.sort((a, b) => a[sortChannel] - b[sortChannel]);
      
      // Split at median
      const median = Math.floor(box.length / 2);
      newBoxes.push(box.slice(0, median));
      newBoxes.push(box.slice(median));
    }
    
    boxes = newBoxes;
  }
  
  // Calculate average color for each box
  const colors = [];
  for (const box of boxes) {
    if (box.length === 0) continue;
    
    let rSum = 0, gSum = 0, bSum = 0;
    for (const pixel of box) {
      rSum += pixel.r;
      gSum += pixel.g;
      bSum += pixel.b;
    }
    
    const count = box.length;
    colors.push({
      r: Math.round(rSum / count),
      g: Math.round(gSum / count),
      b: Math.round(bSum / count),
      count
    });
  }
  
  // Sort by count (most dominant first)
  colors.sort((a, b) => b.count - a.count);
  
  return colors;
}

// Extract pixels from image blob
async function extractPixels(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Downsample for performance
      const maxSize = 200;
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = [];
      
      for (let i = 0; i < imageData.data.length; i += 4) {
        pixels.push({
          r: imageData.data[i],
          g: imageData.data[i + 1],
          b: imageData.data[i + 2],
          a: imageData.data[i + 3]
        });
      }
      
      resolve(pixels);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// Detect dominant colors from frame blob
async function detectColors(blob, numColors = 5) {
  try {
    const pixels = await extractPixels(blob);
    const dominantColors = medianCut(pixels, numColors);
    
    // Map to color names
    const colorResults = dominantColors.map(color => {
      const name = findNearestColorName(color);
      return {
        name,
        rgb: { r: color.r, g: color.g, b: color.b },
        hex: rgbToHex(color.r, color.g, color.b),
        confidence: Math.min(color.count / pixels.length, 1.0)
      };
    });
    
    return colorResults;
  } catch (error) {
    console.error('Error detecting colors:', error);
    return [];
  }
}

// Check if query contains color-related terms
function isColorQuery(query) {
  const colorTerms = ['màu', 'color', 'áo', 'quần', 'áo màu', 'màu gì', 'what color'];
  const lowerQuery = query.toLowerCase();
  return colorTerms.some(term => lowerQuery.includes(term));
}

// Get most representative frame for a video (middle frame or first)
async function getRepresentativeFrame(videoId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_FRAMES',
      videoId
    });
    
    if (response.success && response.frames && response.frames.length > 0) {
      // Return middle frame or first frame
      const frameIndex = Math.floor(response.frames.length / 2);
      const frame = response.frames[frameIndex] || response.frames[0];
      
      // Get blob URL
      const blobResponse = await chrome.runtime.sendMessage({
        action: 'GET_FRAME_BLOB',
        frameKey: frame.key
      });
      
      if (blobResponse.success && blobResponse.blobUrl) {
        // Fetch blob from URL
        const blob = await fetch(blobResponse.blobUrl).then(r => r.blob());
        return blob;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting representative frame:', error);
    return null;
  }
}

// Make functions available globally
window.colorUtils = {
  detectColors,
  isColorQuery,
  getRepresentativeFrame
};

