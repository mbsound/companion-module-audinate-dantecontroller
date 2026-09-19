module.exports = [
	function (context, props) {
		// This is a placeholder that cannot be removed
		return {
			updatedConfig: null,
			updatedActions: [],
			updatedFeedbacks: [],
		}
	},
	function (context, props) {
		const actionMap = {
			makeCrosspointDropDown: 'makeCrosspoint',
			clearCrosspointDropDown: 'clearCrosspoint',
			selectDestinationDropDown: 'selectDestination',
			routeSourceToSelectedDestinationDropDown: 'routeSourceToSelectedDestination',
			makeCrosspointManual: 'makeCrosspoint',
			clearCrosspointManual: 'clearCrosspoint',
			selectDestinationManual: 'selectDestination',
			routeSourceToSelectedDestinationManual: 'routeSourceToSelectedDestination',
			setDeviceNameCustom: 'setDeviceName',
			setSampleRateCustom: 'setSampleRate',
		}

		let updatedActions = []
		for (const action of props.actions) {
			if (actionMap[action.actionId]) {
				action.actionId = actionMap[action.actionId]
				updatedActions.push(action)
			}
		}

		return {
			updatedConfig: null,
			updatedActions: updatedActions,
			updatedFeedbacks: [],
		}
	},
]