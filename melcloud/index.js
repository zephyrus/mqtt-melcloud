const dns = require('dns');
const request = require('request');
const { EventEmitter } = require('events');

const { Device } = require('./device');

const req = (opts) => new Promise((resolve, reject) => request(opts, (err, response) => {
	if (err) return reject(err);
	return resolve(response);
}));

const timeout = (time) => new Promise((resolve) => setTimeout(resolve, time));

const cache = {};

const random = (arr) => arr[Math.trunc(Math.random() * arr.length)];
const filter = (host) => {
	const data = cache[host];

	if (!data) return;

	const ttl = Math.trunc((+new Date() - data.time) / 1000);
	data.addr = data.addr.filter((addr) => ttl <= addr.ttl);

	if (!data.addr.length) return;

	return random(data.addr);
};

const lookup = (host, opts, callback) => {
	const ip = filter(host);
	if (ip) {
		return callback(null, ip.address, 4);
	}

	dns.resolve4(host, { ttl: true }, (err, result) => {
		if (err) return callback(err);

		cache[host] = {
			time: +new Date(),
			addr: result,
		};

		callback(null, random(result).address, 4);
	});
};

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
			lookup,
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
		device.on('state', (...args) => this.emit('state', device, ...args));
		device.on('status', (...args) => this.emit('status', device, ...args));
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
