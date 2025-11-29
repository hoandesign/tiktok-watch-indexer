// Popup script for TikTok Watch Indexer

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsDiv = document.getElementById('results');
const statsDiv = document.getElementById('stats');

// Load stats and show all videos on popup open
loadStats();
viewAllVideos();

// Search on button click
searchBtn.addEventListener('click', performSearch);

// Search on Enter key
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// Load and display stats
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
    if (response.success) {
      statsDiv.innerHTML = `
        <span>📹 ${response.stats.videos} videos</span>
        <span>🖼️ ${response.stats.frames} frames</span>
        <span>📸 ${response.stats.thumbnails || 0} thumbs</span>
      `;
    }
  } catch (error) {
    console.error('Error loading stats:', error);
    statsDiv.innerHTML = '<span>Error loading stats</span>';
  }
}

// Perform search
async function performSearch() {
  const query = searchInput.value.trim();
  
  if (!query) {
    showEmptyState('Enter a search query');
    return;
  }
  
  showLoading();
  
  try {
    // Check if this is a color query
    const isColor = window.colorUtils && window.colorUtils.isColorQuery(query);
    
    const response = await chrome.runtime.sendMessage({
      action: 'SEARCH',
      query
    });
    
    if (response.success) {
      if (response.videos && response.videos.length > 0) {
        // If color query, enhance results with color detection
        if (isColor && window.colorUtils) {
          await displayResultsWithColors(response.videos);
        } else {
          displayResults(response.videos);
        }
      } else {
        showEmptyState('No videos found matching your query');
      }
    } else {
      showError(response.error || 'Search failed');
    }
  } catch (error) {
    console.error('Search error:', error);
    showError('Error performing search');
  }
}

// Display results with color detection for color queries
async function displayResultsWithColors(videos) {
  resultsDiv.innerHTML = '';
  
  // Process first few videos for color detection
  const videosToProcess = videos.slice(0, 5);
  
  for (const video of videosToProcess) {
    try {
      const frameBlob = await window.colorUtils.getRepresentativeFrame(video.id);
      if (frameBlob) {
        const colors = await window.colorUtils.detectColors(frameBlob, 3);
        video.detectedColors = colors;
      }
    } catch (error) {
      console.error('Error detecting colors for video:', error);
    }
  }
  
  // Display all results (reuse displayResults which now includes frame viewing)
  await displayResults(videos);
  
  // Add color info to existing items
  videos.forEach((video, index) => {
    const items = resultsDiv.querySelectorAll('.result-item');
    if (items[index] && video.detectedColors && video.detectedColors.length > 0) {
      const topColor = video.detectedColors[0];
      const colorInfo = document.createElement('div');
      colorInfo.className = 'result-colors';
      colorInfo.style.cssText = 'margin-top: 8px; font-size: 12px; color: #667eea;';
      colorInfo.innerHTML = `
        <strong>Màu chủ đạo:</strong> ${topColor.name} 
        <span style="display: inline-block; width: 16px; height: 16px; background: ${topColor.hex}; border: 1px solid #ddd; margin-left: 4px; vertical-align: middle;"></span>
      `;
      items[index].insertBefore(colorInfo, items[index].querySelector('.result-link'));
    }
  });
}

