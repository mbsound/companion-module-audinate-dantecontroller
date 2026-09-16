const { combineRgb } = require('@companion-module/base');

module.exports = {
	initPresets: function () {
		let self = this;

		let presets = [];

		const colorWhite = combineRgb(255, 255, 255);
		const colorBlack = combineRgb(0, 0, 0);
		const colorOrange = combineRgb(255, 128, 0);
		const colorGreen = combineRgb(0, 180, 0);
		const colorRed = combineRgb(200, 0, 0);
		const colorDarkGrey = combineRgb(30, 30, 30);
		const colorMidGrey = combineRgb(60, 60, 60);

		// General Router Controls
		presets.push({
			type: 'button',
			category: 'Router: Controls',
			name: 'Clear Selected Route',
			style: {
				text: 'CLEAR\nROUTE',
				size: '14',
				color: colorWhite,
				bgcolor: colorDarkGrey,
			},
			steps: [
				{
					down: [
						{
							actionId: 'clearSelectedDestination',
							options: {}
						}
					],
					up: []
				}
			],
			feedbacks: []
		});

		presets.push({
			type: 'button',
			category: 'Router: Controls',
			name: 'Refresh Network Devices',
			style: {
				text: 'REFRESH\nDANTE',
				size: '14',
				color: colorWhite,
				bgcolor: colorDarkGrey,
			},
			steps: [
				{
					down: [
						{
							actionId: 'refresh',
							options: {}
						}
					],
					up: []
				}
			],
			feedbacks: []
		});

		presets.push({
			type: 'button',
			category: 'Router: Controls',
			name: 'Clock Master & Status',
			style: {
				text: 'CLOCK MASTER\n$(dante:clock_grandmaster)\n$(dante:clock_status)',
				size: 'auto',
				color: colorWhite,
				bgcolor: colorDarkGrey,
			},
			steps: [
				{
					down: [
						{
							actionId: 'refresh',
							options: {}
						}
					],
					up: []
				}
			],
			feedbacks: [
				{
					feedbackId: 'clock_master_status',
					options: { condition: 'locked' },
					style: {
						bgcolor: colorGreen,
						color: colorWhite
					}
				},
				{
					feedbackId: 'clock_master_status',
					options: { condition: 'syncing' },
					style: {
						bgcolor: colorOrange,
						color: colorBlack
					}
				},
				{
					feedbackId: 'clock_master_status',
					options: { condition: 'lost_sync' },
					style: {
						bgcolor: colorRed,
						color: colorWhite
					}
				},
				{
					feedbackId: 'clock_master_status',
					options: { condition: 'multiple_masters' },
					style: {
						bgcolor: colorRed,
						color: colorWhite
					}
				}
			]
		});

		// Dynamic Destination Presets
		for (const [ip, device] of Object.entries(self.devicesData)) {
			if (!device?.rx) continue;
			const devName = device.name || ip;

			for (const [chNum, channel] of Object.entries(device.rx)) {
				const chLabel = channel.friendlyName || channel.name || `Rx ${chNum}`;
				const options = {
					destinationDevice: ip
				};
				options['destinationChannel_' + ip] = chNum;

				presets.push({
					type: 'button',
					category: `Destinations: ${devName}`,
					name: `${devName} - ${chLabel}`,
					style: {
						text: `DEST\\n${chLabel}\\n(${devName})`,
						size: 'auto',
						color: colorWhite,
						bgcolor: colorMidGrey,
					},
					steps: [
						{
							down: [
								{
									actionId: 'selectDestinationDropDown',
									options: options
								}
							],
							up: []
						}
					],
					feedbacks: [
						{
							feedbackId: 'selected_destination',
							options: options,
							style: {
								color: colorBlack,
								bgcolor: colorOrange,
							}
						},
						{
							feedbackId: 'subscription_status',
							options: {
								...options,
								condition: 'ok'
							},
							style: {
								color: colorWhite,
								bgcolor: combineRgb(0, 100, 0),
							}
						},
						{
							feedbackId: 'subscription_status',
							options: {
								...options,
								condition: 'error'
							},
							style: {
								color: colorWhite,
								bgcolor: colorRed,
							}
						}
					]
				});
			}
		}

		// Dynamic Source Presets
		for (const [ip, device] of Object.entries(self.devicesData)) {
			if (!device?.tx) continue;
			const devName = device.name || ip;

			for (const [chNum, channel] of Object.entries(device.tx)) {
				const chLabel = channel.friendlyName || channel.name || `Tx ${chNum}`;
				const options = {
					sourceDevice: ip
				};
				options['sourceChannel_' + ip] = chNum;

				presets.push({
					type: 'button',
					category: `Sources: ${devName}`,
					name: `${devName} - ${chLabel}`,
					style: {
						text: `SRC\\n${chLabel}\\n(${devName})`,
						size: 'auto',
						color: colorWhite,
						bgcolor: colorDarkGrey,
					},
					steps: [
						{
							down: [
								{
									actionId: 'routeSourceToSelectedDestinationDropDown',
									options: options
								}
							],
							up: []
						}
					],
					feedbacks: [
						{
							feedbackId: 'source_routed_to_selected_destination',
							options: options,
							style: {
								color: colorWhite,
								bgcolor: colorGreen,
							}
						}
					]
				});
			}
		}

		// Audio Metering Presets
		presets.push({
			type: 'button',
			category: 'Audio Metering',
			name: '1-Channel Audio Meter',
			style: {
				text: 'METER\nCH 1',
				size: '14',
				color: colorWhite,
				bgcolor: colorDarkGrey,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'metering_1ch',
					options: {
						device: self.devicesChoices?.[0]?.id || '',
						direction: 'rx',
						channelNumber: 1,
						displayMode: 'bar_text'
					}
				}
			]
		});

		presets.push({
			type: 'button',
			category: 'Audio Metering',
			name: '4-Channel Audio Meter Bridge (1-4)',
			style: {
				text: '',
				size: '9',
				color: colorWhite,
				bgcolor: colorDarkGrey,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'metering_4ch',
					options: {
						device: self.devicesChoices?.[0]?.id || '',
						direction: 'rx',
						channelBank: '1'
					}
				}
			]
		});

		self.setPresetDefinitions(presets);
	}
}
