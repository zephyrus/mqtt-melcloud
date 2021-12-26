module.exports.config = {

	mqtt: {
		host: process.env.MQTT_HOST,
		username: process.env.MQTT_USERNAME,
		password: process.env.MQTT_PASSWORD,
		id: process.env.MQTT_ID,
		path: process.env.MQTT_PATH || 'melcloud',
	},

	melcloud: {
		username: process.env.MELCLOUD_USERNAME,
		password: process.env.MELCLOUD_PASSWORD,
		interval: process.env.MELCLOUD_INTERVAL || 5000,
		refresh: process.env.MELCLOUD_REFRESH || 60000,
	},

};