// Display search results
async function displayResults(videos) {
  resultsDiv.innerHTML = '';
  
  for (const video of videos) {
    const item = document.createElement('div');
    item.className = 'result-item';
    
    const hashtagsText = video.hashtags && video.hashtags.length > 0
      ? video.hashtags.join(' ')
      : '';
    
    // Get thumbnail for this video
    let thumbnailHtml = '';
    let hasThumbnail = false;
    try {
      const thumbResponse = await chrome.runtime.sendMessage({
        action: 'GET_THUMBNAILS',
        videoId: video.id
      });
      
      if (thumbResponse.success && thumbResponse.thumbnails && thumbResponse.thumbnails.length > 0) {
        // Use the most recent thumbnail
        const thumbnail = thumbResponse.thumbnails[0];
        if (thumbnail.dataUrl) {
          thumbnailHtml = `<div class="result-thumbnail">
            <img src="${thumbnail.dataUrl}" alt="Video thumbnail" loading="lazy">
          </div>`;
          hasThumbnail = true;
        }
      }
    } catch (error) {
      console.error('Error loading thumbnail:', error);
    }
    
    // Get frames count for this video
    let framesHtml = '';
    try {
      const countResponse = await chrome.runtime.sendMessage({
        action: 'GET_FRAME_COUNT',
        videoId: video.id
      });
      
      if (countResponse.success && countResponse.count > 0) {
        const frameCount = countResponse.count;
        framesHtml = `<div class="result-frames">
          📸 ${frameCount} frame${frameCount !== 1 ? 's' : ''} captured
          <button class="view-frames-btn" data-video-id="${video.id}">View</button>
        </div>`;
      }
    } catch (error) {
      console.error('Error loading frames count:', error);
    }
    
    // Format hashtags as individual tags
    let hashtagsHtml = '';
    if (video.hashtags && video.hashtags.length > 0) {
      hashtagsHtml = `<div class="result-hashtags">${video.hashtags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`;
    }
    
    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'result-content';
    if (!hasThumbnail) {
      contentWrapper.classList.add('no-thumbnail');
    }
    
    contentWrapper.innerHTML = `
      ${thumbnailHtml}
      <div class="result-text">
        <div class="result-author">${escapeHtml(video.author)}</div>
        <div class="result-caption">${escapeHtml(video.caption || 'No caption')}</div>
        ${hashtagsHtml}
        ${framesHtml}
        <a href="${video.url}" target="_blank" class="result-link">Open on TikTok →</a>
      </div>
    `;
    
    item.appendChild(contentWrapper);
    
    // Handle thumbnail image errors
    if (hasThumbnail) {
      const thumbnailImg = item.querySelector('.result-thumbnail img');
      if (thumbnailImg) {
        thumbnailImg.addEventListener('error', () => {
          // Hide thumbnail on error
          const thumbnailDiv = item.querySelector('.result-thumbnail');
          if (thumbnailDiv) {
            thumbnailDiv.style.display = 'none';
            contentWrapper.classList.add('no-thumbnail');
          }
        });
      }
    }
    
    // Add click handler for view frames button
    const viewFramesBtn = item.querySelector('.view-frames-btn');
    if (viewFramesBtn) {
      viewFramesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showFramesForVideo(video.id, video);
      });
    }
    
    item.addEventListener('click', (e) => {
      if (e.target.tagName !== 'A' && !e.target.classList.contains('view-frames-btn')) {
        window.open(video.url, '_blank');
      }
    });
    
    resultsDiv.appendChild(item);
  }
}

