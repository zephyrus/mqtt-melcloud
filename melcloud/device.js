const { EventEmitter } = require('events');

const operationMode = {
	heat: 1,
	dry: 2,
	cool: 3,
	fan: 7,
	auto: 8,
};

const parseVane = (swing, values = 5) => (v) => {
	if (v === 0) return 'auto';

	if (v === swing) return 'swing';

	// if we have 5 positions, then
	// 1 = 0%
	// 2 = 25%
	// 3 = 50%
	// 4 = 75%
	// 5 = 100%
	if (v >= 1 && v <= values) return (v - 1) / (values - 1);

	return undefined;
};

const prepareVane = (swing, values = 5) => (v) => {
	if (v === 'auto') return 0;

	if (v === 'swing') return swing;

	if (v >= 0 && v <= 1) return Math.round(v * (values - 1) + 1);

	return undefined;
};

const parseVertical = parseVane(7);
const prepareVertical = prepareVane(7);
const parseHorizontal = parseVane(12);
const prepareHorizontal = prepareVane(12);

const diff = (a = {}, b = {}) => [...Object.keys(a), ...Object.keys(b)].reduce((result, k) => {
	if (a[k] === b[k]) return result;

	const change = a[k] !== null && typeof a[k] === 'object'
		? diff(a[k], b[k])
		: b[k];

	if (change !== null && typeof change === 'object' && Object.keys(change).length === 0) {
		return result;
	}

	result[k] = change;

	return result;
}, {});

class Device extends EventEmitter {

	constructor(cloud, device, location) {
		super();

		this.state = undefined;

		this.cloud = cloud;
		this.data = device;
		this.location = location;

		this.id = device.DeviceID;
		this.building = device.BuildingID;

		this.info = {
			id: this.id,
			name: device.DeviceName,
			serial: device.SerialNumber,
			mac: device.MacAddress,
			building: this.building,

			lastSeen: device.Device.LastTimeStamp,

			address: [
				location.AddressLine1,
				location.AddressLine2,
			].join('\n'),

			location: {
				latitude: location.Latitude,
				longitude: location.Longitude,
			},
		};

		this.read();
		this.interval = setInterval(() => this.read(), this.cloud.interval);
	}

	read() {
		const url = `https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/Get?id=${this.id}&buildingID=${this.building}`;
		const method = 'GET';

		return this.cloud.request({ method, url })
			.then((response) => JSON.parse(response.body))
			.then((state) => this.update(state))
			.catch((e) => this.emit('error', e));
	}

	prepareUpdate(state, ability) {
		return {
			Power: state.power !== undefined
				? !!state.power
				: undefined,
			SetTemperature: state.target
				? Math.round(state.target * 2) / 2
				: undefined,
			SetFanSpeed: state.fan === 'auto'
				? 0
				: Math.floor(state.fan * ability.speeds),
			OperationMode: operationMode[state.mode],
			VaneHorizontal: prepareHorizontal(state.horizontal),
			VaneVertical: prepareVertical(state.vertical),
		};
	}

	parseState(state) {
		return {
			status: {
				online: !state.Offline,
				sync: !state.HasPendingCommand,
				temperature: state.RoomTemperature,
			},
			state: {
				power: state.Power,
				target: state.SetTemperature,
				fan: state.SetFanSpeed === 0
					? 'auto'
					: state.SetFanSpeed / state.NumberOfFanSpeeds,
				mode: Object.keys(operationMode)
					.find((k) => operationMode[k] === state.OperationMode),
				horizontal: parseHorizontal(state.VaneHorizontal),
				vertical: parseVertical(state.VaneVertical),
			},
		};
	}

	parseSchedule(state) {
		return {
			prev: (new Date(`${state.LastCommunication}Z`)).toISOString(),
			next: (new Date(`${state.NextCommunication}Z`)).toISOString(),
		};
	}

	parseAbility(state) {
		return {
			speeds: state.NumberOfFanSpeeds,
		};
	}

	update(state) {
		// cleanup
		delete state.WeatherObservations;

		// debug information
		const diffRaw = diff(this.rawState, state);
		if (diffRaw && Object.keys(diffRaw).length > 0) {
			this.emit('debug', diffRaw);
		}

		this.rawState = state;

		const next = this.parseState(state);

		next.status = {
			...(next.status.sync ? next.state : this.state && this.state.status),
			...next.status,
		};

		delete next.status.sync;

		const nextSchedule = this.parseSchedule(state);

		this.ability = this.parseAbility(state);

		if (!this.state) {
			this.emit('connect', {
				...this.info,
				...this.ability,
			});

			this.emit('state', next.state, next.state);
			this.emit('status', next.status, next.status);
			this.emit('schedule', nextSchedule, nextSchedule);

			this.state = next;

			return this.state;
		}

		const diffSchedule = diff(this.schedule, nextSchedule);
		if (diffSchedule && Object.keys(diffSchedule).length > 0) {
			this.schedule = nextSchedule;
			this.emit('schedule', this.schedule, diffSchedule);
		}

		const diffState = diff(this.state.state, next.state);
		if (diffState && Object.keys(diffState).length > 0) {
			this.state.state = next.state;
			this.emit('state', this.state.state, diffState);
		}

		const diffStatus = diff(this.state.status, next.status);
		if (diffStatus && Object.keys(diffStatus).length > 0) {
			this.state.status = next.status;
			this.emit('status', this.state.status, diffStatus);
		}

		return this.state;
	}

	set(update) {
		const change = this.prepareUpdate(update, this.ability);

		const same = Object.keys(change)
			.every((k) => change[k] === undefined || this.rawState[k] === change[k]);

		if (same) return Promise.resolve();

		Object.keys(change).forEach((k) => {
			if (change[k] === undefined) change[k] = this.rawState[k];
		});

		const url = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/Device/SetAta';
		const method = 'POST';
		const body = JSON.stringify({
			DeviceID: this.id,

			// due to we are trying to set all changable params
			EffectiveFlags: 287,

			...change,
		});

		return this.cloud.request({ url, method, body })
			.then((response) => JSON.parse(response.body))
			.then((state) => this.update(state))
			.catch((e) => this.emit('error', e));
	}

}

module.exports = { Device };
