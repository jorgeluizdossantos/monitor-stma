# Firmware da Fase 7 — ESP32, TLS, QoS 1 e UTC

Preserva DHT11 no GPIO 4, LED no GPIO 5 e porta no GPIO 15. A versão anterior
em `../mqtt_esp32_stma` permanece disponível para referência.

1. Instale ArduinoMqttClient 0.1.8, DHT sensor library e Adafruit Unified Sensor.
2. Copie `config.example.h` para `config.h` e preencha Wi-Fi, host/porta, usuário
   próprio da placa, senha e CA raiz do broker. O arquivo é ignorado pelo Git.
3. Use ESP32 Dev Module (`esp32:esp32:esp32`), compile e só então grave na COM13.
4. Feche Monitor Serial/Plotter antes do upload; depois acompanhe em 115200 baud.
5. Confirme mensagens em `<prefixo>/<device_id>/dados` e persistência no backend.

O relógio sincroniza por NTP antes de conectar; TLS valida a CA e o hostname,
sem `setInsecure()`. O padrão é publicar a cada 30 segundos. O backend já aceita
o timestamp ISO UTC enviado e deduplica retransmissões com a mesma identidade/hora.
Mudar o cadastro do intervalo na API ainda não reconfigura a placa; ajuste também
`READING_INTERVAL_MS` e recompile.

Todas as publicações usam QoS 1. Uma leitura fica pendente em RAM até PUBACK,
com o mesmo JSON/timestamp na próxima tentativa. Reiniciar/perder energia perde
essa pendência; não há buffer durável nem promessa de coleta contínua durante
queda de rede. PUBACK do broker não equivale a commit no banco; o backend possui
seu próprio consumo/transação. Porta publica mudanças; LWT publica offline.

O comando LED mantém `L`/`l`, apenas com payload de um byte e sem mensagem retida.
Use credenciais/ACL para impedir comandos de terceiros. A validação de telemetria
não precisa enviar comandos ao LED.

Troca de broker: altere somente `config.h` na placa e `.env` no backend. Para teste
local explícito, existe `MQTT_USE_TLS=false`, host LAN do PC e porta 1883; na nuvem,
use TLS. Não envie Wi-Fi/senhas/CA por mensagens públicas nem comite config.h.

Compilação e testes físicos devem ser registrados no roteiro; este arquivo não
afirma que a conexão remota ou o upload já foram validados.
