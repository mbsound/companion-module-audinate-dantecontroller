const { InstanceBase, InstanceStatus, Regex, runEntrypoint } = require('@companion-module/base')
const UpgradeScripts = require('./src/upgrades')

const config = require('./src/config')
const actions = require('./src/actions')
const feedbacks = require('./src/feedbacks')
const variables = require('./src/variables')
const presets = require('./src/presets')

const api = require('./src/api')

class danteInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		// Assign the methods from the listed files to this class
		Object.assign(this, {
			...config,
			...actions,
			...feedbacks,
			...variables,
			...presets,
			...api
		})


		this.INTERVAL = null; //used to poll the clock every second
		this.CONNECTED = false; //used for friendly notifying of the user that we have not received data yet

		this.devicesData = {};
		this.selectedDestination = null;
		this.clockMasterData = {
			masterName: 'Searching...',
			masterIp: 'None',
			masterUuid: 'None',
			status: 'Searching...',
			state: 'unknown'
		};
	}

	async destroy() {
		if (this.INTERVAL) {
			clearInterval(this.INTERVAL);
			this.INTERVAL = null;
		}
		if (this.METERING_INTERVAL) {
			clearInterval(this.METERING_INTERVAL);
			this.METERING_INTERVAL = null;
		}

		if (this.devicesData) {
			for (const dev of Object.values(this.devicesData)) {
				if (dev?.timeoutArray?.[0]) {
					clearTimeout(dev.timeoutArray[0]);
				}
			}
			this.devicesData = {};
		}
		
		if (this.sockets) {
			for (const socket of Object.values(this.sockets)) {
				try {
					socket.close();
				} catch (e) {}
			}
			this.sockets = {};
		}

		if (this.mdns) {
			try {
				this.mdns.destroy();
			} catch (e) {}
			this.mdns = null;
		}
	}

	async init(config) {
		this.configUpdated(config)//.catch((error) => {
//			this.log('error', 'Error initiating the module');
//		})
	}

	async configUpdated(config) {
		this.config = config

		if (this.config.verbose) {
			this.log('info', 'Verbose mode enabled. Log entries will contain detailed information.');
		}
	
		this.updateStatus(InstanceStatus.Connecting);

		this.initConnection();
		this.initActions();
		this.initFeedbacks();
		this.initVariables();
		this.initPresets();
	}
}

runEntrypoint(danteInstance, UpgradeScripts);