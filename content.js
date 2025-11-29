// Content script for TikTok Watch Indexer
// Uses Share → Copy with proper event dispatch and DOM fallback

const CHECK_INTERVAL_MS = 3500;
const DEBUG = true;

let activeIntervalId = null;
let isRunning = false;
let isProcessing = false;
let lastAuthor = null;
let indexedVideoIds = new Set();
let interceptedUrl = null;
let activeCapture = { video: null, id: null, listener: null, lastTime: 0 };
const CAPTURE_INTERVAL = 5000;

function log(...a) { if (DEBUG) console.log("[TikTok Indexer]", ...a); }
function warn(...a) { console.warn("[TikTok Indexer]", ...a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========================================
// CLIPBOARD INTERCEPTION - Set up at load
// ========================================
const origWriteText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
if (origWriteText) {
  navigator.clipboard.writeText = async function(text) {
    if (text && text.includes('tiktok.com')) {
      interceptedUrl = text;
      log("Intercepted clipboard:", text);
    }
    try {
      return await origWriteText(text);
    } catch (e) {
      return Promise.resolve();
    }
  };
}

// ========================================
// CLICK HELPER - More reliable than .click()
// ========================================
function clickElement(el) {
  if (!el) return false;
  try {
    el.dispatchEvent(new MouseEvent("click", { 
      bubbles: true, 
      cancelable: true, 
      view: window 
    }));
    return true;
  } catch (e) {
    return false;
  }
}

// ========================================
// FRAME CAPTURE
// ========================================
async function onTimeUpdate() {
  const { video, id, lastTime } = activeCapture;
  if (!video || !id || video.paused || video.ended) return;

  const now = Date.now();
  if (now - lastTime < CAPTURE_INTERVAL) return;
  
  activeCapture.lastTime = now;
  await captureFrame(video, id);
}

async function captureFrame(video, videoId) {
  try {
    const canvas = document.createElement('canvas');
    // Scale down to save space (max height 360px)
    const scale = Math.min(1, 360 / video.videoHeight);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to WebP
    const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.6));
    const buffer = await blob.arrayBuffer();
    
    // Send to background
    // We need to serialize ArrayBuffer for messaging in some contexts, 
    // but standard chrome.runtime.sendMessage supports it.
    // However, to be safe against JSON serialization issues, we can pass it as is.
    // Background checks for ArrayBuffer.
    
    // Note: We pass array of bytes if direct ArrayBuffer fails in some browsers, 
    // but here we assume MV3 handles it or we might need to transfer ownership.
    // Let's try sending the buffer directly.
    
    await chrome.runtime.sendMessage({
      action: 'SAVE_FRAME',
      data: {
        key: `${videoId}:${Date.now()}`,
        videoId: videoId,
        ts: Date.now(),
        blob: JSON.parse(JSON.stringify(Array.from(new Uint8Array(buffer)))) // Serialize to array to be safe
      }
    });
    
    // log('Frame captured', videoId);
  } catch (e) {
    // warn('Frame capture failed', e);
  }
}

function updateCaptureState(video, videoId) {
  if (activeCapture.video === video && activeCapture.id === videoId) return;
  
  // Cleanup old
  if (activeCapture.video && activeCapture.listener) {
    activeCapture.video.removeEventListener('timeupdate', activeCapture.listener);
  }
  
  // Setup new
  activeCapture = {
    video,
    id: videoId,
    listener: onTimeUpdate,
    lastTime: 0
  };
  
  if (video) {
    video.addEventListener('timeupdate', onTimeUpdate);
  }
}

// ========================================
// VIDEO DETECTION
// ========================================
function findActiveVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return null;

  const vpH = window.innerHeight;
  const vpCenter = vpH / 2;
  let best = null, bestDist = Infinity;

  for (const v of videos) {
    const rect = v.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom < 0 || rect.top > vpH) continue;
    const dist = Math.abs(rect.top + rect.height / 2 - vpCenter);
    if (dist < bestDist) { bestDist = dist; best = v; }
  }
  return best;
}

function findArticle(videoEl) {
  if (!videoEl) return null;
  let el = videoEl;
  for (let i = 0; i < 25 && el && el !== document.body; i++) {
    if (el.tagName === 'ARTICLE') return el;
    el = el.parentElement;
  }
  return null;
}

// ========================================
// DOM EXTRACTION
// ========================================
function extractAuthor(c) {
  if (!c) return null;
  for (const link of c.querySelectorAll('a[href*="/@"]')) {
    const m = (link.getAttribute('href') || '').match(/\/@([a-zA-Z0-9_.]+)/);
    if (m && m[1].length > 1) return m[1];
  }
  return null;
}

