# Firmware MVP — ESP32, DHT11, porta e LED

Esta versão preserva o sketch original do usuário. O arquivo `.ino` desta pasta é
o novo código; `config.h` contém a configuração privada e não entra no Git.

## Instalação e uso

1. Instale o pacote de placas ESP32 e as bibliotecas PubSubClient, DHT sensor library,
   Adafruit Unified Sensor e **WiFiManager** no Arduino IDE.
   Validação: ESP32 core 3.3.12 e WiFiManager 2.0.17.
2. Abra `mqtt_esp32_limite_stma_v2.ino`. Copie `config.example.h` para `config.h` e
   troque a senha do Access Point (`PORTAL_AP_SENHA`). Nenhuma credencial de Wi-Fi
   fica no `config.h`.
3. Selecione **ESP32 Dev Module**, porta **COM13** nesta bancada. Não desconecte o USB.
4. Feche qualquer Monitor Serial antes de gravar. Clique em Carregar.
5. Abra o Monitor Serial em 115200: deve aparecer `esp32-a8032a1e7214` nesta placa,
   `MQTT conectado` e JSON com temperatura, umidade e horário UTC.
6. Para outra placa, cadastre seu identificador e atualize `MQTT_DEVICE_IDS` no backend.

Pinos preservados: DHT11 GPIO4, LED GPIO5 e porta GPIO15 (entrada HIGH = fechada).
O MAC é lido com `esp_read_mac`, evitando o identificador zerado antes da conexão Wi-Fi.

## Configuração da rede (portal local)

A rede e a senha do Wi-Fi **não** ficam no código: são gravadas na NVS do
dispositivo pelo portal local. Trocar de rede não exige recompilar nem regravar.

1. No primeiro boot, ou quando não houver credenciais utilizáveis, o dispositivo cria
   um Access Point chamado `STMA-<device_id>` (ex.: `STMA-esp32-a8032a1e7214`),
   protegido por WPA2 com a senha definida em `PORTAL_AP_SENHA`.
2. Conecte o computador ou o celular nesse Access Point. A página de configuração abre
   em `http://192.168.4.1` — escolha a rede na lista escaneada e informe a senha.
3. Ao salvar, as credenciais vão para a NVS e o dispositivo entra na rede normalmente.
4. Se ninguém configurar em `PORTAL_TIMEOUT_S` segundos, o portal se fecha, o
   dispositivo reinicia e volta ao modo normal. O portal nunca fica aberto sem limite.

### Reconfigurar sem acesso físico

Publique `1` (ou `portal`) em `stma/<device_id>/portal`. O dispositivo publica
`offline` em `/status`, reinicia e sobe o portal em vez de conectar na rede. O timeout
acima continua valendo, portanto um comando indevido não deixa o dispositivo
inacessível de forma permanente.

> No broker público qualquer terceiro pode publicar nesse tópico. O timeout limita o
> efeito, mas não elimina o risco: ele desaparece quando a variante TLS for adotada.

## Contrato

Prefixo padrão `stma/<device_id>`:

| Sufixo | Publicação/assinatura | Conteúdo |
| --- | --- | --- |
| `/dados` | Publica sem retain | JSON `{id,temperatura,umidade,timestamp}` |
| `/porta` | Publica sem retain | `Porta Aberta` ou `Porta Fechada` |
| `/status` | Publica/LWT | `online`/`offline`, retido |
| `/controle` | Publica sem retain | JSON `{id,led,limite,comando_id}` |
| `/acionar` | Assina | `uuid|validade_unix|led|L` (ou `l`); `uuid|validade_unix|limite|28.0` (ou `off`) |
| `/portal` | Assina | `1` ou `portal` — reinicia o dispositivo no modo de configuração |

O backend publica comandos sem retain, com validade de 15 segundos. O firmware
exige relógio NTP sincronizado, recusa comandos vencidos e confirma o UUID recebido.
Não confundir PUBACK do broker com confirmação do dispositivo.

O intervalo `SAMPLE_MS=15000` reduz a fila de transações no Aiven da bancada.
O sensor é validado antes da publicação (temperatura 0–50 °C; umidade 0–100%).
Sem NTP, `/dados` omite timestamp e o backend usa recebimento; comandos novos
ficam bloqueados até sincronizar. Não há buffer de leituras durante desconexões.
Publicações do PubSubClient são QoS 0; assinatura QoS 1 no backend não transforma
essas publicações em entrega garantida.

O automático acende em temperatura >= limite e apaga abaixo de limite − 0,5 °C.
Desative-o antes de comandar manualmente. Limite e estado não persistem no reboot.
O limite do LED é independente das faixas ideais e dos episódios de alerta.

## Compatibilidade e evolução

`LEGACY_PAGE_ENABLED=true` mantém os tópicos globais `stma/temperatura`, `umidade`,
`porta`, `led`, `limite_atual` e as assinaturas `publisher` e `limite` da página
original. O backend só grava `/dados` por dispositivo, evitando duplicação das
medições publicadas individualmente. Não execute dois sketches com o mesmo ID.

Neste MVP, ESP32 usa HiveMQ público TCP/1883. Tópicos públicos, inclusive os
comandos, podem ser publicados por terceiros; o ID e o UUID não autenticam a placa.
Use apenas como demonstração de bancada, sem atuadores críticos. Para produção,
desabilite a compatibilidade global, adote broker privado/ACL/TLS e conclua a
variante `mqtt_esp32_stma_tls`. Trocar TCP sem TLS por TLS exige também o cliente
seguro/certificado no firmware; não basta trocar o número da porta.
