/**
 * Dante Audio Meter Graphics Generator
 * Generates RGBA imageBuffer for 1-channel and 4-channel audio meters on Stream Deck keys (72x72)
 */

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

// Convert dBFS (-60 dBFS to 0 dBFS) to a normalized height percent (0.0 to 1.0) with audio meter curve
function dbfsToNormalized(dbfs) {
	if (!isFinite(dbfs) || dbfs <= -60) {
		return 0;
	}
	if (dbfs >= 0) {
		return 1.0;
	}
	// Perceptual audio scale:
	// -60 dB -> 0.0
	// -36 dB -> 0.25
	// -18 dB -> 0.55
	// -6 dB  -> 0.82
	//  0 dB  -> 1.0
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

// Fill a rectangle in RGBA buffer
function fillRect(buf, width, x, y, w, h, r, g, b, a = 255) {
	const height = buf.length / (width * 4);
	const xStart = Math.max(0, x);
	const xEnd = Math.min(width, x + w);
	const yStart = Math.max(0, y);
	const yEnd = Math.min(height, y + h);

	for (let py = yStart; py < yEnd; py++) {
		for (let px = xStart; px < xEnd; px++) {
			const idx = (py * width + px) * 4;
			buf[idx] = r;
			buf[idx + 1] = g;
			buf[idx + 2] = b;
			buf[idx + 3] = a;
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
 * Render a single segmented vertical meter bar
 */
function drawVerticalMeterBar(buf, width, x, y, barWidth, barHeight, normalizedVal, isClip, peakHoldNormalized = 0) {
	// Draw dark background track
	fillRect(buf, width, x, y, barWidth, barHeight, 22, 24, 28, 240);

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
			fillRect(buf, width, x + 1, segY, barWidth - 2, segmentHeight, r, g, b, 255);
		} else {
			// Dim inactive segment track
			fillRect(buf, width, x + 1, segY, barWidth - 2, segmentHeight, 35, 38, 44, 180);
		}
	}

	// Draw peak hold line if active and above current
	if (peakHoldNormalized > normalizedVal && peakHoldNormalized > 0.05) {
		const peakSeg = Math.min(numSegments - 1, Math.floor(peakHoldNormalized * numSegments));
		const peakY = y + barHeight - (peakSeg + 1) * totalSegHeight;
		const [pr, pg, pb] = getMeterSegmentColor(peakSeg / (numSegments - 1 || 1), isClip);
		fillRect(buf, width, x, peakY, barWidth, 2, pr, pg, pb, 255);
	}

	// Clip indicator block at the very top
	if (isClip) {
		fillRect(buf, width, x, y, barWidth, 4, 255, 0, 0, 255);
	}
}

/**
 * Render 1-Channel Audio Meter (72x72)
 */
function render1ChMeter(options = {}) {
	const width = options.width || 72;
	const height = options.height || 72;
	const buf = Buffer.alloc(width * height * 4); // RGBA

	// Background: dark charcoal
	fillRect(buf, width, 0, 0, width, height, 14, 15, 18, 255);

	const peakByte = options.peakByte !== undefined ? options.peakByte : 254;
	const isClip = peakByte === 0;
	const dbfs = byteToDbfs(peakByte);
	const normalized = dbfsToNormalized(dbfs);
	const peakHoldNormalized = dbfsToNormalized(byteToDbfs(options.peakHoldByte));

	const displayMode = options.displayMode || 'bar_text';

	if (displayMode === 'text_only') {
		return {
			imageBuffer: buf.toString('base64'),
			dbfs,
			isClip,
			readoutText: isClip ? 'CLIP' : (!isFinite(dbfs) ? 'MUTE' : `${dbfs.toFixed(1)} dB`)
		};
	}

	if (displayMode === 'bar_only') {
		const barWidth = 28;
		const barHeight = height - 10;
		const x = Math.floor((width - barWidth) / 2);
		const y = 5;
		drawVerticalMeterBar(buf, width, x, y, barWidth, barHeight, normalized, isClip, peakHoldNormalized);
		return {
			imageBuffer: buf.toString('base64'),
			dbfs,
			isClip,
			readoutText: ''
		};
	}

	// Default: bar_text (Bar on left, room for text on right)
	const barWidth = 18;
	const barHeight = height - 10;
	const barX = 8;
	const barY = 5;

	drawVerticalMeterBar(buf, width, barX, barY, barWidth, barHeight, normalized, isClip, peakHoldNormalized);

	let readoutText = '';
	if (isClip) {
		readoutText = 'CLIP';
	} else if (!isFinite(dbfs)) {
		readoutText = 'MUTE';
	} else {
		readoutText = `${Math.round(dbfs)} dB`;
	}

	return {
		imageBuffer: buf.toString('base64'),
		dbfs,
		isClip,
		readoutText
	};
}

/**
 * Render 4-Channel Audio Meter Bridge (72x72)
 */
function render4ChMeter(channels = [], options = {}) {
	const width = options.width || 72;
	const height = options.height || 72;
	const buf = Buffer.alloc(width * height * 4); // RGBA

	// Background: dark charcoal
	fillRect(buf, width, 0, 0, width, height, 14, 15, 18, 255);

	const barWidth = 12;
	const gap = 4;
	const totalWidth = (4 * barWidth) + (3 * gap); // 48 + 12 = 60
	const startX = Math.floor((width - totalWidth) / 2); // 6
	const barHeight = height - 12;
	const barY = 4;

	for (let i = 0; i < 4; i++) {
		const chData = channels[i] || {};
		const peakByte = chData.peakByte !== undefined ? chData.peakByte : 254;
		const isClip = peakByte === 0;
		const dbfs = byteToDbfs(peakByte);
		const normalized = dbfsToNormalized(dbfs);
		const peakHoldNorm = dbfsToNormalized(byteToDbfs(chData.peakHoldByte));

		const x = startX + i * (barWidth + gap);
		drawVerticalMeterBar(buf, width, x, barY, barWidth, barHeight, normalized, isClip, peakHoldNorm);
	}

	return {
		imageBuffer: buf.toString('base64')
	};
}

module.exports = {
	byteToDbfs,
	dbfsToNormalized,
	render1ChMeter,
	render4ChMeter
};