// Show frames for a video
async function showFramesForVideo(videoId, video) {
  try {
    const framesResponse = await chrome.runtime.sendMessage({
      action: 'GET_FRAMES',
      videoId: videoId,
      includeBlobs: false // Don't fetch heavy blobs yet
    });
    
    if (framesResponse.success && framesResponse.frames && framesResponse.frames.length > 0) {
      // Create modal/overlay to show frames
      const modal = document.createElement('div');
      modal.className = 'frames-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(15, 15, 15, 0.95);
        backdrop-filter: blur(10px);
        z-index: 10000;
        overflow-y: auto;
        padding: 24px;
      `;
      
      const content = document.createElement('div');
      content.style.cssText = `
        max-width: 1200px;
        margin: 0 auto;
        background: #1a1a1e;
        border: 1px solid #2a2a2e;
        border-radius: 16px;
        padding: 28px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      `;
      
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #2a2a2e;';
      header.innerHTML = `
        <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">Frames for @${escapeHtml(video.author)}</h2>
        <button class="close-frames" style="padding: 10px 20px; background: linear-gradient(135deg, #ff0050, #ff1a5c); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: transform 0.2s;">Close</button>
      `;
      
      const framesGrid = document.createElement('div');
      framesGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;';
      
      // Load and display each frame
      for (const frame of framesResponse.frames) {
        try {
          const dataResponse = await chrome.runtime.sendMessage({
            action: 'GET_FRAME_DATA',
            frameKey: frame.key
          });
          
          if (dataResponse.success && dataResponse.frameData) {
            const frameItem = document.createElement('div');
            frameItem.style.cssText = 'border: 1px solid #2a2a2e; border-radius: 12px; overflow: hidden; background: #161823; transition: all 0.2s;';
            frameItem.onmouseenter = () => {
              frameItem.style.borderColor = '#3a3a3e';
              frameItem.style.transform = 'translateY(-2px)';
              frameItem.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
            };
            frameItem.onmouseleave = () => {
              frameItem.style.borderColor = '#2a2a2e';
              frameItem.style.transform = 'translateY(0)';
              frameItem.style.boxShadow = 'none';
            };
            
            // Handle new data structure (object with blobData and analysis) or old (array)
            let blobData = dataResponse.frameData;
            let analysis = null;
            
            if (dataResponse.frameData.blobData) {
              blobData = dataResponse.frameData.blobData;
              analysis = dataResponse.frameData.analysis;
            }
            
            // Create Blob from array data
            const arrayBuffer = new Uint8Array(blobData).buffer;
            const blob = new Blob([arrayBuffer], { type: 'image/webp' });
            const blobUrl = URL.createObjectURL(blob);
            
            const img = document.createElement('img');
            img.src = blobUrl;
            img.style.cssText = 'width: 100%; height: auto; display: block;';
            img.alt = `Frame at ${new Date(frame.ts).toLocaleTimeString()}`;
            
            const info = document.createElement('div');
            info.style.cssText = 'padding: 12px; font-size: 12px; color: #a8a8b3; border-top: 1px solid #2a2a2e; background: #1f1f23;';
            
            let analysisHtml = '';
            if (analysis) {
              if (analysis.objects && analysis.objects.length > 0) {
                analysisHtml += `<div style="margin-top: 6px; color: #ffffff; font-weight: 600; font-size: 11px;">Objects:</div><div style="margin-top: 2px; color: #a8a8b3; font-size: 11px;">${escapeHtml(analysis.objects.join(', '))}</div>`;
              }
              if (analysis.labels && analysis.labels.length > 0) {
                // Show top 5 labels
                const topLabels = analysis.labels.slice(0, 5);
                analysisHtml += `<div style="margin-top: 6px; color: #ffffff; font-weight: 600; font-size: 11px;">Tags:</div><div style="margin-top: 2px; color: #a8a8b3; font-size: 11px;">${escapeHtml(topLabels.join(', '))}</div>`;
              }
              if (analysis.text) {
                // Truncate long text
                const text = analysis.text.length > 50 ? analysis.text.substring(0, 50) + '...' : analysis.text;
                analysisHtml += `<div style="margin-top: 6px; color: #00f2ea; font-style: italic; font-size: 11px;">"${escapeHtml(text)}"</div>`;
              }
            } else {
              // Add analyze button if no analysis exists
              analysisHtml += `
                <div class="analyze-actions" style="margin-top: 10px;">
                  <button class="analyze-btn" data-frame-key="${frame.key}" style="padding: 8px 12px; background: #1f1f23; border: 1.5px solid #2a2a2e; border-radius: 6px; cursor: pointer; width: 100%; color: #a8a8b3; font-size: 12px; font-weight: 500; transition: all 0.2s;">
                    🔍 Index with AI
                  </button>
                </div>
              `;
            }
            
            info.innerHTML = `
              <div style="margin-bottom: 8px; color: #71717a; font-size: 11px; font-weight: 500;">${new Date(frame.ts).toLocaleString()}</div>
              <div class="analysis-content">${analysisHtml}</div>
            `;
            
            // Add click handler for analyze button
            const analyzeBtn = info.querySelector('.analyze-btn');
            if (analyzeBtn) {
              analyzeBtn.addEventListener('mouseenter', () => {
                analyzeBtn.style.background = '#252529';
                analyzeBtn.style.borderColor = '#ff0050';
                analyzeBtn.style.color = '#ff0050';
              });
              analyzeBtn.addEventListener('mouseleave', () => {
                if (!analyzeBtn.disabled) {
                  analyzeBtn.style.background = '#1f1f23';
                  analyzeBtn.style.borderColor = '#2a2a2e';
                  analyzeBtn.style.color = '#a8a8b3';
                }
              });
              analyzeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const btn = e.target;
                btn.textContent = 'Indexing...';
                btn.disabled = true;
                
                try {
                  const response = await chrome.runtime.sendMessage({
                    action: 'ANALYZE_FRAME',
                    frameKey: frame.key
                  });
                  
                  if (response.success && response.analysis) {
                    // Update UI with results
                    const analysis = response.analysis;
                    let newHtml = '';
                    if (analysis.objects && analysis.objects.length > 0) {
                      newHtml += `<div style="margin-top: 6px; color: #ffffff; font-weight: 600; font-size: 11px;">Objects:</div><div style="margin-top: 2px; color: #a8a8b3; font-size: 11px;">${escapeHtml(analysis.objects.join(', '))}</div>`;
                    }
                    if (analysis.labels && analysis.labels.length > 0) {
                      const topLabels = analysis.labels.slice(0, 5);
                      newHtml += `<div style="margin-top: 6px; color: #ffffff; font-weight: 600; font-size: 11px;">Tags:</div><div style="margin-top: 2px; color: #a8a8b3; font-size: 11px;">${escapeHtml(topLabels.join(', '))}</div>`;
                    }
                    if (analysis.text) {
                      const text = analysis.text.length > 50 ? analysis.text.substring(0, 50) + '...' : analysis.text;
                      newHtml += `<div style="margin-top: 6px; color: #00f2ea; font-style: italic; font-size: 11px;">"${escapeHtml(text)}"</div>`;
                    }
                    info.querySelector('.analysis-content').innerHTML = newHtml;
                    btn.textContent = 'Indexed ✓';
                    btn.style.background = 'rgba(0, 242, 234, 0.1)';
                    btn.style.borderColor = 'rgba(0, 242, 234, 0.3)';
                    btn.style.color = '#00f2ea';
                    btn.disabled = true;
                  } else {
                    // Show specific error message
                    const errorMsg = response?.error || 'Unknown error';
                    let displayMsg = 'Failed';
                    if (errorMsg.includes('API key') || errorMsg.includes('not configured')) {
                      displayMsg = 'Failed (Check API Key)';
                    } else if (errorMsg.includes('not found') || errorMsg.includes('not available')) {
                      displayMsg = 'Failed (No Image Data)';
                    } else if (errorMsg.includes('Invalid')) {
                      displayMsg = 'Failed (Invalid Data)';
                    } else {
                      displayMsg = `Failed: ${errorMsg.substring(0, 30)}`;
                    }
                    btn.textContent = displayMsg;
                    btn.style.background = 'rgba(255, 0, 80, 0.1)';
                    btn.style.borderColor = 'rgba(255, 0, 80, 0.3)';
                    btn.style.color = '#ff0050';
                    btn.disabled = false;
                  }
                } catch (error) {
                  console.error('Analysis error:', error);
                  btn.textContent = 'Error';
                  btn.style.background = 'rgba(255, 0, 80, 0.1)';
                  btn.style.borderColor = 'rgba(255, 0, 80, 0.3)';
                  btn.style.color = '#ff0050';
                  btn.disabled = false;
                }
              });
            }
            
            frameItem.appendChild(img);
            frameItem.appendChild(info);
            framesGrid.appendChild(frameItem);
          } else {
            console.warn('No data for frame:', frame.key);
          }
        } catch (error) {
          console.error('Error loading frame:', error);
        }
      }
      
      content.appendChild(header);
      content.appendChild(framesGrid);
      modal.appendChild(content);
      document.body.appendChild(modal);
      
      // Close button handler
      const closeBtn = modal.querySelector('.close-frames');
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.transform = 'translateY(-1px)';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.transform = 'translateY(0)';
      });
      closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      // Close on background click
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
        }
      });
    } else {
      alert('No frames found for this video');
    }
  } catch (error) {
    console.error('Error showing frames:', error);
    alert('Error loading frames');
  }
}

// Show loading state
function showLoading() {
  resultsDiv.innerHTML = '<div class="loading">Searching</div>';
}

// Show empty state
function showEmptyState(message) {
  resultsDiv.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <h3>${escapeHtml(message)}</h3>
      <p>Try a different search query</p>
    </div>
  `;
}

// Show error
function showError(message) {
  resultsDiv.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

// View all videos
async function viewAllVideos() {
  showLoading();
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'GET_ALL_VIDEOS',
      limit: 100
    });
    
    if (response.success) {
      if (response.videos && response.videos.length > 0) {
        displayResults(response.videos);
      } else {
        showEmptyState('No videos indexed yet. Browse TikTok to start indexing!');
      }
    } else {
      showError(response.error || 'Failed to load videos');
    }
  } catch (error) {
    console.error('Error loading all videos:', error);
    showError('Error loading videos');
  }
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

