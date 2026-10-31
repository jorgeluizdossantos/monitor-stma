# Firmware ESP32

Sketches do monitor STMA (ESP32 + DHT11, MQTT). Cada pasta é um sketch completo do
Arduino IDE; o `config.h` é local, ignorado pelo Git, e sai de `config.example.h`.

## Pastas

| Pasta | Situação | Observação |
| --- | --- | --- |
| `mqtt_esp32_limite_stma_v2\` | **Ativo (bancada)** | Sensor, porta e LED, com limite automático e portal local de configuração de rede. É o firmware em uso. |
| `mqtt_esp32_stma_tls\` | Em aberto (produção) | Variante com TLS. Ainda não concluída. |
| `mqtt_esp32_stma\` | Histórico | Versão inicial do sketch. Mantém os tópicos globais que o v2 preserva via `LEGACY_PAGE_ENABLED`. |
| `mqtt_esp32_limite_stma\` | Histórico | Primeiro sketch, antes da versão v2. |

## Documentação

- `esquema_eletrico_esp32_monitor.png` e `.svg` — esquema elétrico.
- `esquema_esp32.docx` — versão editável do esquema.

## Credenciais

Nenhum `config.h` entra no Git (`firmware/**/config.h`). No v2 a rede e a senha do
Wi-Fi são configuradas pelo portal local e ficam na NVS do dispositivo; o `config.h`
guarda apenas o nome e a senha do Access Point do portal e os parâmetros do broker.
