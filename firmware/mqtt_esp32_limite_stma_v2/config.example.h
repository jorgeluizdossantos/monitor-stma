#pragma once
// Copie para config.h (ignorado pelo Git).
// Nenhuma credencial de rede fica aqui: a rede e a senha do Wi-Fi sao
// configuradas uma unica vez pelo portal local do dispositivo e ficam na NVS.

// --- Portal de configuracao local -------------------------------------------
// Nome do Access Point: PORTAL_AP_PREFIXO + identificador do dispositivo.
const char* PORTAL_AP_PREFIXO = "STMA-";
// Senha do Access Point (WPA2, minimo 8 caracteres). Troque antes de gravar.
const char* PORTAL_AP_SENHA = "troque-esta-senha";
// Tempo que o portal fica aberto, em segundos. 0 = sem limite.
// Ao expirar sem configuracao, o dispositivo reinicia e volta ao modo normal.
const uint16_t PORTAL_TIMEOUT_S = 180;

// --- Broker MQTT ------------------------------------------------------------
const char* MQTT_HOST = "broker.hivemq.com";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_PREFIX = "stma";
// Compatibilidade com a pagina HTML original. Topicos globais sao apenas para bancada.
const bool LEGACY_PAGE_ENABLED = true;
const unsigned long SAMPLE_MS = 15000;
