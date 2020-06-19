const request = require('request');
const { EventEmitter } = require('events');

const { Device } = require('./device');

const req = (opts) => new Promise((resolve, reject) => request(opts, (err, response) => {
	if (err) return reject(err);
	return resolve(response);
}));

const timeout = (time) => new Promise((resolve) => setTimeout(resolve, time));

class Cloud extends EventEmitter {

	constructor({ username, password, interval }) {
		super();

		this.devices = [];
		this.interval = interval;
		this.credentials = { username, password };

		this.login(username, password)
			.then((login) => {
				this.emit('login', {
					name: login.Name,
					country: login.CountryName,
				});

				this.fetch();
			})
			.catch((e) => this.emit('error', e));
	}

	request(opts) {
		return req({
			...opts,
			headers: {
				'X-MitsContextKey': this.login.ContextKey,
				'content-type': 'application/json',
			},
		});
	}

	login(username, password) {
		const opts = {
			uri: 'https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin',
			method: 'POST',
			form: {
				AppVersion: '1.9.3.0',
				CaptchaChallenge: '',
				CaptchaResponse: '',
				Email: username,
				Language: 0,
				Password: password,
				Persist: 'true',
			},
		};

		return req(opts)
			.then((response) => {
				if (response.statusCode !== 200) {
					throw new Error('failed to login');
				}

				const data = JSON.parse(response.body).LoginData;

				this.login = data;

				return data;
			})
			.catch((e) => {
				this.emit('error', e);

				return timeout(1000)
					.then(() => this.login(username, password));
			});
	}

	attach(data, location) {
		const device = new Device(this, data, location);

		this.devices.push(device);

		// proxy device updates
		device.on('update', (...args) => this.emit('update', device, ...args));
		device.on('schedule', (...args) => this.emit('schedule', device, ...args));
		device.on('connect', (...args) => this.emit('device', device, ...args));
		device.on('error', (...args) => this.emit('device/error', device, ...args));
	}

	fetch() {
		const url = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices';
		const method = 'GET';

		return this.request({ url, method })
			.then((response) => JSON.parse(response.body))
			.then((locations) => {
				const devices = locations.reduce((result, location) => {
					location.Structure.Devices
						.forEach((device) => result.push({ device, location }));

					location.Structure.Floors.forEach((floor) => {
						result.push({ device: floor.Devices, location });

						floor.Areas
							.forEach((area) => result.area({ device: area.Devices, location }));
					});

					location.Structure.Areas
						.forEach((area) => result.push({ device: area.Devices, location }));

					return result;
				}, []);

				devices.forEach(({ device, location }) => this.attach(device, location));
			})
			.catch((e) => this.emit('error', e));
	}

}

module.exports.melcloud = (...args) => new Cloud(...args);
