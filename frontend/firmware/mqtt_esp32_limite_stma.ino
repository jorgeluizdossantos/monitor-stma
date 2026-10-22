#include <WiFi.h>
#include <PubSubClient.h>
#include "DHT.h"

#define DHTTYPE DHT11   // modelo do sensor - DHT11
#define DHTPIN 4 //pino do sensor
DHT dht(DHTPIN, DHTTYPE); //variavel para leitura

// Configuração da rede WI-FI

const char *ssid = "JORGE_TP";
const char *password = "69879739";
//const char *ssid = "FIEB_WMOBILE";
//const char *password = "Fieb*Mobile";
const char* mqtt_server = "broker.hivemq.com"; //BROKER MQTT

// ---- Tópicos MQTT ----
const char* TOPICO_COMANDO      = "stma/publisher";    // recebe "L" (acende) ou "l" (apaga)
const char* TOPICO_LIMITE       = "stma/limite";       // recebe o limite de temperatura (ex.: "28.0") ou "off"
const char* TOPICO_LIMITE_ATUAL = "stma/limite_atual"; // o ESP32 confirma aqui o limite em uso
const char* TOPICO_LED          = "stma/led";          // estado do LED

String deviceId;     // ex.: esp32-a8032a1e7214
String topicBase;    // ex.: stma/esp32-a8032a1e7214
String topicCmd;     // tópico de comando do LED

// ---- Controle automático por temperatura ----
const float HISTERESE = 0.5;   // °C abaixo do limite para o LED apagar (evita o LED piscar na fronteira)
bool  limiteAtivo   = false;   // true = controle automático ligado
float limite        = 0.0;     // limite de temperatura em °C
bool  acimaDoLimite = false;   // estado interno do controle automático
bool  reavaliar     = false;   // true quando um novo limite acabou de chegar
bool  ledAceso      = false;   // estado atual do LED

WiFiClient espClient;
PubSubClient client(espClient);
unsigned long lastMsg = 0;
//#define MSG_BUFFER_SIZE	(50)
#define MSG_BUFFER_SIZE	(160)
char msg[MSG_BUFFER_SIZE];

char LED;
char Sensor;

