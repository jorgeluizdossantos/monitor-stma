#include <WiFi.h>
#include <PubSubClient.h>
#include "DHT.h"
#include "config.h"

#define DHTTYPE DHT11
#define DHTPIN 4
DHT dht(DHTPIN, DHTTYPE);

WiFiClient espClient;
PubSubClient client(espClient);

String deviceId;     // ex.: esp32-a8032a1e7214
String topicBase;    // ex.: engeasier/esp32-a8032a1e7214
String topicCmd;     // tópico de comando do LED

unsigned long lastMsg = 0;
char msg[160];
char LED = 5;
char Sensor = 15;

void setup_wifi() {
  Serial.println();
  Serial.print("Connecting to ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");
  Serial.println(WiFi.localIP());

  // ID único a partir do MAC (chamar depois do WiFi.mode)
  String mac = WiFi.macAddress();   // "A8:03:2A:1E:72:14"
  mac.replace(":", "");
  mac.toLowerCase();
  deviceId = "esp32-" + mac;
  topicBase = "engeasier/" + deviceId;
  topicCmd = topicBase + "/comando";

  Serial.print("Device ID: ");
  Serial.println(deviceId);
}

void publicaTexto(const String &topico, const char *texto, bool retido = false) {
  client.publish(topico.c_str(), texto, retido);
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println();

  if (length == 0) return;

  if ((char)payload[0] == 'L') {
    digitalWrite(LED, HIGH);
    publicaTexto(topicBase + "/led", "O LED está aceso");
  }
  if ((char)payload[0] == 'l') {
    digitalWrite(LED, LOW);
    publicaTexto(topicBase + "/led", "O LED está apagado");
  }
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    String statusTopic = topicBase + "/status";

    // clientId fixo = ID do dispositivo; LWT publica "offline" se cair
    if (client.connect(deviceId.c_str(), NULL, NULL,
                       statusTopic.c_str(), 0, true, "offline")) {
      Serial.println("Conectado");
      publicaTexto(statusTopic, "online", true);
      client.subscribe(topicCmd.c_str());
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(Sensor, INPUT);
  Serial.begin(115200);

  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  dht.begin();
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  unsigned long now = millis();
  if (now - lastMsg < 2000) return;   // lê a cada 2 s (DHT11 não é rápido)
  lastMsg = now;

  float t = dht.readTemperature();
  float h = dht.readHumidity();
  int sns = digitalRead(Sensor);

  publicaTexto(topicBase + "/porta", sns == 1 ? "Porta Fechada" : "Porta Aberta");

  if (isnan(t) || isnan(h)) {
    Serial.println("Falha na leitura do DHT");
    return;
  }

  // tópicos separados (como antes)
  snprintf(msg, sizeof(msg), "%.1f", t);
  publicaTexto(topicBase + "/temperatura", msg);
  snprintf(msg, sizeof(msg), "%.1f", h);
  publicaTexto(topicBase + "/umidade", msg);

  // e/ou um JSON com o ID incluído
  snprintf(msg, sizeof(msg),
           "{\"id\":\"%s\",\"temperatura\":%.1f,\"umidade\":%.1f}",
           deviceId.c_str(), t, h);
  publicaTexto(topicBase + "/dados", msg);

  Serial.println(msg);
}
