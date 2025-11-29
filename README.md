# TikTok Watch Indexer

A Chrome Extension (Manifest V3) that indexes videos you view on TikTok, capturing metadata and visual snapshots for local search. Built with privacy-first principles - all data stays on your device by default.

## Features

### MVP Features
- **Automatic Video Indexing**: Tracks videos you actually view (≥60% visible for 2+ seconds)
- **Metadata Extraction**: Captures author, caption, hashtags, and video URL
- **Frame Capture**: Captures 1-5 frames per video (configurable) using Canvas API
- **Keyword Search**: Full-text search over captions, hashtags, and author names
- **Visual Color Detection**: Detects dominant colors in frames for queries like "áo màu gì?"
- **Local-Only Storage**: All data stored in IndexedDB on your device

### Optional AI Features (Modular)
- Text embeddings for semantic search (on-device or cloud with API key)
- Enhanced vision analysis (requires opt-in)

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension directory

## Usage

### Basic Usage

1. **Browse TikTok**: Simply browse TikTok as normal. The extension automatically tracks videos you view.
2. **Search**: Click the extension icon to open the popup and search by keywords, hashtags, or author names.
3. **Color Queries**: Ask questions like "áo màu gì?" to get color information from captured frames.

### Settings

Access settings via:
- Right-click extension icon → Options
- Or navigate to `chrome://extensions/` → TikTok Watch Indexer → Options

**Frame Capture Settings:**
- Enable/disable frame capture
- Set max frames per video (1-20)
- Adjust capture interval (ms)
- Set WebP compression quality (0.1-1.0)

**AI Features:**
- Enable text embeddings (requires API key or on-device model)
- Enable vision analysis (requires opt-in)

**Data Management:**
- View statistics (videos indexed, frames captured)
- Clear all data
- Export data (coming soon)

## Technical Details

### Architecture

- **Manifest V3**: Uses service worker for background tasks
- **Content Script**: Runs on tiktok.com, tracks video visibility using IntersectionObserver
- **Background Service Worker**: Handles IndexedDB operations, indexing, and search
- **Popup**: Search UI with results display
- **Options Page**: Settings and data management

### Data Model

**IndexedDB Stores:**
- `videos`: Video metadata (id, url, author, caption, hashtags, viewedAt)
- `frames`: Frame snapshots (key, videoId, ts, blobData as ArrayBuffer)
- `invertedIndex`: Token-based search index (token, videoIds[])

### Privacy & Performance

- **Local-First**: All data stored locally in IndexedDB
- **No Background Scraping**: Only captures when tab is visible
- **Throttled Capture**: Frame capture throttled to prevent performance issues
- **Automatic Cleanup**: Old frames (>30 days) automatically purged
- **DB Quotas**: Enforces limits to prevent storage bloat

### Color Detection

Uses median cut algorithm for color quantization:
- Downsampled to 200px max dimension for performance
- Extracts top 5 dominant colors
- Maps to Vietnamese color names (đỏ, xanh, vàng, etc.)
- Returns color name, hex, RGB, and confidence

## Development

### File Structure

```
chrome-extension-tiktokhelp/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker (DB, indexing, search)
├── content.js             # Content script (tracking, capture)
├── popup.html/js          # Search UI
├── options.html/js        # Settings page
├── colorUtils.js          # Color detection utilities
└── README.md
```

### Key Components

**Content Script (`content.js`):**
- MutationObserver for new video cards
- IntersectionObserver for visibility tracking
- Canvas API for frame capture
- Throttled frame capture with viewport/tab visibility checks

**Background (`background.js`):**
- IndexedDB initialization and management
- Inverted index building and search
- Frame storage (ArrayBuffer conversion)
- Cleanup and quota management

**Color Utils (`colorUtils.js`):**
- Median cut color quantization
- Vietnamese color name mapping
- Frame blob processing

## Limitations & Known Issues

1. **TikTok DOM Changes**: Selectors may break if TikTok updates their UI. The extension uses multiple fallback selectors.
2. **Frame Capture**: Requires video element to be ready (readyState ≥ 2)
3. **Storage Limits**: IndexedDB has browser-specific quotas
4. **Color Detection**: Basic heuristic - may not be accurate for complex scenes

## Future Enhancements

- [ ] Export/import functionality
- [ ] On-device embeddings (Transformers.js)
- [ ] Enhanced vision detection (YOLO-Nano)
- [ ] Search filters (author, date range)
- [ ] Frame preview in search results
- [ ] Batch operations

## License

MIT License - See LICENSE file for details

## Privacy Policy

This extension:
- Stores all data locally on your device
- Never sends data to external servers (unless you opt-in to cloud AI features)
- Only captures videos you actually view
- Respects tab visibility (pauses when tab is hidden)
- Provides clear controls to disable features or clear data

## Contributing

Contributions welcome! Please open an issue or pull request.

## Support

For issues or questions, please open an issue on GitHub.

