// Importar la función para crear el motor de trabajo web
import {CreateWebWorkerMLCEngine} from "https://esm.run/@mlc-ai/web-llm"

// Función para seleccionar un elemento del DOM
const $ = el => document.querySelector(el);

// Seleccionar elementos del documento
const $form = $('form'); // Formulario para enviar mensajes
const $input = $('input'); // Campo de entrada para mensajes
const $messages = $('ul'); // Lista donde se mostrarán los mensajes
const $template = $('#message-template'); // Plantilla para los mensajes
const $button = $('button'); // Botón de envío
const $container = $('main'); // Contenedor principal
const $info = $('small'); // Elemento para mostrar información

let messages = [] // Arreglo para almacenar los mensajes

// Modelo a utilizar
const SELECT_MODEL = 'Llama-3.1-8B-Instruct-q4f32_1-MLC-1k'

// Crear el motor de trabajo web para el modelo
const engine = await CreateWebWorkerMLCEngine(
    new Worker('/worker.js', {type: 'module'}), // Crear un nuevo trabajador
    SELECT_MODEL, // Seleccionar el modelo
    {
        // Callback para actualizar el progreso de carga del modelo
        initProgressCallback: (info) => {
            $info.textContent = `Cargando modelo: ${(info.progress * 100).toFixed(2)}%`
            if(info.progress === 1){
                $button.removeAttribute('disabled') // Habilitar el botón al finalizar la carga
                $info.textContent = 'Modelo cargado. Listo para chatear.' // Mensaje de estado
            }
        }
    }
)

// Evento para manejar el envío del formulario
$form.addEventListener('submit', async (e) => {
    e.preventDefault() // Prevenir el comportamiento por defecto del formulario
    const messageText = $input.value.trim() // Obtener el texto del mensaje
    if(messageText !== ''){
        $input.value = '' // Limpiar el campo de entrada
    }
    
    addMessage(messageText, 'user') // Agregar el mensaje del usuario
    $button.setAttribute('disabled', '') // Deshabilitar el botón de envío

    const userMessage = {
        role: 'user', // Rol del remitente
        content: messageText // Contenido del mensaje
    }
    messages.push(userMessage) // Agregar el mensaje al arreglo
    
    // Crear la respuesta del modelo
    const chunks = await engine.chat.completions.create({
        messages, // Mensajes enviados
        stream: true // Habilitar el streaming
    })

    let reply = "" // Variable para almacenar la respuesta
    const $botMessage = addMessage('', 'bot') // Agregar mensaje del bot

    // Procesar los fragmentos de respuesta
    for await (const chunk of chunks){
        const choice = chunk.choices[0] // Obtener la elección
        const content = choice?.delta?.content ?? "" // Obtener el contenido
        reply += content // Concatenar el contenido
        $botMessage.textContent = reply // Actualizar el mensaje del bot
    }

    $button.removeAttribute('disabled') // Habilitar el botón de envío
    messages.push({
        role: 'assistant', // Rol del asistente
        content: reply // Contenido de la respuesta
    })
    
});

// Función para agregar un mensaje a la interfaz
function addMessage(text, sender){
    // Clonar la plantilla para el nuevo mensaje
    const cloneTemplate = $template.content.cloneNode(true)
    const $newMessage = cloneTemplate.querySelector('.message') // Nuevo mensaje

    const $who = $newMessage.querySelector('span') // Elemento para el remitente
    const $text = $newMessage.querySelector('p') // Elemento para el contenido del mensaje

    $text.textContent = text // Asignar el texto del mensaje
    $who.textContent = sender === 'bot' ? 'chatGPT' : 'usuario' // Asignar el remitente
    $newMessage.classList.add(sender) // Agregar clase según el remitente

    $messages.appendChild($newMessage) // Agregar el nuevo mensaje a la lista

    // Actualizar el scroll para mostrar el último mensaje
    $container.scrollTop = $container.scrollHeight

    return $text 
}