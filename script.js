import { createApp } from './src/app.js';
import { LocalEngine, checkCompatibility } from './src/engine.js';
import { ConversationStore } from './src/storage.js';

createApp({ runtime: new LocalEngine(), store: new ConversationStore(), checkCompatibility })
  .start()
  .catch((error) => {
    console.error(error);
    const notice = document.querySelector('#notice');
    notice.textContent =
      'No se pudo iniciar la aplicación. Recarga la página para volver a intentarlo.';
    notice.hidden = false;
  });
