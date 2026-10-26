#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoMqttClient.h>
#include <DHT.h>
#include <time.h>
#include <sys/time.h>
#include "config.h"

static_assert(READING_INTERVAL_MS >= 2000 && READING_INTERVAL_MS <= 3600000, "Intervalo deve ser 2–3600 segundos");
constexpr uint8_t DHT_PIN = 4, LED_PIN = 5, DOOR_PIN = 15;
DHT dht(DHT_PIN, DHT11);
WiFiClient plainTransport;
WiFiClientSecure tlsTransport;
MqttClient mqtt(MQTT_USE_TLS ? static_cast<Client&>(tlsTransport) : static_cast<Client&>(plainTransport));
String deviceId, baseTopic;
unsigned long lastWifiAttempt = 0, lastMqttAttempt = 0, lastReading = 0;
bool configured = false, pendingReading = false;
int publishedDoor = -1, pendingLed = -1;
char readingPayload[256];

bool publish(const String& topic, const char* payload, bool retain = false) {
  if (!mqtt.beginMessage(topic, static_cast<unsigned long>(strlen(payload)), retain, 1)) return false;
  mqtt.print(payload);
  const bool acknowledged = mqtt.endMessage() == 1;
  if (!acknowledged) mqtt.stop();
  return acknowledged;
}

void onMessage(int size) {
  // Não publicar dentro do callback: ele também pode rodar enquanto aguardamos PUBACK.
  const bool command = mqtt.messageTopic() == baseTopic + "/comando" && size == 1 && !mqtt.messageRetain();
  const int value = mqtt.available() ? mqtt.read() : -1;
  while (mqtt.available()) mqtt.read();
  if (command && value == 'L') pendingLed = HIGH;
  if (command && value == 'l') pendingLed = LOW;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT); pinMode(DOOR_PIN, INPUT); dht.begin();
  if (strlen(MQTT_HOST) == 0 || (MQTT_USE_TLS && (!strlen(MQTT_ROOT_CA) || !strlen(MQTT_USER) || !strlen(MQTT_PASSWORD)))) {
    Serial.println("Preencha host, credenciais e CA em config.h."); return;
  }
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  String mac = WiFi.macAddress(); mac.replace(":", ""); mac.toLowerCase();
  deviceId = "esp32-" + mac; baseTopic = String(MQTT_PREFIX) + "/" + deviceId;
  Serial.print("Device ID: "); Serial.println(deviceId);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  if (MQTT_USE_TLS) { tlsTransport.setCACert(MQTT_ROOT_CA); tlsTransport.setHandshakeTimeout(10); }
  else Serial.println("Modo de laboratório: MQTT sem TLS. Não usar na Internet.");
  mqtt.setId(deviceId); mqtt.setCleanSession(true);
  mqtt.setConnectionTimeout(5000); mqtt.setKeepAliveInterval(30000);
  if (strlen(MQTT_USER)) mqtt.setUsernamePassword(MQTT_USER, MQTT_PASSWORD);
  mqtt.onMessage(onMessage);
  mqtt.beginWill(baseTopic + "/status", static_cast<unsigned short>(7), true, 1);
  mqtt.print("offline"); mqtt.endWill();
  configured = true;
}

void loop() {
  if (!configured) { delay(100); return; }
  const unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttempt >= 5000) { lastWifiAttempt = now; WiFi.reconnect(); }
    delay(10); return;
  }
  // Relógio válido é necessário para verificar certificado e deduplicar a medição.
  if (time(nullptr) < 1700000000) { delay(10); return; }
  if (!mqtt.connected()) {
    if (now - lastMqttAttempt < 5000) { delay(10); return; }
    lastMqttAttempt = now;
    if (!mqtt.connect(MQTT_HOST, MQTT_PORT)) { Serial.println("Conexão MQTT falhou; confira host, CA e credenciais."); return; }
    if (!mqtt.subscribe(baseTopic + "/comando", 1) || !publish(baseTopic + "/status", "online")) { mqtt.stop(); return; }
    publishedDoor = -1;
    Serial.println("MQTT conectado; publicação QoS 1 habilitada.");
  }
  mqtt.poll();
  if (pendingLed >= 0) {
    digitalWrite(LED_PIN, pendingLed);
    if (publish(baseTopic + "/led", pendingLed == HIGH ? "O LED está aceso" : "O LED está apagado")) pendingLed = -1;
  }
  if (!mqtt.connected()) return;
  if (!pendingReading && now - lastReading >= READING_INTERVAL_MS) {
    lastReading = now;
    const float temperature = dht.readTemperature(), humidity = dht.readHumidity();
    if (!isnan(temperature) && !isnan(humidity)) {
      timeval captured; gettimeofday(&captured, nullptr);
      tm utc; gmtime_r(&captured.tv_sec, &utc);
      char date[24], timestamp[32]; strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%S", &utc);
      snprintf(timestamp, sizeof(timestamp), "%s.%03ldZ", date, static_cast<long>(captured.tv_usec / 1000));
      const int length = snprintf(readingPayload, sizeof(readingPayload), "{\"id\":\"%s\",\"temperatura\":%.1f,\"umidade\":%.1f,\"timestamp\":\"%s\"}", deviceId.c_str(), temperature, humidity, timestamp);
      pendingReading = length > 0 && static_cast<size_t>(length) < sizeof(readingPayload);
    } else Serial.println("Falha na leitura do DHT11.");
  }
  if (pendingReading && publish(baseTopic + "/dados", readingPayload)) {
    Serial.println(readingPayload); pendingReading = false;
  }
  // Mantém o mesmo JSON/timestamp na tentativa seguinte até o PUBACK, em RAM.
  // Não há armazenamento durável nem coleta de novas amostras enquanto esta estiver pendente.
  if (!mqtt.connected()) return;
  const int door = digitalRead(DOOR_PIN);
  if (door != publishedDoor && publish(baseTopic + "/porta", door == HIGH ? "Porta Fechada" : "Porta Aberta")) publishedDoor = door;
  delay(2);
}
