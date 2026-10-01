const { combineRgb } = require('@companion-module/base');
const { formatChannelRef, isRxConnected } = require('./route-monitor');

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
			id: 'router_clear_selected_route',
			type: 'simple',
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
			id: 'router_refresh_network_devices',
			type: 'simple',
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
			id: 'router_clock_master_status',
			type: 'simple',
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
					id: 'dest_' + ip.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + chNum,
					type: 'simple',
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
									actionId: 'selectDestination',
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
					id: 'src_' + ip.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + chNum,
					type: 'simple',
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
									actionId: 'routeSourceToSelectedDestination',
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
			id: 'metering_1ch',
			type: 'simple',
			category: 'Audio Metering',
			name: '1-Channel Audio Meter',
			style: {
				text: '',
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
			id: 'metering_4ch',
			type: 'simple',
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

		// Route Monitor: a master alarm, plus one ready-made monitor per live subscription
		const colorAmber = combineRgb(255, 170, 0);
		presets.push({
			id: 'route_monitor_master',
			category: 'Route Monitor',
			name: 'Master alarm (any monitored route down)',
			style: {
				text: `ROUTES\n$(${self.label}:route_monitor_status)`,
				size: 'auto',
				color: colorWhite,
				bgcolor: colorGreen,
			},
			steps: [],
			feedbacks: [
				{
					feedbackId: 'route_monitor_any_down',
					options: {},
					style: { bgcolor: colorRed, color: colorWhite },
				},
			],
		});

		const devicesByName = (name) => Object.values(self.devicesData).find((d) => d?.name === name);
		for (const device of Object.values(self.devicesData).sort((a, b) => String(a?.name).localeCompare(String(b?.name)))) {
			if (!device?.name || !device.rx) continue;
			for (const [num, channel] of Object.entries(device.rx)) {
				if (isNaN(num) || !channel?.sourceDevice || !channel?.sourceChannel || !isRxConnected(channel)) continue;
				const txName = channel.sourceDevice === '.' ? device.name : channel.sourceDevice;
				const txDevice = devicesByName(txName);
				const txChannel = txDevice
					? self.findTxChannelByName(Object.keys(self.devicesData).find((ip) => self.devicesData[ip] === txDevice), channel.sourceChannel)
					: null;
				const txNumber = txChannel?.number ?? (/^\d+$/.test(channel.sourceChannel) ? parseInt(channel.sourceChannel, 10) : null);
				if (!txNumber) continue;

				const routeOptions = {
					rxChannel: formatChannelRef(device.name, Number(num)),
					txChannel: formatChannelRef(txName, txNumber),
					graceSeconds: 3,
					checkSignal: false,
					silenceThreshold: -60,
					silenceSeconds: 10,
				};
				const rxLabel = channel.friendlyName || channel.name || `Ch ${num}`;
				presets.push({
					id: `route_monitor_${device.name}_${num}`.replace(/[^A-Za-z0-9_-]/g, '_'),
					category: `Route Monitor: ${device.name}`,
					name: `${rxLabel} <- ${txName} / ${channel.sourceChannel}`,
					style: {
						text: `${rxLabel}\n$(local:route)`,
						size: 'auto',
						color: colorWhite,
						bgcolor: colorDarkGrey,
					},
					steps: [],
					feedbacks: [
						{ feedbackId: 'route_monitor', options: { ...routeOptions, when: 'up' }, style: { bgcolor: colorGreen, color: colorWhite } },
						{ feedbackId: 'route_monitor', options: { ...routeOptions, when: 'checking' }, style: { bgcolor: colorAmber, color: colorBlack } },
						{ feedbackId: 'route_monitor', options: { ...routeOptions, when: 'down' }, style: { bgcolor: colorRed, color: colorWhite } },
					],
					localVariables: [
						{
							variableType: 'feedback',
							variableName: 'route',
							headline: 'Route status text',
							feedbackId: 'route_monitor_status',
							options: routeOptions,
						},
					],
				});
			}
		}

		const structure = [];
		const structureMap = {};
		const presetDefs = {};

		for (let i = 0; i < presets.length; i++) {
			const p = presets[i];
			const cat = p.category || 'General';
			const catId = cat.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
			if (!structureMap[catId]) {
				const section = {
					id: catId,
					name: cat,
					definitions: []
				};
				structureMap[catId] = section;
				structure.push(section);
			}
			const presetId = p.id || `preset_${catId}_${i}`;
			structureMap[catId].definitions.push(presetId);

			presetDefs[presetId] = {
				type: 'simple',
				name: p.name,
				style: p.style,
				steps: p.steps || [],
				feedbacks: p.feedbacks || [],
				...(p.localVariables ? { localVariables: p.localVariables } : {})
			};
		}

		self.setPresetDefinitions(structure, presetDefs);
	}
}
