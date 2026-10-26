#pragma once
// Copie para config.h (ignorado pelo Git). Nunca publique a senha Wi-Fi.
const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_PASSWORD = "SUA_SENHA";
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_PREFIX = "stma";
// Compatibilidade com a página HTML original. Tópicos globais são apenas para bancada.
const bool LEGACY_PAGE_ENABLED = true;
const unsigned long SAMPLE_MS = 15000;
