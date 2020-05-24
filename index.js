const { connect } = require('mqtt');
const { melcloud } = require('./melcloud');
const { config } = require('./config');

const topics = {
	state: () => `${config.mqtt.path}/state`,
	device: () => `${config.mqtt.path}/device`,
	update: (id) => `${config.mqtt.path}/${id}`,
	change: (id) => `${config.mqtt.path}/${id}/set`,
};

const mqtt = connect(config.mqtt.host, {
	username: config.mqtt.username,
	password: config.mqtt.password,
	clientId: config.mqtt.id,
	will: {
		topic: topics.state(),
		payload: 'offline',
		retain: true,
	},
});

const cloud = melcloud({
	username: config.melcloud.username,
	password: config.melcloud.password,
	interval: config.melcloud.interval,
});

const subsciptions = {};


mqtt.on('connect', () => {
	console.log(`[MQTT] connected to ${config.mqtt.host}`);
});

cloud.on('login', () => {
	console.log(`[MELCLOUD] logged in as ${config.melcloud.username}`);

	mqtt.publish(topics.state(), 'online', {
		retain: true,
	});
});

cloud.on('device', (device) => {
	const topic = topics.change(device.id);
	mqtt.subscribe(topic);
	subsciptions[topic] = device;

	console.log(`[MELCLOUD] registering device at ${topics.update(device.id, device.building)}`);

	mqtt.publish(topics.device(), JSON.stringify(device.info), {
		retain: true,
	});
});

cloud.on('update', (device, state) => {
	console.log(`[MELCLOUD] received update for ${topics.update(device.id, device.building)}`);

	mqtt.publish(topics.update(device.id, device.building), JSON.stringify(state), {
		retain: true,
	});
});

mqtt.on('message', (topic, data) => {
	const device = subsciptions[topic];

	if (!device) {
		console.error(`[MQTT] received data for unknown device ${topic}`);
		return;
	}

	try {
		device.set(JSON.parse(data.toString()));
	} catch (e) {
		console.error('[MQTT] not able to parse incoming message');
	}
});

cloud.on('error', (e) => {
	console.error('[MELCLOUD] unexpected error:');
	console.error(e);
});

cloud.on('device/error', (device, e) => {
	console.error('[MELCLOUD] unexpected device error:');
	console.error(e);
});
