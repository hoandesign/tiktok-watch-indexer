// Popup script for TikTok Watch Indexer

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resultsDiv = document.getElementById('results');
const statsDiv = document.getElementById('stats');

// Load stats on popup open
loadStats();

// Search on button click
searchBtn.addEventListener('click', performSearch);

// Search on Enter key
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    performSearch();
  }
});

// View all videos
document.getElementById('viewAllBtn').addEventListener('click', viewAllVideos);

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
    
    // Get frames count for this video
    let framesHtml = '';
    try {
      const countResponse = await chrome.runtime.sendMessage({
        action: 'GET_FRAME_COUNT',
        videoId: video.id
      });
      
      if (countResponse.success && countResponse.count > 0) {
        const frameCount = countResponse.count;
        framesHtml = `<div class="result-frames" style="margin-top: 8px; font-size: 11px; color: #999;">
          📸 ${frameCount} frame${frameCount !== 1 ? 's' : ''} captured
          <button class="view-frames-btn" data-video-id="${video.id}" style="margin-left: 8px; padding: 2px 8px; background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 11px;">View</button>
        </div>`;
      }
    } catch (error) {
      console.error('Error loading frames count:', error);
    }
    
    item.innerHTML = `
      <div class="result-author">@${video.author}</div>
      <div class="result-caption">${escapeHtml(video.caption || 'No caption')}</div>
      ${hashtagsText ? `<div class="result-hashtags">${escapeHtml(hashtagsText)}</div>` : ''}
      ${framesHtml}
      <a href="${video.url}" target="_blank" class="result-link">Open on TikTok →</a>
    `;
    
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
        background: rgba(0,0,0,0.8);
        z-index: 10000;
        overflow-y: auto;
        padding: 20px;
      `;
      
      const content = document.createElement('div');
      content.style.cssText = `
        max-width: 1200px;
        margin: 0 auto;
        background: white;
        border-radius: 8px;
        padding: 20px;
      `;
      
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
      header.innerHTML = `
        <h2 style="margin: 0; font-size: 18px;">Frames for @${video.author}</h2>
        <button class="close-frames" style="padding: 8px 16px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      `;
      
      const framesGrid = document.createElement('div');
      framesGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;';
      
      // Load and display each frame
      for (const frame of framesResponse.frames) {
        try {
          const dataResponse = await chrome.runtime.sendMessage({
            action: 'GET_FRAME_DATA',
            frameKey: frame.key
          });
          
          if (dataResponse.success && dataResponse.frameData) {
            const frameItem = document.createElement('div');
            frameItem.style.cssText = 'border: 1px solid #ddd; border-radius: 4px; overflow: hidden; background: #f9f9f9;';
            
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
            info.style.cssText = 'padding: 8px; font-size: 11px; color: #666; border-top: 1px solid #eee;';
            
            let analysisHtml = '';
            if (analysis) {
              if (analysis.objects && analysis.objects.length > 0) {
                analysisHtml += `<div style="margin-top: 4px; color: #333;"><strong>Objects:</strong> ${analysis.objects.join(', ')}</div>`;
              }
              if (analysis.labels && analysis.labels.length > 0) {
                // Show top 5 labels
                const topLabels = analysis.labels.slice(0, 5);
                analysisHtml += `<div style="margin-top: 2px; color: #555;"><strong>Tags:</strong> ${topLabels.join(', ')}</div>`;
              }
              if (analysis.text) {
                // Truncate long text
                const text = analysis.text.length > 50 ? analysis.text.substring(0, 50) + '...' : analysis.text;
                analysisHtml += `<div style="margin-top: 2px; color: #555; font-style: italic;">"${text}"</div>`;
              }
            } else {
              // Add analyze button if no analysis exists
              analysisHtml += `
                <div class="analyze-actions" style="margin-top: 8px;">
                  <button class="analyze-btn" data-frame-key="${frame.key}" style="padding: 4px 8px; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; width: 100%;">
                    🔍 Index with AI
                  </button>
                </div>
              `;
            }
            
            info.innerHTML = `
              <div style="margin-bottom: 4px;">${new Date(frame.ts).toLocaleString()}</div>
              <div class="analysis-content">${analysisHtml}</div>
            `;
            
            // Add click handler for analyze button
            const analyzeBtn = info.querySelector('.analyze-btn');
            if (analyzeBtn) {
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
                      newHtml += `<div style="margin-top: 4px; color: #333;"><strong>Objects:</strong> ${analysis.objects.join(', ')}</div>`;
                    }
                    if (analysis.labels && analysis.labels.length > 0) {
                      const topLabels = analysis.labels.slice(0, 5);
                      newHtml += `<div style="margin-top: 2px; color: #555;"><strong>Tags:</strong> ${topLabels.join(', ')}</div>`;
                    }
                    if (analysis.text) {
                      const text = analysis.text.length > 50 ? analysis.text.substring(0, 50) + '...' : analysis.text;
                      newHtml += `<div style="margin-top: 2px; color: #555; font-style: italic;">"${text}"</div>`;
                    }
                    info.querySelector('.analysis-content').innerHTML = newHtml;
                  } else {
                    btn.textContent = 'Failed (Check API Key)';
                    btn.style.background = '#ffebee';
                    btn.disabled = false;
                  }
                } catch (error) {
                  console.error('Analysis error:', error);
                  btn.textContent = 'Error';
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
      modal.querySelector('.close-frames').addEventListener('click', () => {
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
  resultsDiv.innerHTML = '<div class="loading">Searching...</div>';
}

// Show empty state
function showEmptyState(message) {
  resultsDiv.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🔍</div>
      <div>${escapeHtml(message)}</div>
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

