import { readConversationBackup } from './conversation-backup.js';

export function createConversationImportUI({
  document: doc,
  store,
  locked,
  setLocked,
  imported,
  notice,
}) {
  const $ = (selector) => doc.querySelector(selector);
  const dialog = $('#import-conversation-dialog');
  let pending = null;
  let saving = false;

  async function preview(file) {
    if (locked()) return;
    setLocked(true);
    notice('Leyendo copia de conversación…');
    try {
      pending = await readConversationBackup(file);
      $('#import-conversation-detail').textContent =
        `${pending.title} · ${pending.messages.length} mensajes · ${pending.document ? `Documento: ${pending.document.name}` : 'Sin documento adjunto'}`;
      // Bounded plain-text preview; the complete validated conversation is saved.
      $('#import-conversation-preview').textContent =
        pending.messages
          .slice(0, 6)
          .map(
            (message) =>
              `${message.role === 'user' ? 'Tú' : 'Semilla Digital'}: ${message.content.slice(0, 600)}`,
          )
          .join('\n\n') || 'Esta conversación todavía no tiene mensajes.';
      $('#import-conversation-status').textContent = '';
      $('#confirm-conversation-import').disabled = false;
      dialog.showModal();
      $('#cancel-conversation-import').focus();
      notice('');
    } catch (error) {
      pending = null;
      notice(error.message || 'No se pudo leer la copia.', 'error');
    } finally {
      $('#conversation-backup-file').value = '';
      setLocked(false);
    }
  }

  async function accept() {
    if (!pending || saving || locked()) return;
    const copy = pending;
    saving = true;
    setLocked(true);
    $('#confirm-conversation-import').disabled = true;
    $('#cancel-conversation-import').disabled = true;
    $('#import-conversation-status').textContent = 'Guardando conversación…';
    try {
      // A preview can remain open while another tab clears the history.
      copy.createdAt = copy.updatedAt = Date.now();
      if ((await store.save(copy)) === false)
        throw new Error('El almacenamiento rechazó la copia.');
      dialog.close();
      setLocked(false);
      imported(copy);
    } catch {
      $('#import-conversation-status').textContent =
        'No se pudo guardar la copia. Libera espacio en el navegador y vuelve a intentarlo.';
    } finally {
      saving = false;
      setLocked(false);
      $('#confirm-conversation-import').disabled = !pending;
      $('#cancel-conversation-import').disabled = false;
    }
  }

  function start() {
    $('#import-conversation').addEventListener('click', () => {
      if (!locked()) $('#conversation-backup-file').click();
    });
    $('#conversation-backup-file').addEventListener('change', () => {
      const file = $('#conversation-backup-file').files?.[0];
      if (file) void preview(file);
    });
    $('#confirm-conversation-import').addEventListener('click', () => void accept());
    $('#cancel-conversation-import').addEventListener('click', () => {
      if (!saving) dialog.close();
    });
    dialog.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      pending = null;
      $('#import-conversation-preview').textContent = '';
      $('#import-conversation-detail').textContent = '';
      $('#import-conversation-status').textContent = '';
    });
  }

  return { start };
}
