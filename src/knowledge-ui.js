import { readDocument } from './documents.js';
import { knowledgeNote, knowledgeDocument, projectName, projectKnowledge } from './knowledge.js';

export function createKnowledgeUI({ document: doc, store, current, locked, setLocked, changed }) {
  const $ = (selector) => doc.querySelector(selector);
  let entries = [];
  let editing = null;
  let pendingDocument = null;
  let origin = null;
  let busy = false;
  const status = (text) => {
    $('#knowledge-status').textContent = text;
  };

  function reset() {
    editing = null;
    pendingDocument = null;
    origin = null;
    $('#knowledge-title').value = '';
    $('#knowledge-text').value = '';
    $('#knowledge-text').readOnly = false;
    $('#knowledge-origin').textContent = '';
    $('#save-knowledge').textContent = 'Guardar nota';
  }

  function render() {
    const list = $('#knowledge-list');
    list.replaceChildren();
    const project = $('#knowledge-project').value;
    for (const entry of projectKnowledge(entries, project).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )) {
      const item = doc.createElement('li');
      const name = doc.createElement('strong');
      name.textContent = entry.title;
      const detail = doc.createElement('p');
      detail.textContent = `${{ document: 'Documento', note: 'Nota', memory: 'Recuerdo de chat' }[entry.kind]} · ${entry.project}`;
      const edit = doc.createElement('button');
      edit.className = 'secondary-button';
      edit.textContent = entry.kind === 'document' ? 'Ver documento' : 'Ver / editar';
      edit.setAttribute('aria-label', `${edit.textContent}: ${entry.title}`);
      edit.addEventListener('click', () => {
        if (busy) return;
        reset();
        editing = entry;
        origin = entry.origin;
        pendingDocument = entry.document || null;
        $('#knowledge-title').value = entry.title;
        $('#knowledge-text').value = entry.text;
        $('#knowledge-text').readOnly = entry.kind === 'document';
        $('#knowledge-origin').textContent = entry.origin
          ? `Origen: ${entry.origin.title || 'Conversación'} · ${entry.origin.role === 'assistant' ? 'respuesta del asistente' : 'mensaje del usuario'}. Revisa el contenido antes de guardarlo.`
          : '';
        $('#save-knowledge').textContent = 'Guardar cambios';
        status('');
        $('#knowledge-title').focus();
      });
      const remove = doc.createElement('button');
      remove.className = 'danger-button';
      remove.textContent = 'Olvidar';
      remove.setAttribute('aria-label', `Olvidar: ${entry.title}`);
      remove.addEventListener('click', async () => {
        if (busy) return;
        $('#forget-description').textContent =
          `Se eliminará «${entry.title}» de la biblioteca. Las respuestas anteriores pueden conservar citas de este contenido.`;
        $('#forget-dialog').returnValue = '';
        $('#forget-dialog').showModal();
        const confirmed = await new Promise((resolve) =>
          $('#forget-dialog').addEventListener(
            'close',
            () => resolve($('#forget-dialog').returnValue === 'confirm'),
            { once: true },
          ),
        );
        if (!confirmed || busy) return;
        await run(async () => {
          if (!(await store.deleteKnowledge(entry.id, entry.updatedAt))) {
            await refresh();
            status(
              'Esta entrada cambió en otra pestaña. Revisa la versión actual antes de olvidarla.',
            );
            return;
          }
          if (editing?.id === entry.id) reset();
          await refresh();
          changed();
          status('Contenido eliminado. No se utilizará en nuevas consultas.');
        });
      });
      item.append(name, detail, edit, remove);
      list.append(item);
    }
    if (!list.children.length) {
      const empty = doc.createElement('li');
      empty.textContent = 'Este proyecto todavía no tiene documentos, notas ni recuerdos.';
      list.append(empty);
    }
  }

  async function refresh() {
    entries = await store.listKnowledge();
    $('#knowledge-projects').replaceChildren(
      ...[...new Set(['General', ...entries.map((entry) => entry.project)])]
        .sort()
        .map((project) => {
          const option = doc.createElement('option');
          option.value = project;
          return option;
        }),
    );
    render();
  }

  async function run(action) {
    if (busy || locked()) return;
    busy = true;
    setLocked(true);
    $('#knowledge-form').inert = true;
    $('#knowledge-list').inert = true;
    try {
      await action();
    } catch (error) {
      status(error.message || 'No se pudo guardar el contenido. Vuelve a intentarlo.');
    } finally {
      busy = false;
      setLocked(false);
      $('#knowledge-form').inert = false;
      $('#knowledge-list').inert = false;
    }
  }

  async function open(message = null) {
    if (locked() || busy) return;
    reset();
    $('#knowledge-project').value = projectName(current().project);
    if (message) {
      origin = {
        conversationId: current().id,
        messageId: message.id,
        title: current().title,
        role: message.role,
      };
      $('#knowledge-title').value = message.content.replace(/\s+/g, ' ').slice(0, 80);
      $('#knowledge-text').value = message.content;
      $('#knowledge-origin').textContent =
        'Recuerdo de este chat. Revisa y corrige el texto antes de guardarlo; una respuesta del asistente puede contener errores.';
      $('#save-knowledge').textContent = 'Guardar recuerdo';
    }
    status('');
    $('#knowledge-dialog').showModal();
    await run(refresh);
  }

  $('#knowledge-project').addEventListener('input', render);
  $('#new-knowledge').addEventListener('click', () => {
    if (!busy) {
      reset();
      status('');
    }
  });
  $('#knowledge-file').addEventListener('change', () => {
    const file = $('#knowledge-file').files?.[0];
    if (!file) return;
    void run(async () => {
      status('Leyendo archivo en este dispositivo…');
      const document = await readDocument(file);
      reset();
      pendingDocument = document;
      $('#knowledge-title').value = document.name;
      $('#knowledge-text').value = document.text;
      $('#knowledge-text').readOnly = true;
      $('#save-knowledge').textContent = 'Guardar documento';
      status('Revisa el texto extraído y pulsa Guardar documento.');
    }).finally(() => {
      $('#knowledge-file').value = '';
    });
  });
  $('#knowledge-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void run(async () => {
      const title = $('#knowledge-title').value.trim();
      const project = projectName($('#knowledge-project').value);
      if (!title) throw new Error('Escribe un título.');
      const entry = pendingDocument
        ? {
            ...knowledgeDocument(pendingDocument, project),
            title,
            ...(editing
              ? {
                  id: editing.id,
                  createdAt: editing.createdAt,
                  updatedAt: Math.max(Date.now(), editing.updatedAt + 1),
                }
              : {}),
          }
        : knowledgeNote({ title, project, text: $('#knowledge-text').value, origin }, editing);
      const existing = await store.listKnowledge();
      if (!editing && existing.length >= 100)
        throw new Error(
          'La biblioteca admite hasta 100 entradas. Elimina una antes de añadir otra.',
        );
      if (
        !editing &&
        projectKnowledge(existing, project).some(
          (item) => item.text === entry.text && item.kind === entry.kind,
        )
      )
        throw new Error('Este contenido ya está guardado en el proyecto.');
      if (!(await store.saveKnowledge(entry, editing?.updatedAt ?? null)))
        throw new Error(
          'El contenido o su chat de origen cambió o se eliminó. Vuelve a abrir la biblioteca.',
        );
      reset();
      await refresh();
      changed();
      status(
        'Guardado. Activa «Usar biblioteca y memoria» en un chat del mismo proyecto para consultarlo.',
      );
    });
  });
  return { open, refresh };
}
