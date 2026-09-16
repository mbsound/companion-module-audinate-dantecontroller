const { combineRgb } = require('@companion-module/base');
const { Regex } = require('@companion-module/base');
const { render1ChMeter, render4ChMeter, byteToDbfs } = require('./utils/meter-graphics');

module.exports = {
	initFeedbacks: function () {
		let self = this;
		let feedbacks = {};

		const foregroundColor = combineRgb(255, 255, 255) // White
		const backgroundColorRed = combineRgb(255, 0, 0) // Red
		
		
		feedbacks['routing_bg'] = {
			type: 'boolean',
			name: 'Change background color by destination',
			description: 'If the specified source channel specified is routed to the correct output, change background color of the button',
			defaultStyle: {
            color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 255, 0),
			},
			options: [
				{
					type: 'dropdown',
					label: 'Destination Device',
					id: 'destinationDevice',
					choices: self.devicesChoices
				}		
			],
			callback: (feedback) => {
				let opt = feedback.options;
				if (opt.destinationDevice && self.devicesData[opt.destinationDevice]?.rx && opt.sourceDevice) {
					const destChanId = opt['destinationChannel_' + opt.destinationDevice];
					let destinationChannel = self.devicesData[opt.destinationDevice].rx[destChanId] || self.findRxChannelByName(opt.destinationDevice, destChanId);
					const selectedSourceChannel = opt['sourceChannel_'+opt.sourceDevice];
					const sourceChannel = self.devicesData[opt.sourceDevice]?.tx?.[selectedSourceChannel] || self.findTxChannelByName(opt.sourceDevice, selectedSourceChannel);
					const normalizeName = (name) => String(name ?? '').trim().toLowerCase();
					const destinationSourceChannelName = normalizeName(destinationChannel?.sourceChannel);
					const sourceChannelCandidates = [selectedSourceChannel, self.getChannelSubscriptionName(sourceChannel), sourceChannel?.name, sourceChannel?.friendlyName]
						.filter(Boolean)
						.map((name) => normalizeName(name));
					if (sourceChannel?.number != undefined) {
						const number = parseInt(sourceChannel.number, 10);
						if (!isNaN(number)) {
							sourceChannelCandidates.push(String(number), String(number).padStart(2, '0'));
						}
					}
					const sourceChannelMatches = sourceChannelCandidates.includes(destinationSourceChannelName);
					const destinationSourceDeviceName = normalizeName(destinationChannel?.sourceDevice);
					const selectedSourceDeviceName = normalizeName(self.devicesData[opt.sourceDevice]?.name);
					const sourceDeviceMatches = destinationSourceDeviceName == selectedSourceDeviceName ||
						(destinationSourceDeviceName == '.' && opt.destinationDevice == opt.sourceDevice);
					const subscriptionOk = ([9, 10, 14].includes(destinationChannel?.subscriptionStatus));
					return sourceDeviceMatches && sourceChannelMatches && subscriptionOk;
				}	
			},
		}
		
		
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let nameOption = {
				type: 'dropdown',
				label: 'Destination channel',
				id: 'destinationChannel_'+ ip,
				choices: this.rxChannelsChoices[device.name],
				isVisibleData : ip,
				isVisible: (options, deviceIp) => { return (options.destinationDevice == deviceIp);}
			}
			feedbacks.routing_bg.options.push(nameOption);
		}
		
		feedbacks.routing_bg.options.push({
					type: 'dropdown',
					label: 'Source Device',
					id: 'sourceDevice',
					choices: this.devicesChoices
				})
	
		for (const [ip, device] of Object.entries(self.devicesData)) {
			let nameOption = {
				type: 'dropdown',
				label: 'Source channel',
				id: 'sourceChannel_'+ ip,
				choices: this.txChannelsChoices[device.name],
				isVisibleData : ip,
				isVisible: (options, deviceIp) => { return (options.sourceDevice == deviceIp);}
			}
			feedbacks.routing_bg.options.push(nameOption);
		}	
		
	feedbacks['routing_bg_manual'] = {
		type: 'boolean',
		name: 'Change background color by destination (manual)',
		description: 'If the specified source channel specified is routed to the correct output, change background color of the button',
		defaultStyle: {
           color: combineRgb(0, 0, 0),
			bgcolor: combineRgb(255, 255, 0),
		},
		options: [
			{
				type: 'textinput',
				label: 'Source Channel Name',
				id: 'sourceChannelName',
				default: 'Input 1',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Source Device Name',
				id: 'sourceDeviceName',
				default: 'MyDanteDeviceName',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Destination Channel',
				tooltip: 'Enter either channel name or channel number',
				id: 'destinationChannelId',
				default: '1',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Destination Device',
				tooltip: 'Enter either device name or device IP',
				id: 'destinationDeviceId',
				default: 'MyDanteDevice',
				useVariables: true
			},	
		],
		callback: async function (feedback, context) {
			const opt = feedback.options;
			const sourceChannelName = await context.parseVariablesInString(opt.sourceChannelName);
			const sourceDeviceName = await context.parseVariablesInString(opt.sourceDeviceName);
			const destinationChannelId = await context.parseVariablesInString(opt.destinationChannelId);
			const destinationDeviceId = await context.parseVariablesInString(opt.destinationDeviceId);

			// Check if destinationDeviceId is an IP or a name
			const IP = RegExp(Regex.IP.slice(1,-1));
			const destinationDeviceIp = IP.test(destinationDeviceId) ? destinationDeviceId : self.findDeviceIpByName(destinationDeviceId);
			
			if (destinationDeviceIp && sourceDeviceName && self.devicesData[destinationDeviceIp]?.rx) {
				const destinationChannel = self.findRxChannelByName(destinationDeviceIp, destinationChannelId) ?? self.devicesData[destinationDeviceIp].rx[destinationChannelId];
				if (destinationChannel == undefined) {
					return
				}
				
				const sourceChannel = self.findTxChannelByName(sourceDeviceName, sourceChannelName);
				const normalizeName = (name) => String(name ?? '').trim().toLowerCase();
				const destinationSourceChannelName = normalizeName(destinationChannel?.sourceChannel);
				const sourceChannelCandidates = [sourceChannelName, self.getChannelSubscriptionName(sourceChannel), sourceChannel?.name, sourceChannel?.friendlyName]
					.filter(Boolean)
					.map((name) => normalizeName(name));
				if (sourceChannel?.number != undefined) {
					const number = parseInt(sourceChannel.number, 10);
					if (!isNaN(number)) {
						sourceChannelCandidates.push(String(number), String(number).padStart(2, '0'));
					}
				}
				
				const sourceChannelMatches = sourceChannelCandidates.includes(destinationSourceChannelName);
				const destinationSourceDeviceName = normalizeName(destinationChannel?.sourceDevice);
				const selectedSourceDeviceName = normalizeName(sourceDeviceName);
				const sourceDeviceMatches = destinationSourceDeviceName == selectedSourceDeviceName ||
					(destinationSourceDeviceName == '.' && self.devicesData[destinationDeviceIp]?.name == sourceDeviceName);
				const subscriptionOk = ([9, 10, 14].includes(destinationChannel?.subscriptionStatus));
				return sourceDeviceMatches && sourceChannelMatches && subscriptionOk;
			}
		},
	};

	feedbacks['selected_destination'] = {
		type: 'boolean',
		name: 'Selected Destination (Router Matrix)',
		description: 'Indicates if this destination channel is currently selected as the routing target',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(255, 128, 0), // Orange
		},
		options: [
			{
				type: 'dropdown',
				label: 'Destination Device',
				id: 'destinationDevice',
				choices: self.devicesChoices
			}
		],
		callback: (feedback) => {
			if (!self.selectedDestination) return false;
			const opt = feedback.options;
			const targetChannel = opt['destinationChannel_' + opt.destinationDevice];
			const devMatch = (self.selectedDestination.device === opt.destinationDevice ||
				self.findDeviceIpByName(self.selectedDestination.device) === opt.destinationDevice ||
				self.devicesData[opt.destinationDevice]?.name === self.selectedDestination.device);
			const destIp = self.findDeviceIpByName(opt.destinationDevice) || opt.destinationDevice;
			const targetRx = self.devicesData[destIp]?.rx?.[targetChannel] || self.findRxChannelByName(destIp, targetChannel);
			const selRx = self.devicesData[destIp]?.rx?.[self.selectedDestination.channel] || self.findRxChannelByName(destIp, self.selectedDestination.channel);
			const chanMatch = String(self.selectedDestination.channel) === String(targetChannel) ||
				(Boolean(targetRx) && Boolean(selRx) && targetRx === selRx) ||
				(Boolean(targetRx) && (targetRx.name === self.selectedDestination.channel || targetRx.friendlyName === self.selectedDestination.channel));
			return devMatch && chanMatch;
		}
	};
	for (const [ip, device] of Object.entries(self.devicesData)) {
		feedbacks.selected_destination.options.push({
			type: 'dropdown',
			label: 'Destination channel',
			id: 'destinationChannel_' + ip,
			choices: self.rxChannelsChoices[device.name],
			isVisibleData: ip,
			isVisible: (options, deviceIp) => options.destinationDevice == deviceIp
		});
	}

	feedbacks['selected_destination_manual'] = {
		type: 'boolean',
		name: 'Selected Destination (Router Matrix - manual)',
		description: 'Indicates if this destination is currently selected using text/variables',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(255, 128, 0),
		},
		options: [
			{
				type: 'textinput',
				label: 'Destination Device',
				id: 'destinationDevice',
				default: '',
				useVariables: true
			},
			{
				type: 'textinput',
				label: 'Destination Channel',
				id: 'destinationChannel',
				default: '1',
				useVariables: true
			}
		],
		callback: async (feedback, context) => {
			if (!self.selectedDestination) return false;
			const dev = await context.parseVariablesInString(feedback.options.destinationDevice);
			const chan = await context.parseVariablesInString(feedback.options.destinationChannel);
			const devMatch = (self.selectedDestination.device === dev ||
				self.findDeviceIpByName(self.selectedDestination.device) === dev ||
				self.findDeviceIpByName(dev) === self.selectedDestination.device);
			const chanMatch = String(self.selectedDestination.channel) === String(chan);
			return devMatch && chanMatch;
		}
	};

	feedbacks['source_routed_to_selected_destination'] = {
		type: 'boolean',
		name: 'Source Routed to Selected Destination (Router Matrix)',
		description: 'Indicates if this source channel is currently routed to the selected destination',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 180, 0), // Green
		},
		options: [
			{
				type: 'dropdown',
				label: 'Source Device',
				id: 'sourceDevice',
				choices: self.devicesChoices
			}
		],
		callback: (feedback) => {
			if (!self.selectedDestination) return false;
			const opt = feedback.options;
			const selectedSourceChannel = opt['sourceChannel_' + opt.sourceDevice];
			
			const IP = RegExp(Regex.IP.slice(1, -1));
			const destIp = IP.test(self.selectedDestination.device) ? self.selectedDestination.device : self.findDeviceIpByName(self.selectedDestination.device);
			if (!destIp || !self.devicesData[destIp]?.rx) return false;

			const destChan = self.findRxChannelByName(destIp, self.selectedDestination.channel) ?? self.devicesData[destIp].rx[self.selectedDestination.channel];
			if (!destChan) return false;

			const sourceChannel = self.devicesData[opt.sourceDevice]?.tx?.[selectedSourceChannel] || self.findTxChannelByName(opt.sourceDevice, selectedSourceChannel);
			const normalizeName = (name) => String(name ?? '').trim().toLowerCase();
			const destinationSourceChannelName = normalizeName(destChan?.sourceChannel);
			const sourceChannelCandidates = [selectedSourceChannel, self.getChannelSubscriptionName(sourceChannel), sourceChannel?.name, sourceChannel?.friendlyName]
				.filter(Boolean)
				.map((name) => normalizeName(name));
			if (sourceChannel?.number != undefined) {
				const num = parseInt(sourceChannel.number, 10);
				if (!isNaN(num)) {
					sourceChannelCandidates.push(String(num), String(num).padStart(2, '0'));
				}
			}

			const sourceMatches = sourceChannelCandidates.includes(destinationSourceChannelName);
			const destDevName = normalizeName(destChan?.sourceDevice);
			const srcDevName = normalizeName(self.devicesData[opt.sourceDevice]?.name);
			const deviceMatches = destDevName === srcDevName || (destDevName === '.' && destIp === opt.sourceDevice);
			const subscriptionOk = ([9, 10, 14].includes(destChan?.subscriptionStatus));

			return deviceMatches && sourceMatches && subscriptionOk;
		}
	};
	for (const [ip, device] of Object.entries(self.devicesData)) {
		feedbacks.source_routed_to_selected_destination.options.push({
			type: 'dropdown',
			label: 'Source channel',
			id: 'sourceChannel_' + ip,
			choices: self.txChannelsChoices[device.name],
			isVisibleData: ip,
			isVisible: (options, deviceIp) => options.sourceDevice == deviceIp
		});
	}

	feedbacks['subscription_status'] = {
		type: 'boolean',
		name: 'Subscription Status / Diagnostics',
		description: 'Change button style based on Dante subscription health (Connected, Resolving, Fanout Limit Exceeded, Error)',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(200, 0, 0), // Red default for errors
		},
		options: [
			{
				type: 'dropdown',
				label: 'Destination Device',
				id: 'destinationDevice',
				choices: self.devicesChoices
			},
			{
				type: 'dropdown',
				label: 'Status Condition',
				id: 'condition',
				default: 'error',
				choices: [
					{ id: 'ok', label: 'Connected / OK (Unicast or Multicast)' },
					{ id: 'pending', label: 'In Progress / Resolving' },
					{ id: 'fanout_limit', label: 'Fanout Limit Reached (No Flows Left)' },
					{ id: 'clock_error', label: 'Clock Domain / Latency Mismatch' },
					{ id: 'format_error', label: 'Format / Rate Mismatch' },
					{ id: 'error', label: 'Any Error / Unresolved' }
				]
			}
		],
		callback: (feedback) => {
			const opt = feedback.options;
			const destChanId = opt['destinationChannel_' + opt.destinationDevice];
			const IP = RegExp(Regex.IP.slice(1, -1));
			const destIp = IP.test(opt.destinationDevice) ? opt.destinationDevice : self.findDeviceIpByName(opt.destinationDevice);
			if (!destIp || !self.devicesData[destIp]?.rx) return false;

			const destChan = self.findRxChannelByName(destIp, destChanId) ?? self.devicesData[destIp].rx[destChanId];
			if (!destChan) return false;

			const status = destChan.subscriptionStatus;
			if (status === undefined || status === 0) return false; // Not subscribed

			switch (opt.condition) {
				case 'ok':
					return [9, 10, 14].includes(status);
				case 'pending':
					return [1, 8].includes(status);
				case 'fanout_limit':
					return status === 37;
				case 'clock_error':
					return [26, 27].includes(status);
				case 'format_error':
					return [16, 17].includes(status);
				case 'error':
				default:
					return ![0, 9, 10, 14].includes(status);
			}
		}
	};
	for (const [ip, device] of Object.entries(self.devicesData)) {
		feedbacks.subscription_status.options.push({
			type: 'dropdown',
			label: 'Destination channel',
			id: 'destinationChannel_' + ip,
			choices: self.rxChannelsChoices[device.name],
			isVisibleData: ip,
			isVisible: (options, deviceIp) => options.destinationDevice == deviceIp
		});
	}

	feedbacks['clock_master_status'] = {
		type: 'boolean',
		name: 'Clock Master & Sync Status',
		description: 'Change button style based on Dante Grandmaster health and network clock lock state',
		defaultStyle: {
			color: combineRgb(255, 255, 255),
			bgcolor: combineRgb(0, 180, 0),
		},
		options: [
			{
				type: 'dropdown',
				label: 'Clock Condition',
				id: 'condition',
				default: 'locked',
				choices: [
					{ id: 'locked', label: 'Clock Locked / In Sync (Normal)' },
					{ id: 'syncing', label: 'Syncing / Acquiring' },
					{ id: 'lost_sync', label: 'Lost Sync / Clock Fault' },
					{ id: 'multiple_masters', label: 'Multiple Grandmasters Detected' },
					{ id: 'any_error', label: 'Any Error / Warning (Syncing, Lost Sync, Multiple Masters)' }
				]
			}
		],
		callback: (feedback) => {
			const state = self.clockMasterData?.state || 'unknown';
			switch (feedback.options.condition) {
				case 'locked':
					return state === 'locked';
				case 'syncing':
					return state === 'syncing';
				case 'lost_sync':
					return state === 'error';
				case 'multiple_masters':
					return state === 'multiple_masters';
				case 'any_error':
					return state === 'error' || state === 'multiple_masters' || state === 'syncing';
				default:
					return false;
			}
		}
	};

	feedbacks['metering_1ch'] = {
		type: 'advanced',
		name: 'Audio Meter (1-Channel)',
		description: 'Displays a live audio meter bar and numeric peak dBFS readout for a single Dante channel',
		options: [
			{
				type: 'dropdown',
				label: 'Device',
				id: 'device',
				choices: self.devicesChoices,
				default: self.devicesChoices?.[0]?.id || ''
			},
			{
				type: 'dropdown',
				label: 'Direction',
				id: 'direction',
				default: 'rx',
				choices: [
					{ id: 'rx', label: 'Receive (Rx / Inputs)' },
					{ id: 'tx', label: 'Transmit (Tx / Outputs)' }
				]
			},
			{
				type: 'number',
				label: 'Channel Number (1-512)',
				id: 'channelNumber',
				default: 1,
				min: 1,
				max: 512,
				step: 1
			},
			{
				type: 'dropdown',
				label: 'Display Mode',
				id: 'displayMode',
				default: 'bar_text',
				choices: [
					{ id: 'bar_text', label: 'Meter Bar + dB Readout' },
					{ id: 'bar_only', label: 'Meter Bar Only' },
					{ id: 'text_only', label: 'Numeric dB Readout Only' }
				]
			}
		],
		subscribe: (feedback) => {
			if (feedback.options?.device) {
				self.subscribeMetering?.(feedback.options.device);
			}
		},
		unsubscribe: (feedback) => {
			if (feedback.options?.device) {
				self.unsubscribeMetering?.(feedback.options.device);
			}
		},
		callback: (feedback) => {
			const opt = feedback.options;
			if (!opt?.device) return {};
			const dev = self.devicesData[opt.device];
			const direction = opt.direction || 'rx';
			const chNum = parseInt(opt.channelNumber, 10) || 1;

			const chData = dev?.metering?.[direction]?.[chNum];
			const peakByte = chData?.peak !== undefined ? chData.peak : 254;
			const peakHoldByte = chData?.peakHold !== undefined ? chData.peakHold : 254;

			const res = render1ChMeter({
				peakByte,
				peakHoldByte,
				displayMode: opt.displayMode
			});

			let channelName = '';
			if (dev) {
				const chanObj = dev[direction]?.[chNum] || dev[direction]?.[chNum - 1];
				channelName = chanObj?.friendlyName || chanObj?.name || `Ch ${chNum}`;
			} else {
				channelName = `Ch ${chNum}`;
			}

			let displayText = '';
			if (opt.displayMode !== 'bar_only') {
				displayText = `${channelName}\n${res.readoutText}`;
			}

			return {
				imageBuffer: res.imageBuffer,
				imageBufferEncoding: { pixelFormat: 'RGBA' },
				imageBufferPosition: { x: 0, y: 0, width: 72, height: 72 },
				text: displayText,
				size: 10,
				color: res.isClip ? combineRgb(255, 60, 60) : combineRgb(255, 255, 255),
				alignment: 'right:center'
			};
		}
	};

	feedbacks['metering_4ch'] = {
		type: 'advanced',
		name: 'Audio Meter Bridge (4-Channel)',
		description: 'Displays 4 side-by-side live audio meter bars on a single button',
		options: [
			{
				type: 'dropdown',
				label: 'Device',
				id: 'device',
				choices: self.devicesChoices,
				default: self.devicesChoices?.[0]?.id || ''
			},
			{
				type: 'dropdown',
				label: 'Direction',
				id: 'direction',
				default: 'rx',
				choices: [
					{ id: 'rx', label: 'Receive (Rx / Inputs)' },
					{ id: 'tx', label: 'Transmit (Tx / Outputs)' }
				]
			},
			{
				type: 'dropdown',
				label: 'Channel Bank',
				id: 'channelBank',
				default: '1',
				choices: [
					{ id: '1', label: 'Channels 1 - 4' },
					{ id: '5', label: 'Channels 5 - 8' },
					{ id: '9', label: 'Channels 9 - 12' },
					{ id: '13', label: 'Channels 13 - 16' },
					{ id: '17', label: 'Channels 17 - 20' },
					{ id: '21', label: 'Channels 21 - 24' },
					{ id: '25', label: 'Channels 25 - 28' },
					{ id: '29', label: 'Channels 29 - 32' },
					{ id: '33', label: 'Channels 33 - 36' },
					{ id: '37', label: 'Channels 37 - 40' },
					{ id: '41', label: 'Channels 41 - 44' },
					{ id: '45', label: 'Channels 45 - 48' },
					{ id: '49', label: 'Channels 49 - 52' },
					{ id: '53', label: 'Channels 53 - 56' },
					{ id: '57', label: 'Channels 57 - 60' },
					{ id: '61', label: 'Channels 61 - 64' }
				]
			}
		],
		subscribe: (feedback) => {
			if (feedback.options?.device) {
				self.subscribeMetering?.(feedback.options.device);
			}
		},
		unsubscribe: (feedback) => {
			if (feedback.options?.device) {
				self.unsubscribeMetering?.(feedback.options.device);
			}
		},
		callback: (feedback) => {
			const opt = feedback.options;
			if (!opt?.device) return {};
			const dev = self.devicesData[opt.device];
			const direction = opt.direction || 'rx';
			const startCh = parseInt(opt.channelBank, 10) || 1;

			const channelsData = [];
			for (let i = 0; i < 4; i++) {
				const chNum = startCh + i;
				const chData = dev?.metering?.[direction]?.[chNum];
				channelsData.push({
					peakByte: chData?.peak !== undefined ? chData.peak : 254,
					peakHoldByte: chData?.peakHold !== undefined ? chData.peakHold : 254
				});
			}

			const res = render4ChMeter(channelsData);
			const labelText = `${startCh}  ${startCh + 1}  ${startCh + 2}  ${startCh + 3}`;

			return {
				imageBuffer: res.imageBuffer,
				imageBufferEncoding: { pixelFormat: 'RGBA' },
				imageBufferPosition: { x: 0, y: 0, width: 72, height: 72 },
				text: labelText,
				size: 9,
				color: combineRgb(200, 200, 200),
				alignment: 'center:bottom'
			};
		}
	};

		self.setFeedbackDefinitions(feedbacks);
	}
}