void setup_wifi() {

  delay(10);
  // We start by connecting to a WiFi network
  Serial.println();
  Serial.print("Conectando à rede ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }


  // ID único a partir do MAC (chamar depois do WiFi.mode)
  String mac = WiFi.macAddress();   // "A8:03:2A:1E:72:14"
  mac.replace(":", "");
  mac.toLowerCase();
  deviceId = "esp32-" + mac;
  topicBase = "stma/" + deviceId;
  topicCmd = topicBase + "/comando";

  Serial.print("Identificador do dispositivo: ");
  Serial.println(deviceId);


  randomSeed(micros());

  Serial.println("");
  Serial.println("Conectado à rede WiFi com sucesso!");
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
}

void publicaTexto(const String &topico, const char *texto, bool retido = false) {
  client.publish(topico.c_str(), texto, retido);
}

// Publica o estado atual do LED (mensagem retida: quem se conecta depois já recebe o último estado)
void publicarLed() {
  const char* texto = ledAceso ? "O LED está aceso" : "O LED está apagado";
  Serial.print("Publica mensagem: ");
  Serial.println(texto);
  client.publish(TOPICO_LED, texto, true);
}

// Liga/desliga o LED e informa o novo estado
void setLed(bool aceso) {
  ledAceso = aceso;
  digitalWrite(LED, aceso ? HIGH : LOW);
  publicarLed();
}

// Publica o limite em uso (mensagem retida): "28.0" ou "off"
void publicarLimite() {
  if (limiteAtivo) {
    snprintf(msg, MSG_BUFFER_SIZE, "%.1f", limite);
    client.publish(TOPICO_LIMITE_ATUAL, msg, true);
  } else {
    client.publish(TOPICO_LIMITE_ATUAL, "off", true);
  }
}

// Interpreta a mensagem recebida em stma/limite
void tratarLimite(byte* payload, unsigned int length) {
  char buf[16];
  unsigned int n = (length < sizeof(buf) - 1) ? length : sizeof(buf) - 1;
  memcpy(buf, payload, n);
  buf[n] = '\0';

  if (buf[0] == 'o' || buf[0] == 'O') {          // "off": desativa o controle automático
    limiteAtivo = false;
    Serial.println("Controle automatico desativado");
  } else {
    char* fim;
    float v = strtof(buf, &fim);
    if (fim == buf || v < 0 || v > 50) {         // não é número, ou fora da faixa do DHT11 (0 a 50 °C)
      Serial.println("Limite invalido, ignorado");
      return;
    }
    limite = v;
    limiteAtivo = true;
    reavaliar = true;                            // o loop() aplica o novo limite na próxima leitura
    Serial.print("Novo limite: ");
    Serial.println(limite);
  }
  publicarLimite();
}

// Acende/apaga o LED conforme a temperatura e o limite
void controlarPorLimite(float t) {
  if (!limiteAtivo || isnan(t)) return;

  if (reavaliar) {
    // Novo limite acabou de chegar: aplica imediatamente conforme a temperatura atual
    reavaliar = false;
    acimaDoLimite = (t >= limite);
    setLed(acimaDoLimite);
    return;
  }

  if (!acimaDoLimite && t >= limite) {
    acimaDoLimite = true;
    setLed(true);                                // atingiu o limite: acende
  } else if (acimaDoLimite && t < limite - HISTERESE) {
    acimaDoLimite = false;
    setLed(false);                               // voltou abaixo do limite (com histerese): apaga
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Message arrived [");
  Serial.print(topic);
  Serial.print("] ");
  for (int i = 0; i < length; i++) {
    Serial.print((char)payload[i]);
  }
  Serial.println();

  if (length == 0) return;

  

  // Novo limite de temperatura
  if (strcmp(topic, TOPICO_LIMITE) == 0) {
    tratarLimite(payload, length);
    return;
  }



  // Comando manual do LED
  if ((char)payload[0] == 'L') {
    setLed(true);
    publicaTexto(topicBase + "/led", "O LED está aceso");
  }

  if ((char)payload[0] == 'l') {
    setLed(false);
    publicaTexto(topicBase + "/led", "O LED está apagado");
  }

}

void reconnect() {
  // Loop until we're reconnected
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Create a random client ID
    String clientId = "STMA_MQTT";
    //Não é mais um número aleatório
    clientId += deviceId;
    //clientId += String(random(0xffff), HEX);
    // Attempt to connect
    if (client.connect(clientId.c_str())) {
      Serial.println("Conectado");

      client.subscribe(TOPICO_COMANDO);
      client.subscribe(TOPICO_LIMITE);   // se houver um limite retido no broker, ele chega logo após a inscrição

      publicarLed();
      publicarLimite();
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      // Wait 5 seconds before retrying
      delay(5000);
    }
  }
}

void setup() {

  LED = 5;
  Sensor = 15;

  pinMode(LED, OUTPUT);
  pinMode(Sensor, INPUT);

  Serial.begin(115200);
  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);

  dht.begin();
}

void loop() {

  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  float t = dht.readTemperature();
  float h = dht.readHumidity();

  int sns = digitalRead(Sensor);

  if (sns == 1) {
    Serial.println("Sensor de Porta Fechado");
    snprintf (msg, MSG_BUFFER_SIZE,"Porta Fechada" );
    client.publish("stma/porta",msg);
  } else {
    Serial.println("Sensor de Porta Aberto");
    snprintf (msg, MSG_BUFFER_SIZE, "Porta Aberta");
    client.publish("stma/porta",msg);
  }
  Serial.print(topicBase);
  Serial.print("\n ");

  Serial.print("Temperatura: ");
  Serial.print(t);
  Serial.println(F("°C"));
  sprintf(msg, "%f", t);
  client.publish("stma/temperatura", msg);
  publicaTexto(topicBase + "/temperatura", msg);

  Serial.print(topicBase);
  Serial.print("\n ");
  Serial.print("Umidade: ");
  Serial.print(h);
  Serial.println(F("%"));
  sprintf(msg, "%f", h);
  client.publish("stma/umidade", msg);
  publicaTexto(topicBase + "/umidade", msg);
  

  //publicaTexto(topicBase + "/led", msg);

  controlarPorLimite(t);

  delay(1000);

}
