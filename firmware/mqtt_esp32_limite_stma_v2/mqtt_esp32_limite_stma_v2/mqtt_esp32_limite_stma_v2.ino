#include <WiFi.h>
#include <esp_mac.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>
#include <math.h>
#include "config.h"

// MVP de bancada. Firmware TLS de produção permanece em mqtt_esp32_stma_tls.
constexpr uint8_t DHT_PIN = 4, LED_PIN = 5, DOOR_PIN = 15;
constexpr float HYSTERESIS = 0.5f;
DHT dht(DHT_PIN, DHT11);
WiFiClient network;
PubSubClient mqtt(network);
String deviceId, baseTopic;
String lastCommand;
bool ledOn = false, automatic = false, above = false, reevaluate = false;
float threshold = 0;
unsigned long lastSample = 0, lastReconnect = 0, lastWifi = 0;
void publishControl();

bool publish(const String& topic, const char* value, bool retained = false) {
  const bool ok = mqtt.publish(topic.c_str(), value, retained);
  if (!ok) Serial.println("Publicacao MQTT nao concluida");
  return ok;
}
void publishLed() {
  const char* text = ledOn ? "O LED está aceso" : "O LED está apagado";
  publish(baseTopic + "/led", text, true);
  if (LEGACY_PAGE_ENABLED) publish(String(MQTT_PREFIX) + "/led", text, true);
}
void setLed(bool on) {
  ledOn = on;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
  publishLed();
}
void publishThreshold() {
  char value[16];
  if (automatic) snprintf(value, sizeof(value), "%.1f", threshold);
  else snprintf(value, sizeof(value), "off");
  publish(baseTopic + "/limite_atual", value, true);
  if (LEGACY_PAGE_ENABLED) publish(String(MQTT_PREFIX) + "/limite_atual", value, true);
}
void callback(char* topic, byte* payload, unsigned int length) {
  if (length == 0 || length >= 96) return;
  char value[96]; memcpy(value, payload, length); value[length] = '\0';
  String command(value); command.trim();
  const String received(topic);
  if (received == baseTopic + "/acionar") {
    // id|validade Unix UTC|tipo|valor. Comandos atrasados não acionam o dispositivo.
    const int a = command.indexOf('|'), b = command.indexOf('|', a + 1), c = command.indexOf('|', b + 1);
    if (a != 36 || b <= a || c <= b) return;
    const String id = command.substring(0, a), type = command.substring(b + 1, c), val = command.substring(c + 1);
    for (int i = 0; i < 36; i++) if (!isxdigit(id[i]) && id[i] != '-') return;
    const time_t utc = time(nullptr); const long expires = command.substring(a + 1, b).toInt();
    if (utc < 1704067200 || expires < utc || expires > utc + 30) return;
    if (id == lastCommand) { publishControl(); return; }
    if (type == "led") {
      if (automatic || (val != "L" && val != "l")) return;
      setLed(val == "L");
    } else if (type == "limite") {
      if (val == "off") { automatic = false; reevaluate = false; }
      else {
        char* end = nullptr; const float number = strtof(val.c_str(), &end);
        if (end == val.c_str() || *end != '\0' || !isfinite(number) || number < 0 || number > 50) return;
        threshold = number; automatic = true; reevaluate = true;
      }
      publishThreshold();
    } else return;
    lastCommand = id; publishControl(); return;
  }
  if (received == baseTopic + "/limite" || (LEGACY_PAGE_ENABLED && received == String(MQTT_PREFIX) + "/limite")) {
    if (command.equalsIgnoreCase("off")) { automatic = false; reevaluate = false; }
    else {
      char* end = nullptr;
      const float number = strtof(command.c_str(), &end);
      if (end == command.c_str() || *end != '\0' || !isfinite(number) || number < 0 || number > 50) return;
      threshold = number; automatic = true; reevaluate = true;
    }
    publishThreshold();
    lastCommand = ""; publishControl();
  } else if (received == baseTopic + "/comando" || (LEGACY_PAGE_ENABLED && received == String(MQTT_PREFIX) + "/publisher")) {
    // Para comando manual persistir, desative o automático primeiro.
    if (automatic) { publishLed(); return; }
    if (command == "L") setLed(true);
    else if (command == "l") setLed(false);
    lastCommand = ""; publishControl();
  }
}
void publishControl() {
  char value[256], limit[16], command[40];
  if (automatic) snprintf(limit, sizeof(limit), "%.1f", threshold); else snprintf(limit, sizeof(limit), "null");
  if (lastCommand.length()) snprintf(command, sizeof(command), "\"%s\"", lastCommand.c_str()); else snprintf(command, sizeof(command), "null");
  snprintf(value, sizeof(value), "{\"id\":\"%s\",\"led\":%s,\"limite\":%s,\"comando_id\":%s}", deviceId.c_str(), ledOn ? "true" : "false", limit, command);
  publish(baseTopic + "/controle", value, false);
}
void applyThreshold(float temperature) {
  if (!automatic) return;
  bool next = above;
  if (reevaluate) { next = temperature >= threshold; reevaluate = false; }
  else if (!above && temperature >= threshold) next = true;
  else if (above && temperature < threshold - HYSTERESIS) next = false;
  above = next;
  if (ledOn != next) setLed(next);
}
void reconnect(unsigned long now) {
  if (now - lastReconnect < 5000) return;
  lastReconnect = now;
  const String status = baseTopic + "/status";
  const String clientId = "stma-v2-" + deviceId;
  if (mqtt.connect(clientId.c_str(), nullptr, nullptr, status.c_str(), 1, true, "offline")) {
    publish(status, "online", true);
    mqtt.subscribe((baseTopic + "/comando").c_str(), 1);
    mqtt.subscribe((baseTopic + "/acionar").c_str(), 1);
    mqtt.subscribe((baseTopic + "/limite").c_str(), 1);
    if (LEGACY_PAGE_ENABLED) {
      mqtt.subscribe((String(MQTT_PREFIX) + "/publisher").c_str(), 1);
      mqtt.subscribe((String(MQTT_PREFIX) + "/limite").c_str(), 1);
    }
    publishLed(); publishThreshold();
    lastSample = now - SAMPLE_MS;
    Serial.println("MQTT conectado");
  }
}
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW);
  pinMode(DOOR_PIN, INPUT);
  dht.begin();
  WiFi.mode(WIFI_STA);
  // Lê o MAC de hardware; WiFi.macAddress() pode retornar zeros antes da conexão.
  uint8_t mac[6];
  if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) {
    Serial.println("Falha ao ler identificador de hardware; reiniciando");
    delay(1000); ESP.restart(); return;
  }
  char identifier[24];
  snprintf(identifier, sizeof(identifier), "esp32-%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  deviceId = identifier;
  baseTopic = String(MQTT_PREFIX) + "/" + deviceId;
  WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // UTC. Sem relógio sincronizado o JSON omite timestamp; backend usa recebimento.
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(callback); mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30); mqtt.setSocketTimeout(3);
  Serial.println(deviceId);
}
void loop() {
  const unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifi >= 10000) { lastWifi = now; WiFi.reconnect(); }
    delay(5); return;
  }
  if (!mqtt.connected()) { reconnect(now); delay(5); return; }
  mqtt.loop();
  if (now - lastSample < SAMPLE_MS) { delay(1); return; }
  lastSample = now;
  // Repetir estado permite recuperar a porta se backend estiver indisponível.
  // O banco grava somente mudanças, e não uma linha a cada publicação.
  const char* door = digitalRead(DOOR_PIN) == HIGH ? "Porta Fechada" : "Porta Aberta";
  publish(baseTopic + "/porta", door);
  if (LEGACY_PAGE_ENABLED) publish(String(MQTT_PREFIX) + "/porta", door);
  const float t = dht.readTemperature(), h = dht.readHumidity();
  if (!isfinite(t) || !isfinite(h) || t < 0 || t > 50 || h < 0 || h > 100) {
    Serial.println("DHT11: leitura invalida; nenhuma telemetria publicada"); return;
  }
  applyThreshold(t);
  char buffer[256], timestamp[32] = "";
  const time_t utc = time(nullptr);
  if (utc >= 1704067200) {
    struct tm tmUtc; gmtime_r(&utc, &tmUtc);
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &tmUtc);
  }
  if (timestamp[0]) snprintf(buffer, sizeof(buffer), "{\"id\":\"%s\",\"temperatura\":%.1f,\"umidade\":%.1f,\"timestamp\":\"%s\"}", deviceId.c_str(), t, h, timestamp);
  else snprintf(buffer, sizeof(buffer), "{\"id\":\"%s\",\"temperatura\":%.1f,\"umidade\":%.1f}", deviceId.c_str(), t, h);
  publish(baseTopic + "/dados", buffer, false); Serial.println(buffer);
  // Compatibilidade visual com a página antiga; o backend grava somente /dados.
  snprintf(buffer, sizeof(buffer), "%.1f", t);
  publish(baseTopic + "/temperatura", buffer);
  if (LEGACY_PAGE_ENABLED) publish(String(MQTT_PREFIX) + "/temperatura", buffer);
  snprintf(buffer, sizeof(buffer), "%.1f", h);
  publish(baseTopic + "/umidade", buffer);
  if (LEGACY_PAGE_ENABLED) publish(String(MQTT_PREFIX) + "/umidade", buffer);
  publishLed(); publishThreshold();
  publishControl();
}
