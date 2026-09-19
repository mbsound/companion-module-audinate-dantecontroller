/**
 * Dante Audio Meter Graphics Generator
 * Generates both PNG data URLs and raw RGB pixel buffers for audio meters.
 *
 * Companion 5 layered buttons use `drawBase64Image` (requires PNG data URL in `png64`).
 * Companion standard buttons use `drawPixelBuffer` (requires raw RGB buffer in `imageBuffer`).
 */

const zlib = require('zlib');

// CRC-32 table for PNG chunk generation
const crcTable = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
		}
		t[n] = c;
	}
	return t;
})();

function crc32(buf) {
	let crc = 0xFFFFFFFF;
	for (let i = 0; i < buf.length; i++) {
		crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBytes = Buffer.from(type, 'ascii');
	const crcData = Buffer.concat([typeBytes, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(crcData), 0);
	return Buffer.concat([len, typeBytes, data, crc]);
}

/**
 * Encodes a raw RGB Buffer (3 bytes/pixel) into a minimal valid PNG data URL.
 */
function rgbToPngDataUrl(rgbBuffer, width, height) {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdrData = Buffer.alloc(13);
	ihdrData.writeUInt32BE(width, 0);
	ihdrData.writeUInt32BE(height, 4);
	ihdrData[8] = 8;  // 8-bit depth
	ihdrData[9] = 2;  // color type 2: RGB
	ihdrData[10] = 0; // compression
	ihdrData[11] = 0; // filter
	ihdrData[12] = 0; // interlace
	const ihdr = pngChunk('IHDR', ihdrData);

	// Prepend filter byte (0 = None) to each scanline
	const rawData = Buffer.alloc(height * (1 + width * 3));
	for (let row = 0; row < height; row++) {
		rawData[row * (1 + width * 3)] = 0;
		rgbBuffer.copy(rawData, row * (1 + width * 3) + 1, row * width * 3, (row + 1) * width * 3);
	}

	const compressed = zlib.deflateSync(rawData, { level: 1 });
	const idat = pngChunk('IDAT', compressed);
	const iend = pngChunk('IEND', Buffer.alloc(0));

	return 'data:image/png;base64,' + Buffer.concat([sig, ihdr, idat, iend]).toString('base64');
}

// Dante Byte to dBFS conversion
function byteToDbfs(byteVal) {
	if (byteVal === undefined || byteVal === null || byteVal >= 254) {
		return -Infinity;
	}
	if (byteVal === 0) {
		return 0.0; // Clip
	}
	if (byteVal === 1) {
		return 0.0;
	}
	if (byteVal <= 121) {
		return -(byteVal - 1) * 0.5;
	}
	if (byteVal <= 253) {
		return -60.0 - (byteVal - 121);
	}
	return -Infinity;
}

// Convert dBFS (-60 dBFS to 0 dBFS) to a normalized height percent (0.0 to 1.0)
function dbfsToNormalized(dbfs) {
	if (!isFinite(dbfs) || dbfs <= -60) {
		return 0;
	}
	if (dbfs >= 0) {
		return 1.0;
	}
	if (dbfs >= -6) {
		return 0.82 + (0.18 * ((dbfs + 6) / 6));
	}
	if (dbfs >= -18) {
		return 0.55 + (0.27 * ((dbfs + 18) / 12));
	}
	if (dbfs >= -36) {
		return 0.25 + (0.30 * ((dbfs + 36) / 18));
	}
	return 0.25 * ((dbfs + 60) / 24);
}

// Fill a rectangle in an RGB (3-byte-per-pixel) buffer
function fillRectRGB(buf, width, x, y, w, h, r, g, b) {
	const height = buf.length / (width * 3);
	const xStart = Math.max(0, x);
	const xEnd = Math.min(width, x + w);
	const yStart = Math.max(0, y);
	const yEnd = Math.min(height, y + h);

	for (let py = yStart; py < yEnd; py++) {
		for (let px = xStart; px < xEnd; px++) {
			const idx = (py * width + px) * 3;
			buf[idx] = r;
			buf[idx + 1] = g;
			buf[idx + 2] = b;
		}
	}
}

// Color lookup for meter height percent (0.0 to 1.0)
function getMeterSegmentColor(ratio, isOverload = false) {
	if (isOverload) {
		return [255, 20, 20]; // Bright Red Clip
	}
	if (ratio >= 0.85) {
		return [255, 50, 40]; // Red/Orange near 0 dBFS
	}
	if (ratio >= 0.70) {
		return [255, 175, 0]; // Amber/Yellow
	}
	if (ratio >= 0.50) {
		return [230, 220, 0]; // Yellow-Green
	}
	return [0, 210, 50]; // Green
}

/**
 * Render a single segmented vertical meter bar into an RGB buffer
 */
function drawVerticalMeterBarRGB(buf, width, x, y, barWidth, barHeight, normalizedVal, isClip, peakHoldNormalized = 0) {
	// Draw dark background track
	fillRectRGB(buf, width, x, y, barWidth, barHeight, 22, 24, 28);

	const segmentHeight = 3;
	const segmentGap = 1;
	const totalSegHeight = segmentHeight + segmentGap;
	const numSegments = Math.floor(barHeight / totalSegHeight);
	const filledSegments = Math.round(normalizedVal * numSegments);

	// Draw segments from bottom up
	for (let s = 0; s < numSegments; s++) {
		const segY = y + barHeight - (s + 1) * totalSegHeight;
		const segRatio = s / (numSegments - 1 || 1);
		const isFilled = s < filledSegments;

		if (isFilled) {
			const [r, g, b] = getMeterSegmentColor(segRatio, s === numSegments - 1 && isClip);
			fillRectRGB(buf, width, x + 1, segY, barWidth - 2, segmentHeight, r, g, b);
		} else {
			fillRectRGB(buf, width, x + 1, segY, barWidth - 2, segmentHeight, 35, 38, 44);
		}
	}

	// Peak hold line
	if (peakHoldNormalized > normalizedVal && peakHoldNormalized > 0.05) {
		const peakSeg = Math.min(numSegments - 1, Math.floor(peakHoldNormalized * numSegments));
		const peakY = y + barHeight - (peakSeg + 1) * totalSegHeight;
		const [pr, pg, pb] = getMeterSegmentColor(peakSeg / (numSegments - 1 || 1), isClip);
		fillRectRGB(buf, width, x, peakY, barWidth, 2, pr, pg, pb);
	}

	// Clip indicator at the very top
	if (isClip) {
		fillRectRGB(buf, width, x, y, barWidth, 4, 255, 0, 0);
	}
}

/**
 * Render 1-Channel Audio Meter.
 *
 * Returns an object with:
 *   png64            – valid PNG data URL (for layered button image layers)
 *   imageBuffer      – raw RGB buffer, base64-encoded (72 × 58 × 3 = 12528 bytes, for legacy drawPixelBuffer)
 *   imageBufferEncoding – { pixelFormat: 'RGB' }
 *   imageBufferPosition – { x: 0, y: 0, width: 72, height: 58 }
 *   dbfs, isClip, readoutText
 */
function render1ChMeter(options = {}) {
	const width = 72;
	const height = 58;
	const buf = Buffer.alloc(width * height * 3);
	fillRectRGB(buf, width, 0, 0, width, height, 14, 15, 18);

	const peakByte = options.peakByte !== undefined ? options.peakByte : 254;
	const isClip = peakByte === 0;
	const dbfs = byteToDbfs(peakByte);
	const normalized = dbfsToNormalized(dbfs);
	const peakHoldNormalized = dbfsToNormalized(byteToDbfs(options.peakHoldByte));

	const displayMode = options.displayMode || 'bar_text';

	let readoutText = '';
	if (isClip) {
		readoutText = 'CLIP';
	} else if (!isFinite(dbfs)) {
		readoutText = 'MUTE';
	} else {
		readoutText = `${Math.round(dbfs)} dB`;
	}

	if (displayMode === 'text_only') {
		const png64 = rgbToPngDataUrl(buf, width, height);
		return {
			png64,
			imageBuffer: buf.toString('base64'),
			imageBufferEncoding: { pixelFormat: 'RGB' },
			imageBufferPosition: { x: 0, y: 0, width, height },
			dbfs,
			isClip,
			readoutText: isClip ? 'CLIP' : (!isFinite(dbfs) ? 'MUTE' : `${dbfs.toFixed(1)} dB`)
		};
	}

	if (displayMode === 'bar_only') {
		const barWidth = 28;
		const barHeight = height - 6;
		const x = Math.floor((width - barWidth) / 2);
		const y = 3;
		drawVerticalMeterBarRGB(buf, width, x, y, barWidth, barHeight, normalized, isClip, peakHoldNormalized);
		const png64 = rgbToPngDataUrl(buf, width, height);
		return {
			png64,
			imageBuffer: buf.toString('base64'),
			imageBufferEncoding: { pixelFormat: 'RGB' },
			imageBufferPosition: { x: 0, y: 0, width, height },
			dbfs,
			isClip,
			readoutText: ''
		};
	}

	// Default: bar_text
	const barWidth = 18;
	const barHeight = height - 6;
	const barX = 4;
	const barY = 3;
	drawVerticalMeterBarRGB(buf, width, barX, barY, barWidth, barHeight, normalized, isClip, peakHoldNormalized);
	const png64 = rgbToPngDataUrl(buf, width, height);

	return {
		png64,
		imageBuffer: buf.toString('base64'),
		imageBufferEncoding: { pixelFormat: 'RGB' },
		imageBufferPosition: { x: 0, y: 0, width, height },
		dbfs,
		isClip,
		readoutText
	};
}

/**
 * Render 4-Channel Audio Meter Bridge.
 */
function render4ChMeter(channels = [], options = {}) {
	const width = 72;
	const height = 58;
	const buf = Buffer.alloc(width * height * 3);
	fillRectRGB(buf, width, 0, 0, width, height, 14, 15, 18);

	const barWidth = 12;
	const gap = 4;
	const totalWidth = (4 * barWidth) + (3 * gap); // 60px
	const startX = Math.floor((width - totalWidth) / 2);
	const barHeight = height - 8;
	const barY = 4;

	for (let i = 0; i < 4; i++) {
		const chData = channels[i] || {};
		const peakByte = chData.peakByte !== undefined ? chData.peakByte : 254;
		const isClip = peakByte === 0;
		const dbfs = byteToDbfs(peakByte);
		const normalized = dbfsToNormalized(dbfs);
		const peakHoldNorm = dbfsToNormalized(byteToDbfs(chData.peakHoldByte));
		const x = startX + i * (barWidth + gap);
		drawVerticalMeterBarRGB(buf, width, x, barY, barWidth, barHeight, normalized, isClip, peakHoldNorm);
	}

	const png64 = rgbToPngDataUrl(buf, width, height);

	return {
		png64,
		imageBuffer: buf.toString('base64'),
		imageBufferEncoding: { pixelFormat: 'RGB' },
		imageBufferPosition: { x: 0, y: 0, width, height }
	};
}

module.exports = {
	byteToDbfs,
	dbfsToNormalized,
	render1ChMeter,
	render4ChMeter
};