function extractHashtags(c) {
  if (!c) return [];
  const tags = new Set();
  c.querySelectorAll('a[href*="/tag/"]').forEach(l => {
    const t = l.textContent.trim();
    if (t) tags.add(t.startsWith('#') ? t : '#' + t);
  });
  return Array.from(tags);
}

function extractCaption(c) {
  if (!c) return '';
  for (const el of c.querySelectorAll('span, div')) {
    const t = el.textContent.trim();
    if (t.length > 15 && t.length < 500 && t.includes('#')) return t;
  }
  return '';
}

// ========================================
// GET VIDEO URL - Share → Copy + DOM fallback
// ========================================
async function getVideoUrl(container) {
  interceptedUrl = null;

  try {
    // Find share button
    const shareButtons = Array.from(container.querySelectorAll(
      'button[aria-label*="Share" i], button[aria-label*="share" i], [data-e2e*="share"]'
    ));
    
    let shareBtn = shareButtons[0];
    if (!shareBtn) {
      // Try finding by aria-label pattern
      for (const btn of container.querySelectorAll('button')) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('share')) {
          shareBtn = btn;
          break;
        }
      }
    }

    if (!shareBtn) {
      warn('No share button');
      return findUrlFromDOM();
    }

    // Click share button
    log('Opening share...');
    clickElement(shareBtn);
    await sleep(600);

    // Find copy button - look for "Copy" text or data-e2e
    const copyCandidates = Array.from(document.querySelectorAll(
      '[data-e2e*="copy"], [data-e2e*="share-copy"], button, a, div[role="button"]'
    )).filter(el => {
      const t = (el.textContent || '').toLowerCase().trim();
      return t === 'copy' || t === 'copy link';
    });

    let copyBtn = copyCandidates[0];
    
    // Try finding in dialog
    if (!copyBtn) {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        for (const el of dialog.querySelectorAll('*')) {
          const t = el.textContent.trim().toLowerCase();
          if (t === 'copy' && el.children.length <= 1) {
            copyBtn = el;
            break;
          }
        }
      }
    }

    if (!copyBtn) {
      warn('No copy button');
      await closeDialog();
      return findUrlFromDOM();
    }

    // Click copy
    log('Clicking copy...');
    clickElement(copyBtn);
    await sleep(500);

    // Close dialog
    await closeDialog();

    // Check intercepted URL
    if (interceptedUrl) {
      log('Got URL from intercept:', interceptedUrl);
      return interceptedUrl;
    }

    // Try clipboard read
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.includes('tiktok.com')) {
        log('Got URL from clipboard:', text);
        return text;
      }
    } catch (e) {}

    // DOM fallback
    return findUrlFromDOM();

  } catch (e) {
    warn('Error:', e);
    await closeDialog();
    return findUrlFromDOM();
  }
}

// ========================================
// DOM FALLBACK - Extract URLs from page
// ========================================
function findUrlFromDOM() {
  log('Trying DOM fallback...');
  
  const urls = new Set();

  // Meta tags
  document.querySelectorAll('link[rel="canonical"], meta[property="og:url"], meta[name="twitter:url"]')
    .forEach(el => {
      const u = el.getAttribute('href') || el.getAttribute('content');
      if (u && u.includes('tiktok.com')) urls.add(u);
    });

  // Current URL if it's a video page
  if (location.href.includes('/video/')) {
    urls.add(location.href);
  }

  // Search HTML for TikTok video URLs
  const pattern = /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._-]+\/video\/\d+/g;
  const html = document.documentElement.innerHTML;
  const matches = html.match(pattern);
  if (matches) matches.forEach(u => urls.add(u));

  // Short links
  const shortPattern = /https?:\/\/(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+/g;
  const shortMatches = html.match(shortPattern);
  if (shortMatches) shortMatches.forEach(u => urls.add(u));

  if (urls.size > 0) {
    const url = Array.from(urls)[0];
    log('Found URL from DOM:', url);
    return url;
  }

  return null;
}

// ========================================
// CLOSE DIALOG
// ========================================
async function closeDialog() {
  await sleep(100);
  
  // Click close button
  const closeBtn = document.querySelector('[role="dialog"] button[aria-label*="close" i]');
  if (closeBtn) {
    clickElement(closeBtn);
    await sleep(200);
    return;
  }

  // Click backdrop
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog?.parentElement) {
    clickElement(dialog.parentElement);
    await sleep(200);
  }
}

