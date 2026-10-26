#pragma once
// Copie para config.h (ignorado pelo Git); nenhum segredo deve ir ao repositório.
const char* WIFI_SSID = "PREENCHA_WIFI";
const char* WIFI_PASSWORD = "PREENCHA_SENHA";
constexpr bool MQTT_USE_TLS = true;
const char* MQTT_HOST = "PREENCHA_HOST_DO_BROKER";
constexpr uint16_t MQTT_PORT = 8883;
const char* MQTT_USER = "PREENCHA_USUARIO_DA_PLACA";
const char* MQTT_PASSWORD = "PREENCHA_SENHA_DA_PLACA";
const char* MQTT_PREFIX = "engeasier";
// CA raiz fornecida/recomendada pelo broker, completa; nunca usar setInsecure().
const char* MQTT_ROOT_CA = R"PEM(-----BEGIN CERTIFICATE-----
PREENCHA_A_CA_RAIZ
-----END CERTIFICATE-----
)PEM";
constexpr unsigned long READING_INTERVAL_MS = 30000;
// Para HiveMQ Lab LOCAL: MQTT_USE_TLS=false, IP LAN do PC, porta 1883.
// Nessa configuração local, usuário/senha podem ser strings vazias.
