import { readDocument } from './documents.js';
import {
  knowledgeNote,
  knowledgeDocument,
  projectName,
  projectKnowledge,
  searchKnowledge,
} from './knowledge.js';
import { exportKnowledgeBackup, readKnowledgeBackup } from './knowledge-backup.js';

export function createKnowledgeUI({ document: doc, store, current, locked, setLocked, changed }) {
  const $ = (selector) => doc.querySelector(selector);
  let entries = [];
  let editing = null;
  let pendingDocument = null;
  let origin = null;
  let busy = false;
  let pendingImport = null;
  const status = (text) => {
    $('#knowledge-status').textContent = text;
    if ($('#import-knowledge-dialog').open) $('#import-knowledge-status').textContent = text;
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
    const projectEntries = projectKnowledge(entries, project);
    const matches = searchKnowledge(
      projectEntries,
      $('#knowledge-search').value,
      $('#knowledge-kind').value,
    );
    $('#knowledge-count').textContent = `${matches.length} de ${projectEntries.length} entradas`;
    for (const entry of matches.sort((a, b) => b.updatedAt - a.updatedAt)) {
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
          ? `${entry.origin.imported ? 'Copia importada; independiente del chat original. ' : ''}Origen: ${entry.origin.title || 'Conversación'} · ${entry.origin.role === 'assistant' ? 'respuesta del asistente' : 'mensaje del usuario'}. Revisa el contenido antes de guardarlo.`
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
      empty.textContent = projectEntries.length
        ? 'No hay coincidencias. Cambia la búsqueda o el tipo.'
        : 'Este proyecto todavía no tiene documentos, notas ni recuerdos.';
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
    $('#knowledge-tools').inert = true;
    $('#confirm-knowledge-import').disabled = true;
    try {
      await action();
    } catch (error) {
      status(error.message || 'No se pudo guardar el contenido. Vuelve a intentarlo.');
    } finally {
      busy = false;
      setLocked(false);
      $('#knowledge-form').inert = false;
      $('#knowledge-list').inert = false;
      $('#knowledge-tools').inert = false;
      $('#confirm-knowledge-import').disabled = !pendingImport?.length;
    }
  }

  async function open(message = null) {
    if (locked() || busy) return;
    reset();
    $('#knowledge-search').value = '';
    $('#knowledge-kind').value = '';
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
  $('#knowledge-search').addEventListener('input', render);
  $('#knowledge-kind').addEventListener('change', render);
  $('#export-knowledge').addEventListener(
    'click',
    () =>
      void run(async () => {
        const json = exportKnowledgeBackup(await store.listKnowledge());
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = doc.createElement('a');
        link.href = url;
        link.download = 'semilla-biblioteca.json';
        doc.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status('Copia exportada con todos los proyectos, documentos, notas y recuerdos.');
      }),
  );
  $('#knowledge-backup-file').addEventListener('change', () => {
    const file = $('#knowledge-backup-file').files?.[0];
    if (!file) return;
    void run(async () => {
      pendingImport = null;
      const imported = await readKnowledgeBackup(file);
      pendingImport = imported;
      $('#import-knowledge-status').textContent = '';
      $('#import-knowledge-summary').textContent =
        `${imported.length} entradas de ${new Set(imported.map((entry) => projectName(entry.project).toLocaleLowerCase('es'))).size} proyectos. Se omitirán duplicados y se conservará el contenido existente.`;
      $('#import-knowledge-preview').replaceChildren(
        ...imported.map((entry) => {
          const item = doc.createElement('li');
          item.textContent = `${entry.project} · ${entry.title} · ${entry.text.slice(0, 120)}`;
          return item;
        }),
      );
      $('#confirm-knowledge-import').disabled = !imported.length;
      $('#import-knowledge-dialog').showModal();
    }).finally(() => {
      $('#knowledge-backup-file').value = '';
    });
  });
  $('#import-knowledge-dialog').addEventListener('close', () => {
    pendingImport = null;
  });
  $('#confirm-knowledge-import').addEventListener('click', () => {
    if (!pendingImport?.length) return;
    const imported = pendingImport;
    void run(async () => {
      const result = await store.importKnowledge(imported);
      $('#import-knowledge-dialog').close();
      await refresh();
      changed();
      status(
        `${result.imported} entradas importadas; ${result.skipped} duplicadas omitidas. Selecciona su proyecto para verlas.`,
      );
    });
  });
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
