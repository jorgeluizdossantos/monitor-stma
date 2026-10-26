# Firmware ESP32 — validação local da Fase 4

Cópia adaptada do sketch mqtt_esp32_aula_pub indicado pelo proprietário. O original da pasta Arduino foi preservado. Configuração de rede separada em config.h, ignorado pelo Git. Não publique esse arquivo.

1. Abra mqtt_esp32_stma.ino nesta pasta na Arduino IDE. O nome da pasta coincide com o sketch.
2. O config.h local já foi preparado com o Wi-Fi do original. Em outra máquina, copie config.example.h para config.h e preencha a rede.
3. Confirme o IPv4 do computador que executa o HiveMQ: o valor observado nesta sessão foi 192.168.0.102, porta 1883. O IP pode mudar. ESP32 e computador precisam estar na mesma rede acessível.
4. Selecione a placa ESP32 correta e a porta COM da placa conectada. Dependências: pacote ESP32, PubSubClient e biblioteca DHT da Adafruit (com suas dependências).
5. Clique em Verificar. Depois de compilação aprovada, carregue na placa. Abra o Monitor Serial em 115200 baud.
6. Confira Wi-Fi conectado, ID da placa, conexão MQTT e JSON a cada dois segundos. Não confunda envio ao broker com gravação no banco.
7. No MQTTBox, use o mesmo host, porta 1883 e assine engeasier/esp32-a8032a1e7214/#. Confirme o ID efetivamente mostrado no serial.
8. Para o backend no mesmo PC, use MQTT_URL=mqtt://127.0.0.1:1883. Configure MQTT_ENABLED=true e confirme DB_TARGET antes de iniciar. Dispositivos desconhecidos entram na fila; depois da adoção pelo superadmin, novas mensagens geram leituras.

Pinos preservados: DHT11 no GPIO 4, LED no GPIO 5 e sensor de porta no GPIO 15. Não altere a fiação por causa desta cópia.

Tópicos preservados por dispositivo: /dados, /temperatura, /umidade, /porta, /status, /led e /comando. O backend consome somente /dados, /porta e /status. Comandos L/l do LED são recebidos em /comando.

Esta versão usa WiFiClient para laboratório local, sem TLS. Para Cloud/remoto, será necessária adaptação com TLS e certificado, não apenas troca de host. PubSubClient publica dados em QoS 0; o JSON não tem timestamp e o backend usa recebimento. Não há garantia de reentrega ou deduplicação do firmware atual. Os testes QoS 1 do backend usam um publicador simulado independente.

Validação realizada: compilação aprovada para ESP32 Dev Module (esp32:esp32:esp32), programa 68% e RAM 14%. Upload na COM13 falhou ao abrir a porta com acesso negado. Fechar Monitor Serial/Plotter e outros programas seriais antes de repetir. Gravação e teste físico ainda pendentes.

Atualização: após liberar COM13, upload concluído com hash verificado. JSON físico recebido no HiveMQ local e persistido no MySQL, dispositivo adotado no ambiente Bancada ESP32. Consulte o encerramento da Fase 4 em docs/roteiro-backend.md. A falha de porta acima é histórica e foi resolvida.
