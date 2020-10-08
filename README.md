# mqtt-melcloud
MQTT integration for Mitsubishi Melcloud devices

## Docker Compose

```yml
version: '3'

services:

  melcloud:
    image: 2mqtt/melcloud:0.0.8

    restart: always

    environment:
      - MQTT_ID=melcloud
      - MQTT_PATH=melcloud
      - MQTT_HOST=mqtt://<ip address of mqtt broker>
      - MQTT_USERNAME=<mqtt username>
      - MQTT_PASSWORD=<mqtt password>
      - MELCLOUD_USERNAME=<melcloud username>
      - MELCLOUD_PASSWORD=<melcloud password>
```