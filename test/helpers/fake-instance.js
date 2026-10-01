// A stand-in for Companion's InstanceBase: mixes in the module's methods exactly
// like index.js does and records what the module reports back to Companion.

const config = require('../../src/config')
const actions = require('../../src/actions')
const feedbacks = require('../../src/feedbacks')
const variables = require('../../src/variables')
const presets = require('../../src/presets')
const api = require('../../src/api')
const { RouteMonitor } = require('../../src/route-monitor')

function createInstance({ devices = {} } = {}) {
	const instance = {
		id: 'test',
		label: 'dante',
		logs: [],
		variableValues: {},
		definitions: {},
		feedbackInstances: [],
		devicesChoices: [],
		txChannelsChoices: {},
		rxChannelsChoices: {},
		devicesData: devices,
		lastSeenByName: {},
		routeMonitor: new RouteMonitor(),
		meteringSubscriptions: {},
		sockets: {},
		counter: Buffer.from('0001', 'hex'),
		mac: Buffer.from('a1b2c3d4e5f6', 'hex'),
		sent: [],

		log(level, message) {
			this.logs.push({ level, message })
		},
		updateStatus() {},
		setActionDefinitions(defs) {
			this.definitions.actions = defs
		},
		setFeedbackDefinitions(defs) {
			this.definitions.feedbacks = defs
		},
		setVariableDefinitions(defs) {
			this.definitions.variables = defs
		},
		setVariableValues(values) {
			Object.assign(this.variableValues, values)
		},
		setPresetDefinitions(structure, defs) {
			this.definitions.presets = { structure, defs }
		},
		checkFeedbacks(...ids) {
			for (const fb of this.feedbackInstances) if (ids.includes(fb.feedbackId)) this.runFeedback(fb)
		},
		checkAllFeedbacks() {
			for (const fb of this.feedbackInstances) this.runFeedback(fb)
		},
		sendCommand(command, host, service, port) {
			this.sent.push({ command, host, service, port })
		},

		/** Place a feedback on a "button" and evaluate it, as Companion would. */
		addFeedback(feedbackId, options, id = `fb${this.feedbackInstances.length + 1}`) {
			const fb = { id, feedbackId, options, value: undefined }
			this.feedbackInstances.push(fb)
			this.runFeedback(fb)
			return fb
		},
		removeFeedback(fb) {
			this.feedbackInstances = this.feedbackInstances.filter((f) => f !== fb)
			this.definitions.feedbacks[fb.feedbackId].unsubscribe?.(fb, {})
		},
		runFeedback(fb) {
			fb.value = this.definitions.feedbacks[fb.feedbackId].callback(fb, {})
			return fb.value
		},
	}

	const recordSend = instance.sendCommand
	Object.assign(instance, config, actions, feedbacks, variables, presets, api)
	instance.sendCommand = recordSend
	for (const [ip, dev] of Object.entries(devices)) {
		instance.devicesChoices.push({ id: ip, label: dev.name })
		dev.lastSeen ??= Date.now()
		instance.lastSeenByName[dev.name.toLowerCase()] = dev.lastSeen
	}
	instance.initFeedbacks()
	instance.initVariables()
	instance.initPresets()
	return instance
}

module.exports = { createInstance }
