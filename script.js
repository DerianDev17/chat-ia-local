import {CreateWebWorkerMLCEngine} from "https://esm.run/@mlc-ai/web-llm"

const $ = el => document.querySelector(el);
// Seleccionar la variable del documento
// Se usa $ para indicar que es una referencia a un elemento del DOM
const $form = $('form');
const $input = $('input');
const $messages = $('ul');
const $template = $('#message-template');
const $button = $('button');
const $container = $('main');
const $info = $('small');

let messages = []

const SELECT_MODEL = 'Llama-3.1-8B-Instruct-q4f32_1-MLC-1k'

const engine = await CreateWebWorkerMLCEngine(
    new Worker('/worker.js', {type: 'module'}),
    SELECT_MODEL,
    {
        initProgressCallback: (info) => {
            // Actualizar la información de carga del modelo
            $info.textContent = `Cargando modelo: ${(info.progress * 100).toFixed(2)}%`
            if(info.progress === 1){
                $button.removeAttribute('disabled')
                $info.textContent = 'Modelo cargado. Listo para chatear.'
            }
        }
    }
)

$form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const messageText = $input.value.trim()
    if(messageText !== ''){
        $input.value = ''
    }
    
    addMessage(messageText, 'user')
    // Este código deshabilita el botón de envío
    // para evitar múltiples envíos mientras se procesa la respuesta
    $button.setAttribute('disabled', '')

    const userMessage = {
        role: 'user',
        content: messageText
    }
    messages.push(userMessage)
    
    const chunks = await engine.chat.completions.create({
        messages,
        stream: true
    })

    let reply = ""
    const $botMessage = addMessage('', 'bot')


    for await (const chunk of chunks){
        const choice = chunk.choices[0]
        const content = choice?.delta?.content ?? ""
        reply += content
        $botMessage.textContent = reply
    }

    $button.removeAttribute('disabled')
    messages.push({
        role: 'assistant',
        content: reply
    })
    
});
function addMessage(text, sender){
    //clona el template
const cloneTemplate = $template.content.cloneNode(true)
const $newMessage = cloneTemplate.querySelector('.message')

const $who = $newMessage.querySelector('span')
const $text = $newMessage.querySelector('p')

$text.textContent = text
$who.textContent = sender === 'bot' ? 'chatGPT' : 'usuario'
$newMessage.classList.add( sender)

$messages.appendChild($newMessage)

//actualizar el scroll para ir bajando
$container.scrollTop = $container.scrollHeight

return $text

}