# Chat con IA usando Llama 3.1

Este proyecto implementa un chat interactivo utilizando el modelo de lenguaje Llama 3.1 directamente en el navegador.

## Características

- Interfaz de chat en tiempo real
- Utiliza el modelo Llama 3.1 8B Instruct
- Procesamiento del modelo en el lado del cliente (navegador)
- Respuestas generadas en tiempo real (streaming)

## Tecnologías utilizadas

- HTML5
- CSS3
- JavaScript (ES6+)
- Web Workers
- @mlc-ai/web-llm (para la ejecución del modelo de IA)

## Cómo funciona

1. El proyecto carga el modelo Llama 3.1 en el navegador del usuario.
2. Una vez cargado, el usuario puede enviar mensajes a través de la interfaz.
3. Los mensajes son procesados por el modelo de IA, que genera respuestas en tiempo real.
4. Las respuestas se muestran en la interfaz de chat, simulando una conversación.

## Instalación

1. Clona este repositorio:
   ```bash
   git clone https://github.com/DerianDev17/chat-ia-local.git
   ```
2. Navega al directorio del proyecto:
   ```bash
   cd chat-ia-local
   ```
3. Abre el archivo `index.html` en tu navegador o utiliza un servidor local.

## Uso

1. Espera a que el modelo se cargue completamente (verás un mensaje de "Modelo cargado. Listo para chatear.").
2. Escribe tu mensaje en el campo de texto y presiona "Enviar" o la tecla Enter.
3. Espera la respuesta del modelo, que se mostrará en tiempo real en la interfaz de chat.

## Contribuciones

Las contribuciones son bienvenidas. Por favor, abre un issue para discutir los cambios propuestos antes de realizar un pull request.

## Licencia

[MIT](https://choosealicense.com/licenses/mit/)

