// Background service worker for TikTok Watch Indexer
// Handles IndexedDB operations, indexing, and message routing

const DB_NAME = 'tiktokIndexer';
const DB_VERSION = 2; // Increment for new store
const STORES = {
  VIDEOS: 'videos',
  FRAMES: 'frames',
  THUMBNAILS: 'thumbnails',
  INVERTED_INDEX: 'invertedIndex'
};

let db = null;

// Initialize IndexedDB
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Videos store: { id, url, author, caption, hashtags[], viewedAt, textEmbedding? }
      if (!db.objectStoreNames.contains(STORES.VIDEOS)) {
        const videoStore = db.createObjectStore(STORES.VIDEOS, { keyPath: 'id' });
        videoStore.createIndex('viewedAt', 'viewedAt', { unique: false });
        videoStore.createIndex('author', 'author', { unique: false });
      }
      
      // Frames store: { key: `${videoId}:${ts}`, videoId, ts, blob(webp), imageEmbedding?, colorPalette? }
      if (!db.objectStoreNames.contains(STORES.FRAMES)) {
        const frameStore = db.createObjectStore(STORES.FRAMES, { keyPath: 'key' });
        frameStore.createIndex('videoId', 'videoId', { unique: false });
        frameStore.createIndex('ts', 'ts', { unique: false });
      }
      
      // Inverted index: { token, ids[] }
      if (!db.objectStoreNames.contains(STORES.INVERTED_INDEX)) {
        db.createObjectStore(STORES.INVERTED_INDEX, { keyPath: 'token' });
      }
      
      // Thumbnails store: { key: `${videoId}:${ts}`, videoId, url, ts, videoTimeMs, dataUrl, width, height }
      if (!db.objectStoreNames.contains(STORES.THUMBNAILS)) {
        const thumbStore = db.createObjectStore(STORES.THUMBNAILS, { keyPath: 'key' });
        thumbStore.createIndex('videoId', 'videoId', { unique: false });
        thumbStore.createIndex('url', 'url', { unique: false });
        thumbStore.createIndex('ts', 'ts', { unique: false });
      }
    };
  });
}

// Normalize text: lowercase, remove diacritics, tokenize
function normalizeText(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .split(/\s+/)
    .filter(token => token.length > 0);
}

// Tokenize and extract tokens from text
function extractTokens(text) {
  const normalized = normalizeText(text);
  const tokens = new Set();
  
  normalized.forEach(token => {
    // Add full token
    if (token.length >= 2) {
      tokens.add(token);
    }
    // Add substrings for partial matching (optional, can be disabled for performance)
    // for (let i = 2; i <= token.length; i++) {
    //   tokens.add(token.substring(0, i));
    // }
  });
  
  return Array.from(tokens);
}

