// Options page script for TikTok Watch Indexer

// Load current settings
loadSettings();
loadStats();

// Setup event listeners
document.getElementById('saveBtn').addEventListener('click', saveSettings);
document.getElementById('clearBtn').addEventListener('click', confirmClearData);
document.getElementById('exportBtn').addEventListener('click', exportData);
document.getElementById('enableFrameCapture').addEventListener('click', toggleSetting);
document.getElementById('enableAI').addEventListener('click', toggleSetting);
document.getElementById('enableCloudVision').addEventListener('click', toggleSetting);

// Show/hide API key input based on AI toggle
document.getElementById('enableAI').addEventListener('click', () => {
  const container = document.getElementById('aiSettingsContainer');
  const toggle = document.getElementById('enableAI');
  container.style.display = toggle.classList.contains('active') ? 'block' : 'none';
});

// Load settings from storage
async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    enableFrameCapture: true,
    frameCap: 5,
    frameInterval: 2500,
    webpQuality: 0.7,
    enableAI: false,
    geminiApiKey: '',
    cloudVisionApiKey: '',
    enableCloudVision: false
  });
  
  // Set toggle states
  setToggle('enableFrameCapture', settings.enableFrameCapture);
  setToggle('enableAI', settings.enableAI);
  setToggle('enableCloudVision', settings.enableCloudVision);
  
  // Set input values
  document.getElementById('frameCap').value = settings.frameCap;
  document.getElementById('frameInterval').value = settings.frameInterval;
  document.getElementById('webpQuality').value = settings.webpQuality;
  document.getElementById('geminiApiKey').value = settings.geminiApiKey || '';
  document.getElementById('cloudVisionApiKey').value = settings.cloudVisionApiKey || '';
  
  // Show/hide API key container
  document.getElementById('aiSettingsContainer').style.display = 
    settings.enableAI ? 'block' : 'none';
}

// Set toggle state
function setToggle(id, active) {
  const toggle = document.getElementById(id);
  if (active) {
    toggle.classList.add('active');
  } else {
    toggle.classList.remove('active');
  }
}

// Toggle setting
function toggleSetting(e) {
  const toggle = e.currentTarget;
  toggle.classList.toggle('active');
}

// Save settings
async function saveSettings() {
  const settings = {
    enableFrameCapture: document.getElementById('enableFrameCapture').classList.contains('active'),
    frameCap: parseInt(document.getElementById('frameCap').value) || 5,
    frameInterval: parseInt(document.getElementById('frameInterval').value) || 2500,
    webpQuality: parseFloat(document.getElementById('webpQuality').value) || 0.7,
    enableAI: document.getElementById('enableAI').classList.contains('active'),
    geminiApiKey: document.getElementById('geminiApiKey').value || '',
    cloudVisionApiKey: document.getElementById('cloudVisionApiKey').value || '',
    enableCloudVision: document.getElementById('enableCloudVision').classList.contains('active')
  };
  
  // Validate
  if (settings.frameCap < 1 || settings.frameCap > 20) {
    showStatus('Frame cap must be between 1 and 20', 'error');
    return;
  }
  
  if (settings.webpQuality < 0.1 || settings.webpQuality > 1.0) {
    showStatus('WebP quality must be between 0.1 and 1.0', 'error');
    return;
  }
  
  try {
    await chrome.storage.sync.set(settings);
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
}

// Load and display stats
async function loadStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATS' });
    if (response.success) {
      const statsDiv = document.getElementById('statsDisplay');
      statsDiv.innerHTML = `
        <div><strong>📹 Videos Indexed:</strong> ${response.stats.videos}</div>
        <div><strong>🖼️ Frames Captured:</strong> ${response.stats.frames}</div>
        <div><strong>📸 Thumbnails Captured:</strong> ${response.stats.thumbnails || 0}</div>
      `;
    }
  } catch (error) {
    console.error('Error loading stats:', error);
    document.getElementById('statsDisplay').innerHTML = 
      '<div>Error loading statistics</div>';
  }
}

// Confirm and clear data
function confirmClearData() {
  if (confirm('Are you sure you want to clear ALL indexed data?\n\nThis will delete:\n- All indexed videos\n- All captured frames\n- All thumbnails\n- All search indexes\n\nThis action cannot be undone.')) {
    clearData();
  }
}

// Clear all data
async function clearData() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'CLEAR_DATA' });
    if (response.success) {
      showStatus('All data cleared successfully', 'success');
      loadStats(); // Refresh stats
    } else {
      showStatus('Error clearing data', 'error');
    }
  } catch (error) {
    console.error('Error clearing data:', error);
    showStatus('Error clearing data', 'error');
  }
}

// Export data (basic implementation)
async function exportData() {
  try {
    // This would require reading all data from IndexedDB
    // For now, just show a message
    showStatus('Export feature coming soon. Data is stored locally in IndexedDB.', 'success');
  } catch (error) {
    console.error('Error exporting data:', error);
    showStatus('Error exporting data', 'error');
  }
}

// Show status message
function showStatus(message, type) {
  const statusDiv = document.getElementById('statusMessage');
  statusDiv.textContent = message;
  statusDiv.className = `status-message ${type}`;
  
  setTimeout(() => {
    statusDiv.className = 'status-message';
  }, 3000);
}