// ========================================
// THUMBNAIL
// ========================================
async function getThumbnail(container, video) {
  if (video?.poster) {
    const data = await fetchImg(video.poster);
    if (data) return data;
  }
  if (container) {
    for (const img of container.querySelectorAll('img')) {
      if (img.src?.includes('tiktokcdn') && !img.src.includes('avatar')) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 80) {
          const data = await fetchImg(img.src);
          if (data) return data;
        }
      }
    }
  }
  return null;
}

async function fetchImg(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result);
      reader.onerror = () => r(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) { return null; }
}

// ========================================
// MAIN
// ========================================
async function checkVideo() {
  if (isProcessing) return;

  const video = findActiveVideo();
  if (!video) return;

  const container = findArticle(video);
  if (!container) return;

  const author = extractAuthor(container);
  if (!author) return;

  if (author === lastAuthor) return;

  log('New video:', author);
  lastAuthor = author;
  isProcessing = true;

  try {
    const url = await getVideoUrl(container);
    
    if (!url) {
      warn('No URL found');
      return;
    }

    // Extract video ID
    const match = url.match(/\/video\/(\d+)/);
    if (!match) {
      // Try short link format
      log('URL format:', url);
      // For short links, we'll use author + timestamp as ID
      const videoId = `${author}-${Date.now()}`;
      
      if (indexedVideoIds.has(author)) {
        log('Author already indexed recently');
        // Start capturing even if indexed
        updateCaptureState(video, videoId);
        return;
      }
      indexedVideoIds.add(author);

      log('=== INDEXED (short link) ===');
      updateCaptureState(video, videoId);
      await saveVideo(videoId, url, author, container);
      await saveThumbnail(videoId, url, container, video);
      return;
    }

    const videoId = match[1];

    if (indexedVideoIds.has(videoId)) {
      log('Already indexed:', videoId);
      // Start capturing even if indexed
      updateCaptureState(video, videoId);
      return;
    }

    indexedVideoIds.add(videoId);

    log('=== INDEXED ===');
    log('ID:', videoId);
    
    updateCaptureState(video, videoId);
    await saveVideo(videoId, url, author, container);
    await saveThumbnail(videoId, url, container, video);

  } catch (e) {
    warn('Error:', e);
  } finally {
    isProcessing = false;
  }
}

async function saveVideo(id, url, author, container) {
  try {
    const result = await chrome.runtime.sendMessage({
      action: 'SAVE_VIDEO',
      data: {
        id: id,
        url: url,
        author: author,
        caption: extractCaption(container),
        hashtags: extractHashtags(container),
        viewedAt: Date.now()
      }
    });
    log('Save:', result?.success ? 'OK' : 'FAILED');
  } catch (e) {
    warn('Save error:', e);
  }
}

async function saveThumbnail(id, url, container, video) {
  const thumb = await getThumbnail(container, video);
  if (thumb) {
    try {
      await chrome.runtime.sendMessage({
        action: 'SAVE_THUMBNAIL',
        data: {
          key: `${id}:thumb:${Date.now()}`,
          videoId: id,
          url: url,
          ts: Date.now(),
          videoTimeMs: 0,
          dataUrl: thumb,
          width: 320,
          height: 568
        }
      });
      log('Thumbnail: OK');
    } catch (e) {}
  }
}

// ========================================
// LIFECYCLE
// ========================================
function start() {
  if (isRunning) return;
  isRunning = true;
  log('Started');
  setTimeout(checkVideo, 2000);
  activeIntervalId = setInterval(checkVideo, CHECK_INTERVAL_MS);
}

function stop() {
  if (!isRunning) return;
  isRunning = false;
  if (activeIntervalId) clearInterval(activeIntervalId);
  activeIntervalId = null;
  log('Stopped');
}

async function init() {
  log('=== INIT ===');
  
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_ALL_VIDEOS', limit: 1000 });
    if (res?.success && res.videos) {
      res.videos.forEach(v => indexedVideoIds.add(v.id));
      log('Loaded', indexedVideoIds.size, 'videos');
    }
  } catch (e) {}

  start();

  document.addEventListener('visibilitychange', () => {
    document.hidden ? stop() : start();
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastAuthor = null;
    }
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.addEventListener('load', () => !isRunning && init());

window.__tiktokIndexer = {
  status: () => ({ running: isRunning, processing: isProcessing, lastAuthor, count: indexedVideoIds.size }),
  indexed: () => indexedVideoIds,
  intercepted: () => interceptedUrl,
  force: checkVideo,
  start, stop
};

log('Ready');