// Update inverted index with tokens for a video
async function updateInvertedIndex(videoId, tokens) {
  const transaction = db.transaction([STORES.INVERTED_INDEX], 'readwrite');
  const store = transaction.objectStore(STORES.INVERTED_INDEX);
  
  for (const token of tokens) {
    const request = store.get(token);
    await new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const entry = request.result;
        if (entry) {
          if (!entry.ids.includes(videoId)) {
            entry.ids.push(videoId);
            store.put(entry);
          }
        } else {
          store.put({ token, ids: [videoId] });
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Save video metadata
async function saveVideo(videoData) {
  if (!db) await initDB();
  
  const transaction = db.transaction([STORES.VIDEOS, STORES.INVERTED_INDEX], 'readwrite');
  const videoStore = transaction.objectStore(STORES.VIDEOS);
  
  // Check if video already exists
  const existing = await new Promise((resolve, reject) => {
    const request = videoStore.get(videoData.id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (existing) {
    return { success: true, message: 'Video already indexed' };
  }
  
  // Save video
  await new Promise((resolve, reject) => {
    const request = videoStore.put(videoData);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  
  // Update inverted index
  const allText = [
    videoData.caption || '',
    ...(videoData.hashtags || []),
    videoData.author || ''
  ].join(' ');
  
  const tokens = extractTokens(allText);
  await updateInvertedIndex(videoData.id, tokens);
  
  // Update badge
  chrome.action.setBadgeText({ text: '●' });
  
  return { success: true, message: 'Video saved' };
}

// Helper to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Analyze image with Google Cloud Vision API
async function analyzeImageWithCloudVision(base64Data, apiKey) {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const body = {
    requests: [
      {
        image: { content: base64Data },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'TEXT_DETECTION' },
          { type: 'OBJECT_LOCALIZATION', maxResults: 10 }
        ]
      }
    ]
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      throw new Error(`Cloud Vision API error: ${response.statusText}`);
    }
    
    const data = await response.json();
    const result = data.responses[0];
    
    // Extract relevant data
    const labels = result.labelAnnotations?.map(l => l.description) || [];
    const text = result.fullTextAnnotation?.text || '';
    const objects = result.localizedObjectAnnotations?.map(o => o.name) || [];
    
    return { labels, text, objects };
  } catch (error) {
    console.error('Cloud Vision Analysis failed:', error);
    return null;
  }
}

// Save frame
async function saveFrame(frameData) {
  if (!db) await initDB();
  
  // Convert blob to ArrayBuffer for IndexedDB storage
  let blobData = null;
  if (frameData.blob) {
    try {
      // Handle both Blob objects and ArrayBuffers
      // Note: After chrome.runtime.sendMessage, ArrayBuffer might be a plain object
      if (frameData.blob instanceof Blob) {
        blobData = await frameData.blob.arrayBuffer();
      } else if (frameData.blob instanceof ArrayBuffer) {
        blobData = frameData.blob;
      } else if (frameData.blob.byteLength !== undefined) {
        // It's already an ArrayBuffer (might have been serialized)
        blobData = frameData.blob;
      } else if (Array.isArray(frameData.blob)) {
        // Convert array of numbers back to ArrayBuffer
        blobData = new Uint8Array(frameData.blob).buffer;
      } else {
        console.error('Invalid blob type:', typeof frameData.blob, frameData.blob);
        return { success: false, error: 'Invalid blob type' };
      }
    } catch (error) {
      console.error('Error converting blob to ArrayBuffer:', error);
      return { success: false, error: error.message };
    }
  }
  
  const frameToStore = {
    key: frameData.key,
    videoId: frameData.videoId,
    ts: frameData.ts,
    blobData: blobData, // Store as ArrayBuffer
    imageEmbedding: frameData.imageEmbedding,
    colorPalette: frameData.colorPalette
  };

  // Check if we should analyze with Cloud Vision
  try {
    const settings = await chrome.storage.sync.get(['enableAI', 'enableCloudVision', 'cloudVisionApiKey']);
    
    if (settings.enableAI && settings.enableCloudVision && settings.cloudVisionApiKey && blobData) {
      const base64 = arrayBufferToBase64(blobData);
      const analysis = await analyzeImageWithCloudVision(base64, settings.cloudVisionApiKey);
      
      if (analysis) {
        // Merge analysis into frameToStore
        frameToStore.analysis = analysis;
        
        // Add to search index
        const tokens = new Set();
        if (analysis.text) extractTokens(analysis.text).forEach(t => tokens.add(t));
        if (analysis.labels) analysis.labels.forEach(l => extractTokens(l).forEach(t => tokens.add(t)));
        if (analysis.objects) analysis.objects.forEach(o => extractTokens(o).forEach(t => tokens.add(t)));
        
        await updateInvertedIndex(frameData.videoId, Array.from(tokens));
      }
    }
  } catch (err) {
    console.error("Analysis error", err);
  }
  
  const transaction = db.transaction([STORES.FRAMES], 'readwrite');
  const store = transaction.objectStore(STORES.FRAMES);
  
  try {
    await new Promise((resolve, reject) => {
      const request = store.put(frameToStore);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return { success: true };
  } catch (error) {
    console.error('Error saving frame:', error);
    return { success: false, error: error.message };
  }
}

// Search videos by query
async function searchVideos(query) {
  if (!db) await initDB();
  
  const queryTokens = extractTokens(query);
  if (queryTokens.length === 0) {
    return [];
  }
  
  const transaction = db.transaction([STORES.INVERTED_INDEX, STORES.VIDEOS], 'readonly');
  const indexStore = transaction.objectStore(STORES.INVERTED_INDEX);
  const videoStore = transaction.objectStore(STORES.VIDEOS);
  
  // Collect video IDs from matching tokens
  const videoIdScores = new Map();
  
  for (const token of queryTokens) {
    const entry = await new Promise((resolve, reject) => {
      const request = indexStore.get(token);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (entry && entry.ids) {
      entry.ids.forEach(id => {
        videoIdScores.set(id, (videoIdScores.get(id) || 0) + 1);
      });
    }
  }
  
  // Sort by score (number of matching tokens)
  const sortedIds = Array.from(videoIdScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  
  // Fetch video data
  const videos = [];
  for (const id of sortedIds) {
    const video = await new Promise((resolve, reject) => {
      const request = videoStore.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (video) {
      videos.push(video);
    }
  }
  
  return videos;
}

// Get frame count for a video
async function getFrameCount(videoId) {
  if (!db) await initDB();
  
  const transaction = db.transaction([STORES.FRAMES], 'readonly');
  const store = transaction.objectStore(STORES.FRAMES);
  const index = store.index('videoId');
  
  return new Promise((resolve, reject) => {
    const request = index.count(videoId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Get frames for a video
async function getFramesForVideo(videoId, includeBlobs = true) {
  if (!db) await initDB();
  
  const transaction = db.transaction([STORES.FRAMES], 'readonly');
  const store = transaction.objectStore(STORES.FRAMES);
  const index = store.index('videoId');
  
  return new Promise((resolve, reject) => {
    const request = index.getAll(videoId);
    request.onsuccess = () => {
      let results = request.result || [];
      if (!includeBlobs) {
        results = results.map(f => {
          const { blobData, ...rest } = f;
          return rest;
        });
      }
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

// Get frame data (for popup to create blob)
async function getFrameData(frameKey) {
  if (!db) await initDB();
  
  const transaction = db.transaction([STORES.FRAMES], 'readonly');
  const store = transaction.objectStore(STORES.FRAMES);
  
  const frame = await new Promise((resolve, reject) => {
    const request = store.get(frameKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (frame && frame.blobData) {
    // Return as array of numbers for safe messaging
    return {
      blobData: Array.from(new Uint8Array(frame.blobData)),
      analysis: frame.analysis // Return analysis data too
    };
  }
  return null;
}

// Clear all data
async function clearAllData() {
  if (!db) await initDB();
  
  const stores = [STORES.VIDEOS, STORES.FRAMES, STORES.THUMBNAILS, STORES.INVERTED_INDEX];
  for (const storeName of stores) {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  chrome.action.setBadgeText({ text: '' });
  return { success: true };
}

// Get all videos (for "View All" feature)
async function getAllVideos(limit = 100) {
  if (!db) await initDB();
  
  const transaction = db.transaction([STORES.VIDEOS], 'readonly');
  const store = transaction.objectStore(STORES.VIDEOS);
  const index = store.index('viewedAt');
  
  return new Promise((resolve, reject) => {
    const videos = [];
    const request = index.openCursor(null, 'prev'); // Sort by newest first
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && videos.length < limit) {
        videos.push(cursor.value);
        cursor.continue();
      } else {
        resolve(videos);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Save thumbnail
async function saveThumbnail(thumbData) {
  if (!db) await initDB();
  
  const MAX_THUMBS_PER_VIDEO = 500; // Limit to prevent storage bloat
  
  // First, check how many thumbnails exist for this video
  const transaction = db.transaction([STORES.THUMBNAILS], 'readwrite');
  const store = transaction.objectStore(STORES.THUMBNAILS);
  const index = store.index('videoId');
  
  // Get existing thumbnails for this video
  const existing = await new Promise((resolve, reject) => {
    const request = index.getAll(thumbData.videoId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  
  // If we're at the limit, remove oldest
  if (existing.length >= MAX_THUMBS_PER_VIDEO) {
    // Sort by timestamp and remove oldest
    existing.sort((a, b) => a.ts - b.ts);
    const toRemove = existing.slice(0, existing.length - MAX_THUMBS_PER_VIDEO + 1);
    for (const item of toRemove) {
      await new Promise((resolve, reject) => {
        const request = store.delete(item.key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }
  
  // Save new thumbnail
  await new Promise((resolve, reject) => {
    const request = store.put(thumbData);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  
  return { success: true };
}

// Get thumbnails for a video
async function getThumbnailsForVideo(videoId) {
  if (!db) await initDB();
  
  const transaction = db.transaction([STORES.THUMBNAILS], 'readonly');
  const store = transaction.objectStore(STORES.THUMBNAILS);
  const index = store.index('videoId');
  
  return new Promise((resolve, reject) => {
    const request = index.getAll(videoId);
    request.onsuccess = () => {
      const thumbs = request.result || [];
      // Sort by timestamp (newest first)
      thumbs.sort((a, b) => b.ts - a.ts);
      resolve(thumbs);
    };
    request.onerror = () => reject(request.error);
  });
}

// Get stats
async function getStats() {
  if (!db) await initDB();
  
  const videoCount = await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.VIDEOS], 'readonly');
    const store = transaction.objectStore(STORES.VIDEOS);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  const frameCount = await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.FRAMES], 'readonly');
    const store = transaction.objectStore(STORES.FRAMES);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  const thumbCount = await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.THUMBNAILS], 'readonly');
    const store = transaction.objectStore(STORES.THUMBNAILS);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  return { videos: videoCount, frames: frameCount, thumbnails: thumbCount };
}

// Analyze frame on demand
async function analyzeSavedFrame(frameKey) {
  if (!db) await initDB();
  
  // Check settings first to provide accurate error message
  const settings = await chrome.storage.sync.get(['cloudVisionApiKey', 'enableAI']);
  if (!settings.cloudVisionApiKey) {
    return { success: false, error: 'Cloud Vision API key not configured' };
  }
  
  const transaction = db.transaction([STORES.FRAMES, STORES.INVERTED_INDEX], 'readwrite');
  const frameStore = transaction.objectStore(STORES.FRAMES);
  
  // Get frame
  const frame = await new Promise((resolve, reject) => {
    const request = frameStore.get(frameKey);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  if (!frame) {
    return { success: false, error: 'Frame not found' };
  }
  
  // Handle different blobData formats (for old frames that might be stored differently)
  let blobData = null;
  if (frame.blobData) {
    try {
      // Handle ArrayBuffer (most common case)
      if (frame.blobData instanceof ArrayBuffer) {
        blobData = frame.blobData;
      } 
      // Handle TypedArray views (Uint8Array, etc.)
      else if (frame.blobData.buffer instanceof ArrayBuffer) {
        blobData = frame.blobData.buffer;
      }
      // Handle array of numbers (old format or serialized)
      else if (Array.isArray(frame.blobData)) {
        blobData = new Uint8Array(frame.blobData).buffer;
      }
      // Handle objects with byteLength (serialized ArrayBuffer from messaging)
      else if (typeof frame.blobData === 'object' && frame.blobData.byteLength !== undefined) {
        // Try to reconstruct from array-like object
        if (Array.isArray(frame.blobData) || (frame.blobData.length !== undefined && typeof frame.blobData.length === 'number')) {
          blobData = new Uint8Array(frame.blobData).buffer;
        } else {
          // Last resort: try to convert object values to array
          const values = Object.values(frame.blobData).filter(v => typeof v === 'number');
          if (values.length > 0) {
            blobData = new Uint8Array(values).buffer;
          }
        }
      }
    } catch (error) {
      console.error('Error processing blobData:', error);
      return { success: false, error: 'Invalid frame data format' };
    }
  }
  
  if (!blobData) {
    return { success: false, error: 'Frame image data not available' };
  }
  
  try {
    const base64 = arrayBufferToBase64(blobData);
    const analysis = await analyzeImageWithCloudVision(base64, settings.cloudVisionApiKey);
    
    if (analysis) {
      // Update frame
      frame.analysis = analysis;
      
      await new Promise((resolve, reject) => {
        const request = frameStore.put(frame);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      // Update index
      const tokens = new Set();
      if (analysis.text) extractTokens(analysis.text).forEach(t => tokens.add(t));
      if (analysis.labels) analysis.labels.forEach(l => extractTokens(l).forEach(t => tokens.add(t)));
      if (analysis.objects) analysis.objects.forEach(o => extractTokens(o).forEach(t => tokens.add(t)));
      
      await updateInvertedIndex(frame.videoId, Array.from(tokens));
      
      return { success: true, analysis };
    } else {
      return { success: false, error: 'Analysis failed - API request returned no results' };
    }
  } catch (error) {
    console.error('Analysis failed:', error);
    // Provide more specific error messages
    if (error.message && error.message.includes('API key')) {
      return { success: false, error: 'Invalid API key or API error' };
    }
    return { success: false, error: error.message || 'Analysis failed' };
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'SAVE_VIDEO':
          const saveResult = await saveVideo(message.data);
          sendResponse(saveResult);
          break;
          
        case 'SAVE_FRAME':
          const frameResult = await saveFrame(message.data);
          sendResponse(frameResult);
          break;
          
        case 'ANALYZE_FRAME':
          const analyzeResult = await analyzeSavedFrame(message.frameKey);
          sendResponse(analyzeResult);
          break;
          
        case 'SEARCH':
          const videos = await searchVideos(message.query);
          sendResponse({ success: true, videos });
          break;
          
        case 'GET_FRAMES':
          const frames = await getFramesForVideo(message.videoId, message.includeBlobs);
          sendResponse({ success: true, frames });
          break;
          
        case 'GET_FRAME_COUNT':
          const count = await getFrameCount(message.videoId);
          sendResponse({ success: true, count });
          break;
          
        case 'GET_FRAME_DATA':
          const frameData = await getFrameData(message.frameKey);
          sendResponse({ success: true, frameData });
          break;
          
        case 'CLEAR_DATA':
          const clearResult = await clearAllData();
          sendResponse(clearResult);
          break;
          
        case 'GET_STATS':
          const stats = await getStats();
          sendResponse({ success: true, stats });
          break;
          
        case 'GET_ALL_VIDEOS':
          const allVideos = await getAllVideos(message.limit || 100);
          sendResponse({ success: true, videos: allVideos });
          break;
          
        case 'SAVE_THUMBNAIL':
          const thumbResult = await saveThumbnail(message.data);
          sendResponse(thumbResult);
          break;
          
        case 'GET_THUMBNAILS':
          const thumbs = await getThumbnailsForVideo(message.videoId);
          sendResponse({ success: true, thumbnails: thumbs });
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Cleanup old frames (older than 30 days)
async function cleanupOldFrames() {
  if (!db) await initDB();
  
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  // Cleanup frames
  const frameTransaction = db.transaction([STORES.FRAMES], 'readwrite');
  const frameStore = frameTransaction.objectStore(STORES.FRAMES);
  const frameIndex = frameStore.index('ts');
  
  const frameRange = IDBKeyRange.upperBound(thirtyDaysAgo);
  const frameRequest = frameIndex.openCursor(frameRange);
  
  await new Promise((resolve, reject) => {
    frameRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    frameRequest.onerror = () => reject(frameRequest.error);
  });
  
  // Cleanup thumbnails
  const thumbTransaction = db.transaction([STORES.THUMBNAILS], 'readwrite');
  const thumbStore = thumbTransaction.objectStore(STORES.THUMBNAILS);
  const thumbIndex = thumbStore.index('ts');
  
  const thumbRange = IDBKeyRange.upperBound(thirtyDaysAgo);
  const thumbRequest = thumbIndex.openCursor(thumbRange);
  
  await new Promise((resolve, reject) => {
    thumbRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    thumbRequest.onerror = () => reject(thumbRequest.error);
  });
}

// Check DB size and enforce quotas (basic implementation)
async function checkDBSize() {
  if (!db) await initDB();
  
  // Get approximate size (this is a simplified check)
  const frameCount = await new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.FRAMES], 'readonly');
    const store = transaction.objectStore(STORES.FRAMES);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  
  // If too many frames, clean up oldest
  const MAX_FRAMES = 10000;
  if (frameCount > MAX_FRAMES) {
    console.log('Frame count exceeds limit, cleaning up...');
    await cleanupOldFrames();
  }
}

// Initialize DB on startup
initDB().then(() => {
  // Run cleanup on startup
  cleanupOldFrames().catch(console.error);
  checkDBSize().catch(console.error);
}).catch(console.error);

// Periodic cleanup (every hour)
setInterval(() => {
  cleanupOldFrames().catch(console.error);
  checkDBSize().catch(console.error);
}, 60 * 60 * 1000);

